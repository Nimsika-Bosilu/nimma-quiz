"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { User, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import QRCode from "qrcode";
import { ChevronLeft, ChevronRight, CopyPlus, Eye, LogIn, LogOut, Play, Plus, QrCode, Save, Square, Timer, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { getDb, getFirebaseAuth, hasFirebaseConfig, signInHostWithGoogle, signOutHost } from "@/lib/firebase";
import { createBlankQuestion, Question, questions as starterQuestions, QuizDoc, QuizLevel } from "@/lib/quiz";

type SessionStatus = "lobby" | "closed" | "live" | "leaderboard" | "ended";

type Session = {
  title: string;
  status: SessionStatus;
  activeQuestion: number;
  quizId?: string;
  questions: Question[];
  questionStartedAt?: number;
  durationSeconds?: number;
  hostUid?: string;
  createdAt?: any;
};

type Player = {
  name: string;
  indexNo: string;
  score: number;
};

type QuizWithId = QuizDoc & {
  id: string;
  ownerUid?: string;
};

const levels: QuizLevel[] = ["beginner", "intermediate", "advanced"];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function emptyQuiz(): QuizDoc {
  return {
    title: "New Nimma Quiz",
    description: "",
    questions: [createBlankQuestion()]
  };
}

function defaultSessionCode() {
  return `nimma-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
}

export default function AdminPage() {
  const [host, setHost] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sessionId, setSessionId] = useState(defaultSessionCode);
  const [durationSeconds, setDurationSeconds] = useState(20);
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [qr, setQr] = useState("");
  const [message, setMessage] = useState("");
  const [quizzes, setQuizzes] = useState<QuizWithId[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [quizDraft, setQuizDraft] = useState<QuizDoc>(emptyQuiz);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hostName, setHostName] = useState("");
  const [authLoadingStatus, setAuthLoadingStatus] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<"library" | "lobby" | "leaderboard">("library");
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [selectedPastSession, setSelectedPastSession] = useState<any | null>(null);

  const selectedQuiz = quizzes.find((quiz) => quiz.id === selectedQuizId);
  const activeQuestions = session?.questions ?? selectedQuiz?.questions ?? [];
  const currentSessionQuestion = session ? activeQuestions[session.activeQuestion] : null;

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined" || !sessionId.trim()) return "";
    const base = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}`;
    return `${base}/?session=${encodeURIComponent(sessionId.trim())}`;
  }, [sessionId]);

  const leaderboardUrl = useMemo(() => {
    if (typeof window === "undefined" || !sessionId.trim()) return "";
    const base = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}`;
    return `${base}/leaderboard/?session=${encodeURIComponent(sessionId.trim())}`;
  }, [sessionId]);

  useEffect(() => {
    if (!hasFirebaseConfig) {
      setAuthLoading(false);
      return;
    }
    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      setHost(user && !user.isAnonymous ? user : null);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 280 }).then(setQr);
  }, [joinUrl]);

  useEffect(() => {
    if (!hasFirebaseConfig || !host) return;
    const db = getDb();
    const quizQuery = query(collection(db, "quizzes"), where("ownerUid", "==", host.uid));
    return onSnapshot(quizQuery, (snap) => {
      const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }) as QuizWithId);
      rows.sort((a, b) => {
        const tA = (a.updatedAt as any)?.seconds ?? 0;
        const tB = (b.updatedAt as any)?.seconds ?? 0;
        return tB - tA;
      });
      setQuizzes(rows);
      if (!selectedQuizId && rows[0]) {
        setSelectedQuizId(rows[0].id);
        setQuizDraft({ title: rows[0].title, description: rows[0].description ?? "", questions: rows[0].questions ?? [] });
      }
    });
  }, [host, selectedQuizId]);

  useEffect(() => {
    if (!selectedQuiz) return;
    setQuizDraft({
      title: selectedQuiz.title,
      description: selectedQuiz.description ?? "",
      questions: selectedQuiz.questions?.length ? selectedQuiz.questions : [createBlankQuestion()]
    });
  }, [selectedQuizId, selectedQuiz]);

  useEffect(() => {
    if (!hasFirebaseConfig || !host || !sessionId.trim()) return;
    const db = getDb();
    const unsubSession = onSnapshot(doc(db, "sessions", sessionId.trim()), (snap) => {
      const data = snap.exists() ? snap.data() as Session : null;
      setSession(data && (!data.hostUid || data.hostUid === host.uid) ? data : null);
    });
    const leaderQuery = query(collection(db, "sessions", sessionId.trim(), "players"), orderBy("score", "desc"));
    const unsubPlayers = onSnapshot(leaderQuery, (snap) => {
      setPlayers(snap.docs.map((item) => item.data() as Player));
    });
    return () => {
      unsubSession();
      unsubPlayers();
    };
  }, [host, sessionId]);

  useEffect(() => {
    if (!hasFirebaseConfig || !host) return;
    const db = getDb();
    const q = collection(db, "hosts", host.uid, "past_sessions");
    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      // Sort client-side by endedAt descending
      rows.sort((a: any, b: any) => {
        const tA = a.endedAt?.seconds ?? 0;
        const tB = b.endedAt?.seconds ?? 0;
        return tB - tA;
      });
      setPastSessions(rows);
    });
  }, [host]);

  useEffect(() => {
    if (!session?.questionStartedAt || session.status !== "live") {
      setTimeRemaining(0);
      return;
    }

    const tick = () => {
      const duration = (session.durationSeconds ?? durationSeconds) * 1000;
      const left = Math.max(0, Math.ceil((session.questionStartedAt! + duration - Date.now()) / 1000));
      setTimeRemaining(left);
      if (left === 0) {
        updateDoc(doc(getDb(), "sessions", sessionId.trim()), { status: "leaderboard" });
      }
    };

    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [durationSeconds, session, sessionId]);

  async function loginWithGoogle() {
    setMessage("");
    try {
      const user = await signInHostWithGoogle();
      await setDoc(doc(getDb(), "hosts", user.uid), {
        name: user.displayName ?? "Host",
        email: user.email,
        photoURL: user.photoURL,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch {
      setMessage("Google login failed. Check that Google sign-in is enabled in Firebase Authentication.");
    }
  }

  async function handleManualAuth(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setAuthLoadingStatus(true);

    const emailTrim = email.trim();
    const passwordTrim = password.trim();
    const nameTrim = hostName.trim();

    if (!emailTrim || !passwordTrim || (authMode === "signup" && !nameTrim)) {
      setMessage("Please fill in all fields.");
      setAuthLoadingStatus(false);
      return;
    }

    try {
      const auth = getFirebaseAuth();
      if (authMode === "signup") {
        const userCredential = await createUserWithEmailAndPassword(auth, emailTrim, passwordTrim);
        const user = userCredential.user;
        await updateProfile(user, { displayName: nameTrim });
        
        await setDoc(doc(getDb(), "hosts", user.uid), {
          name: nameTrim,
          email: user.email,
          manual: true,
          updatedAt: serverTimestamp()
        }, { merge: true });
        
        setHost(user);
        setMessage("Account created successfully!");
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, emailTrim, passwordTrim);
        setHost(userCredential.user);
      }
    } catch (error: any) {
      console.error(error);
      if (error.code === "auth/email-already-in-use") {
        setMessage("This email is already in use.");
      } else if (error.code === "auth/weak-password") {
        setMessage("Password should be at least 6 characters.");
      } else if (error.code === "auth/invalid-credential" || error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
        setMessage("Invalid email or password.");
      } else {
        setMessage(error.message || "Authentication failed. Please check your credentials.");
      }
    } finally {
      setAuthLoadingStatus(false);
    }
  }

  async function logout() {
    await signOutHost();
    setHost(null);
  }

  function createNewQuiz() {
    setSelectedQuizId("");
    setQuizDraft(emptyQuiz());
    setMessage("Drafting a new quiz. Save it before creating a session.");
  }

  function useStarterQuestions() {
    setQuizDraft((draft) => ({
      ...draft,
      title: draft.title || "React MCQ Championship",
      questions: starterQuestions
    }));
  }

  async function saveQuiz(event?: FormEvent) {
    event?.preventDefault();
    if (!hasFirebaseConfig || !host) {
      setMessage("Sign in with Gmail before saving quizzes.");
      return;
    }

    const title = quizDraft.title.trim();
    const cleanQuestions = quizDraft.questions.map((question) => ({
      ...question,
      q: question.q.trim(),
      opts: question.opts.map((option) => option.trim()),
      exp: question.exp.trim()
    }));

    if (!title || cleanQuestions.some((question) => !question.q || question.opts.some((option) => !option))) {
      setMessage("Add a title, question text, and all four answer options before saving.");
      return;
    }

    const quizId = selectedQuizId || `${host.uid}-${slugify(title) || Date.now()}`;
    await setDoc(doc(getDb(), "quizzes", quizId), {
      title,
      description: quizDraft.description?.trim() ?? "",
      questions: cleanQuestions,
      ownerUid: host.uid,
      ownerEmail: host.email,
      updatedAt: serverTimestamp(),
      createdAt: selectedQuizId ? selectedQuiz?.createdAt ?? serverTimestamp() : serverTimestamp()
    });
    setSelectedQuizId(quizId);
    setMessage("Quiz saved.");
  }

  async function deleteQuiz() {
    if (!selectedQuizId) return;
    await deleteDoc(doc(getDb(), "quizzes", selectedQuizId));
    setSelectedQuizId("");
    setQuizDraft(emptyQuiz());
    setMessage("Quiz removed.");
  }

  function updateQuestion(index: number, next: Partial<Question>) {
    setQuizDraft((draft) => ({
      ...draft,
      questions: draft.questions.map((question, itemIndex) => itemIndex === index ? { ...question, ...next } : question)
    }));
  }

  function updateOption(questionIndex: number, optionIndex: number, value: string) {
    setQuizDraft((draft) => ({
      ...draft,
      questions: draft.questions.map((question, itemIndex) => {
        if (itemIndex !== questionIndex) return question;
        return {
          ...question,
          opts: question.opts.map((option, index) => index === optionIndex ? value : option)
        };
      })
    }));
  }

  function addQuestion() {
    setQuizDraft((draft) => ({ ...draft, questions: [...draft.questions, createBlankQuestion()] }));
  }

  function duplicateQuestion(index: number) {
    setQuizDraft((draft) => ({
      ...draft,
      questions: [...draft.questions.slice(0, index + 1), { ...draft.questions[index], opts: [...draft.questions[index].opts] }, ...draft.questions.slice(index + 1)]
    }));
  }

  function removeQuestion(index: number) {
    setQuizDraft((draft) => ({
      ...draft,
      questions: draft.questions.length === 1 ? [createBlankQuestion()] : draft.questions.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!host || !selectedQuizId || !selectedQuiz) {
      setMessage("Select and save a quiz before creating a session.");
      return;
    }
    await setDoc(doc(getDb(), "sessions", sessionId.trim()), {
      title: selectedQuiz.title,
      quizId: selectedQuizId,
      hostUid: host.uid,
      hostEmail: host.email,
      hostName: host.displayName ?? "Host",
      status: "lobby",
      activeQuestion: 0,
      questions: selectedQuiz.questions,
      durationSeconds,
      questionStartedAt: Date.now(),
      createdAt: serverTimestamp()
    });
    setMessage("Session lobby created. Share the QR code before starting.");
  }

  async function patchSession(data: Partial<Session>) {
    if (!hasFirebaseConfig || !sessionId.trim()) return;
    await updateDoc(doc(getDb(), "sessions", sessionId.trim()), data);
  }

  async function start() {
    await patchSession({ status: "live", activeQuestion: session?.activeQuestion ?? 0, durationSeconds, questionStartedAt: Date.now() });
  }

  async function showLeaderboard() {
    await patchSession({ status: "leaderboard" });
  }

  async function next() {
    if (!session) return;
    const nextQuestion = Math.min((session.questions?.length ?? 1) - 1, session.activeQuestion + 1);
    await patchSession({ activeQuestion: nextQuestion, status: "live", durationSeconds, questionStartedAt: Date.now() });
  }

  async function previous() {
    if (!session) return;
    const prevQuestion = Math.max(0, session.activeQuestion - 1);
    await patchSession({ activeQuestion: prevQuestion, status: "live", durationSeconds, questionStartedAt: Date.now() });
  }

  async function end() {
    await patchSession({ status: "ended" });
    if (session && host && sessionId.trim()) {
      try {
        const db = getDb();
        const historyId = `${sessionId.trim()}-${Date.now()}`;
        const playersList = players.map((p) => ({
          name: p.name,
          indexNo: p.indexNo,
          score: p.score
        }));
        await setDoc(doc(db, "hosts", host.uid, "past_sessions", historyId), {
          sessionId: sessionId.trim(),
          quizId: session.quizId ?? "",
          title: session.title,
          status: "ended",
          createdAt: session.createdAt ?? serverTimestamp(),
          endedAt: serverTimestamp(),
          players: playersList
        });
      } catch (err) {
        console.error("Failed to archive past session:", err);
      }
    }
  }

  if (!hasFirebaseConfig) {
    return (
      <AdminShell host={null}>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">Setup required</div>
            <h1>Nimma Quiz host account</h1>
            <p className="lead">Add Firebase environment values before hosting quizzes.</p>
          </div>
        </section>
      </AdminShell>
    );
  }

  if (authLoading) {
    return (
      <AdminShell host={null}>
        <div className="panel"><p className="notice">Checking host account...</p></div>
      </AdminShell>
    );
  }

  if (!host) {
    return (
      <AdminShell host={null}>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">Host account</div>
            <h1>Nimma Quiz control room</h1>
            <p className="lead">Create quizzes, launch live sessions, and control the competition flow. Sign in to your host profile or create a new account to get started.</p>
          </div>
          <div className="auth-card">
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab ${authMode === "signin" ? "active" : ""}`}
                onClick={() => {
                  setAuthMode("signin");
                  setMessage("");
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`auth-tab ${authMode === "signup" ? "active" : ""}`}
                onClick={() => {
                  setAuthMode("signup");
                  setMessage("");
                }}
              >
                Create Account
              </button>
            </div>

            <form className="auth-form" onSubmit={handleManualAuth}>
              {authMode === "signup" && (
                <label className="field">
                  <span>Your Name</span>
                  <input
                    type="text"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="Enter your full name"
                    required
                  />
                </label>
              )}
              <label className="field">
                <span>Email Address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@university.edu"
                  required
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>

              <button className="primary-btn" type="submit" disabled={authLoadingStatus}>
                {authLoadingStatus ? (
                  "Loading..."
                ) : authMode === "signin" ? (
                  <>
                    <LogIn size={18} /> Sign In
                  </>
                ) : (
                  <>
                    <Plus size={18} /> Create Account
                  </>
                )}
              </button>
            </form>

            <div className="divider">or</div>

            <button className="google-btn" type="button" onClick={loginWithGoogle}>
              <LogIn size={18} /> Continue with Gmail
            </button>

            {message && <p className="notice" style={{ color: message.toLowerCase().includes("success") ? "var(--green)" : "var(--red)", marginTop: "14px", fontWeight: 700 }}>{message}</p>}
          </div>
        </section>
      </AdminShell>
    );
  }

  return (
    <AdminShell host={host} onLogout={logout}>
      <main className="admin-workspace">
        <div className="admin-mobile-tabs">
          <button
            type="button"
            className={`admin-tab-btn ${activeMobileTab === "library" ? "active" : ""}`}
            onClick={() => setActiveMobileTab("library")}
          >
            📚 <span>Library & Editor</span>
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeMobileTab === "lobby" ? "active" : ""}`}
            onClick={() => setActiveMobileTab("lobby")}
          >
            ⚡ <span>Lobby & Control</span>
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${activeMobileTab === "leaderboard" ? "active" : ""}`}
            onClick={() => setActiveMobileTab("leaderboard")}
          >
            🏆 <span>Live Leaderboard</span>
          </button>
        </div>

        <div className={`admin-tab-content ${activeMobileTab === "library" ? "active" : ""}`}>
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Quiz library</h2>
                <p className="notice">Signed in as {host.email || host.displayName}. Create question banks, then run a live session from the selected quiz.</p>
              </div>
              <button className="primary-btn" onClick={createNewQuiz}><Plus size={18} /> New quiz</button>
            </div>
            <div className="quiz-list">
              {quizzes.length === 0 && <p className="empty-state">No saved quizzes yet. Start with a new quiz or load the React starter MCQs.</p>}
              {quizzes.map((quiz) => (
                <button className={`quiz-item ${quiz.id === selectedQuizId ? "active" : ""}`} key={quiz.id} onClick={() => setSelectedQuizId(quiz.id)}>
                  <strong>{quiz.title}</strong>
                  <span>{quiz.questions?.length ?? 0} MCQs</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel" style={{ marginTop: "22px" }}>
            <h2>Past sessions & reports</h2>
            <p className="notice">Permanently archived leaderboards and reports from your ended quiz quiz runs.</p>
            <div className="quiz-list" style={{ maxHeight: "280px", overflowY: "auto", marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {pastSessions.length === 0 && <p className="empty-state">No past sessions archived yet. Click "End" on a live quiz to save its record.</p>}
              {pastSessions.map((ps) => (
                <div
                  className="quiz-item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    cursor: "default"
                  }}
                  key={ps.id}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", textAlign: "left" }}>
                    <strong style={{ color: "var(--ink)" }}>{ps.title}</strong>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                      Code: <strong>{ps.sessionId}</strong> • {ps.players?.length ?? 0} players
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                      Ended: {ps.endedAt?.seconds ? new Date(ps.endedAt.seconds * 1000).toLocaleString() : "Recently"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ padding: "6px 12px", minHeight: "32px", fontSize: "12px" }}
                    onClick={() => setSelectedPastSession(ps)}
                  >
                    View Results
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="editor-grid">
          <div className={`admin-tab-content ${activeMobileTab === "library" ? "active" : ""}`}>
            <form className="panel" onSubmit={saveQuiz}>
              <div className="section-head">
                <h2>MCQ editor</h2>
                <div className="button-row">
                  <button className="ghost-btn" type="button" onClick={useStarterQuestions}><CopyPlus size={18} /> Load starter</button>
                  <button className="primary-btn" type="submit"><Save size={18} /> Save quiz</button>
                  <button className="danger-btn" type="button" onClick={deleteQuiz} disabled={!selectedQuizId}><Trash2 size={18} /> Delete</button>
                </div>
              </div>

              <label className="field">
                <span>Quiz title</span>
                <input value={quizDraft.title} onChange={(event) => setQuizDraft((draft) => ({ ...draft, title: event.target.value }))} />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea value={quizDraft.description ?? ""} onChange={(event) => setQuizDraft((draft) => ({ ...draft, description: event.target.value }))} placeholder="Optional note for this quiz" />
              </label>

              <div className="question-editor-list">
                {quizDraft.questions.map((question, questionIndex) => (
                  <div className="question-editor" key={questionIndex}>
                    <div className="section-head compact">
                      <h3>MCQ {questionIndex + 1}</h3>
                      <div className="button-row">
                        <button className="ghost-btn icon-btn" type="button" onClick={() => duplicateQuestion(questionIndex)} title="Duplicate question"><CopyPlus size={17} /></button>
                        <button className="danger-btn icon-btn" type="button" onClick={() => removeQuestion(questionIndex)} title="Remove question"><Trash2 size={17} /></button>
                      </div>
                    </div>
                    <label className="field">
                      <span>Question</span>
                      <textarea value={question.q} onChange={(event) => updateQuestion(questionIndex, { q: event.target.value })} />
                    </label>
                    <div className="mcq-row">
                      <label className="field">
                        <span>Level</span>
                        <select value={question.level} onChange={(event) => updateQuestion(questionIndex, { level: event.target.value as QuizLevel })}>
                          {levels.map((level) => <option key={level} value={level}>{level}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span>Correct answer</span>
                        <select value={question.ans} onChange={(event) => updateQuestion(questionIndex, { ans: Number(event.target.value) })}>
                          {question.opts.map((_, optionIndex) => <option key={optionIndex} value={optionIndex}>Option {String.fromCharCode(65 + optionIndex)}</option>
                          )}
                        </select>
                      </label>
                    </div>
                    {question.opts.map((option, optionIndex) => (
                      <label className="field" key={optionIndex}>
                        <span>Option {String.fromCharCode(65 + optionIndex)}</span>
                        <input value={option} onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} />
                      </label>
                    ))}
                    <label className="field">
                      <span>Explanation</span>
                      <textarea value={question.exp} onChange={(event) => updateQuestion(questionIndex, { exp: event.target.value })} />
                    </label>
                  </div>
                ))}
              </div>
              <button className="ghost-btn" type="button" onClick={addQuestion}><Plus size={18} /> Add MCQ</button>
            </form>
          </div>

          <section className="side-stack">
            <div className={`admin-tab-content ${activeMobileTab === "lobby" ? "active" : ""}`}>
              <form className="panel" onSubmit={createSession}>
                <h2>Create session</h2>
                
                {!selectedQuizId && (
                  <div style={{
                    background: "rgba(245, 158, 11, 0.12)",
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    marginBottom: "16px",
                    color: "#b45309",
                    fontSize: "13px",
                    textAlign: "left"
                  }}>
                    <strong>⚠️ No Quiz Selected:</strong> Please click on a quiz from the <strong>Quiz Library</strong> panel on the left (or load starter MCQs) to enable hosting a live session.
                  </div>
                )}

                {selectedQuizId && !session && (
                  <div style={{
                    background: "rgba(111, 75, 255, 0.1)",
                    border: "1px solid rgba(111, 75, 255, 0.3)",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    marginBottom: "16px",
                    color: "var(--violet)",
                    fontSize: "13px",
                    textAlign: "left"
                  }}>
                    <strong>✨ Ready to Launch:</strong> Click the button below to initialize the live session lobby for <strong>"{selectedQuiz?.title}"</strong>!
                  </div>
                )}

                {session && (
                  <div style={{
                    background: "rgba(14, 159, 110, 0.12)",
                    border: "1px solid rgba(14, 159, 110, 0.3)",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    marginBottom: "16px",
                    color: "var(--green)",
                    fontSize: "13px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    textAlign: "left"
                  }}>
                    <span style={{
                      display: "inline-block",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "var(--green)",
                      boxShadow: "0 0 8px var(--green)",
                      animation: "pulse 1.5s infinite"
                    }} />
                    <div>
                      Session <strong>{sessionId.trim()}</strong> is active! Players can now join.
                    </div>
                  </div>
                )}

                <label className="field">
                  <span>Session code</span>
                  <input value={sessionId} onChange={(event) => setSessionId(event.target.value.replace(/\s+/g, ""))} />
                </label>
                <label className="field">
                  <span>Question countdown</span>
                  <input type="number" min={5} max={180} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} />
                </label>
                <p className="notice" style={{ textAlign: "left" }}>Selected quiz: {selectedQuiz?.title ?? "none"} ({selectedQuiz?.questions?.length ?? 0} MCQs)</p>
                <button className="primary-btn" type="submit" disabled={!selectedQuizId}><QrCode size={18} /> Create session QR</button>
                {message && <p className="notice" style={{ color: "var(--violet)", fontWeight: 700, textAlign: "left" }}>{message}</p>}
              </form>

              <div className="panel">
                <h2>Join QR</h2>
                <div className="qr-box">{qr ? <img alt="Player join QR code" src={qr} /> : "QR will appear here"}</div>
                <p className="notice" style={{ wordBreak: "break-all" }}>{joinUrl}</p>
                {leaderboardUrl && <a className="ghost-btn wide-btn" href={leaderboardUrl} target="_blank" rel="noreferrer"><Eye size={18} /> Open projector leaderboard</a>}
              </div>

              <div className="question-panel compact-panel" style={{ height: "auto", minHeight: "360px" }}>
                <div className="pulse-bg" />
                <div className="question-content">
                  {!session ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "10px 0" }}>
                      <div className="status-pill" style={{ background: "var(--muted)" }}>No Active Session</div>
                      <h2 style={{ fontSize: "20px", color: "var(--ink)", fontWeight: 800, margin: "8px 0 4px 0", textAlign: "left" }}>
                        Lobby & Live Controls
                      </h2>
                      <p className="notice" style={{ margin: 0, textAlign: "left" }}>
                        Initialize a session lobby to begin hosting the live quiz. Follow these simple steps:
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
                        <div style={{ display: "flex", gap: "10px", background: "rgba(255,255,255,0.7)", padding: "12px", borderRadius: "10px", border: "1px solid var(--line)" }}>
                          <span style={{ fontWeight: 900, color: "var(--violet)", fontSize: "15px" }}>1.</span>
                          <div style={{ textAlign: "left" }}>
                            <strong style={{ display: "block", fontSize: "13px", color: "var(--ink)" }}>Choose a Quiz</strong>
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                              Select any question bank from your **Quiz Library** on the left.
                            </span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "10px", background: "rgba(255,255,255,0.7)", padding: "12px", borderRadius: "10px", border: "1px solid var(--line)" }}>
                          <span style={{ fontWeight: 900, color: "var(--violet)", fontSize: "15px" }}>2.</span>
                          <div style={{ textAlign: "left" }}>
                            <strong style={{ display: "block", fontSize: "13px", color: "var(--ink)" }}>Set the Session Code</strong>
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                              Pick a code (e.g. <strong>{sessionId || "nimma-session"}</strong>) and time limit above.
                            </span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "10px", background: "rgba(255,255,255,0.7)", padding: "12px", borderRadius: "10px", border: "1px solid var(--line)" }}>
                          <span style={{ fontWeight: 900, color: "var(--violet)", fontSize: "15px" }}>3.</span>
                          <div style={{ textAlign: "left" }}>
                            <strong style={{ display: "block", fontSize: "13px", color: "var(--ink)" }}>Open Lobby for Students</strong>
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                              Click **"Create session QR"** to enable real-time joining and launch control buttons here!
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                        <span className="status-pill" style={{
                          background: session.status === "lobby" ? "var(--green)"
                            : session.status === "closed" ? "var(--yellow)"
                             : session.status === "live" ? "var(--red)"
                            : "var(--violet)"
                        }}>
                          Session: {session.status}
                        </span>
                        <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>
                          Question {session.activeQuestion + 1} of {session.questions?.length ?? 0}
                        </span>
                      </div>
                      
                      <h1 className="question-title" style={{ fontSize: "20px", marginTop: "0", marginBottom: "16px", textAlign: "left", fontWeight: 800 }}>
                        {currentSessionQuestion?.q ?? "Ready to host"}
                      </h1>
                      
                      {session.status === "live" && (
                         <div className="timer-strip" style={{ padding: "8px 12px", marginBottom: "14px" }}>
                           <span>Time left</span>
                           <strong style={{ fontSize: "22px" }}>{timeRemaining}s</strong>
                         </div>
                       )}

                       {/* Lobby Join Toggle Controls */}
                       {(session.status === "lobby" || session.status === "closed") && (
                         <div style={{
                           display: "flex",
                           alignItems: "center",
                           gap: "12px",
                           background: "rgba(255, 255, 255, 0.4)",
                           padding: "12px",
                           borderRadius: "10px",
                           border: "1px solid var(--line)",
                           marginBottom: "16px",
                           animation: "fade-in-slide 0.5s ease both"
                         }}>
                           <div style={{ flex: 1, textAlign: "left" }}>
                             <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 800, color: "var(--ink)" }}>Lobby Connection Status</h4>
                             <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "var(--muted)" }}>
                               {session.status === "lobby"
                                 ? "Active — Players can scan the QR code and join the game."
                                 : "Closed — Registration is locked. Ready to start."}
                             </p>
                           </div>
                           {session.status === "lobby" ? (
                             <button
                               type="button"
                               className="danger-btn"
                               style={{
                                 padding: "6px 12px",
                                 minHeight: "34px",
                                 fontSize: "12px",
                                 fontWeight: 800,
                                 background: "rgba(217, 45, 32, 0.15)",
                                 color: "var(--red)",
                                 border: "1px solid rgba(217, 45, 32, 0.2)"
                               }}
                               onClick={() => patchSession({ status: "closed" })}
                             >
                               Close Lobby
                             </button>
                           ) : (
                             <button
                               type="button"
                               className="primary-btn"
                               style={{
                                 padding: "6px 12px",
                                 minHeight: "34px",
                                 fontSize: "12px",
                                 fontWeight: 800,
                                 background: "rgba(14, 159, 110, 0.15)",
                                 color: "var(--green)",
                                 border: "1px solid rgba(14, 159, 110, 0.2)"
                               }}
                               onClick={() => patchSession({ status: "lobby" })}
                             >
                               Open Lobby
                             </button>
                           )}
                         </div>
                       )}

                       {/* Guidance-driven Host Action Buttons */}
                       <div className="button-row" style={{ gap: "8px", marginTop: "12px" }}>
                         <button
                           className="ghost-btn"
                           type="button"
                           onClick={previous}
                           disabled={session.activeQuestion === 0}
                           style={{ padding: "6px 12px", minHeight: "38px", fontSize: "12px" }}
                           title="Back to previous question"
                         >
                           <ChevronLeft size={16} /> Prev
                         </button>

                         <button
                           className="primary-btn"
                           type="button"
                           onClick={start}
                           style={{
                             padding: "6px 14px",
                             minHeight: "38px",
                             fontSize: "12px",
                             background: session.status === "lobby" || session.status === "closed" ? "var(--green)" : "var(--violet)",
                             boxShadow: "none"
                           }}
                           title="Start the round for the current question"
                         >
                           <Play size={16} /> Start Round
                         </button>

                         <button
                           className="ghost-btn"
                           type="button"
                           onClick={showLeaderboard}
                           style={{
                             padding: "6px 12px",
                             minHeight: "38px",
                             fontSize: "12px",
                             borderColor: session.status === "live" ? "var(--violet)" : "var(--line)",
                             color: session.status === "live" ? "var(--violet)" : "var(--ink)"
                           }}
                           title="Display live ranking"
                         >
                           <Trophy size={16} /> Leaderboard
                         </button>

                         <button
                           className="ghost-btn"
                           type="button"
                           onClick={next}
                           disabled={session.activeQuestion >= (session.questions?.length ?? 1) - 1}
                           style={{ padding: "6px 12px", minHeight: "38px", fontSize: "12px" }}
                           title="Move to next question"
                         >
                           Next <ChevronRight size={16} />
                         </button>

                         <button
                           className="danger-btn"
                           type="button"
                           onClick={end}
                           style={{ padding: "6px 12px", minHeight: "38px", fontSize: "12px" }}
                           title="Conclude quiz and view winners podium"
                         >
                           <Square size={16} /> End
                         </button>
                       </div>

                       {/* Actionable OC Guide Note */}
                       <div style={{
                         marginTop: "16px",
                         padding: "10px 12px",
                         background: "rgba(111, 75, 255, 0.06)",
                         borderRadius: "8px",
                         border: "1px solid rgba(111, 75, 255, 0.12)",
                         fontSize: "12px",
                         color: "var(--muted)",
                         textAlign: "left",
                         lineHeight: "1.4"
                       }}>
                         {session.status === "lobby" && (
                           <span>💡 <strong>OC Step:</strong> Wait for students to join in the **Live Leaderboard** tab below. When ready, click **"Start Round"** to launch Question 1.</span>
                         )}
                         {session.status === "closed" && (
                           <span>💡 <strong>OC Step:</strong> Lobby is closed. Click **"Start Round"** to begin Question 1 and start the timer.</span>
                         )}
                         {session.status === "live" && (
                           <span>💡 <strong>OC Step:</strong> Round is active! The timer is running. Once it hits 0, it shifts to the leaderboard automatically. You can also click **"Leaderboard"** early.</span>
                         )}
                         {session.status === "leaderboard" && (
                           <span>💡 <strong>OC Step:</strong> Leaderboard is displaying on projector! Discuss scores, then click **"Next"** to load the next question.</span>
                         )}
                         {session.status === "ended" && (
                           <span>💡 <strong>OC Step:</strong> The competition has finished! Results are saved under **Past sessions & reports** in your library.</span>
                         )}
                       </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className={`admin-tab-content ${activeMobileTab === "leaderboard" ? "active" : ""}`}>
              <div className="panel">
                <h2>Live leaderboard</h2>
                {players.length === 0 && <p className="empty-state">Players appear here after joining.</p>}
                {players.map((player, index) => (
                  <div className="leader-row" key={`${player.indexNo}-${player.name}`}>
                    <span className="rank">{index + 1}</span>
                    <span>
                      <span className="leader-name">{player.name}</span>
                      <span className="leader-index">{player.indexNo}</span>
                    </span>
                    <strong>{player.score}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>
      </main>

      {/* Premium Glassmorphic Results Modal */}
      {selectedPastSession && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: "20px",
          animation: "fade-in-slide 0.3s ease both"
        }}>
          <div className="panel" style={{
            width: "100%",
            maxWidth: "600px",
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            background: "rgba(255, 255, 255, 0.95)",
            border: "1px solid var(--line)",
            borderRadius: "16px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
            padding: "24px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <span className="status-pill" style={{ background: "rgba(14, 159, 110, 0.15)", color: "var(--green)" }}>Archived Report</span>
                <h2 style={{ marginTop: "8px", marginBottom: "4px", color: "var(--ink)", textAlign: "left" }}>{selectedPastSession.title}</h2>
                <p className="notice" style={{ margin: 0, textAlign: "left" }}>
                  Code: <strong>{selectedPastSession.sessionId}</strong> • Ended {selectedPastSession.endedAt?.seconds ? new Date(selectedPastSession.endedAt.seconds * 1000).toLocaleString() : "Recently"}
                </p>
              </div>
              <button
                type="button"
                className="ghost-btn"
                style={{ padding: "6px 12px", minHeight: "32px", fontSize: "13px" }}
                onClick={() => setSelectedPastSession(null)}
              >
                Close
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", marginTop: "10px", paddingRight: "4px" }}>
              <h3 style={{ fontSize: "14px", color: "var(--muted)", textTransform: "uppercase", marginBottom: "12px", letterSpacing: "0.05em", textAlign: "left" }}>
                Final Leaderboard ({selectedPastSession.players?.length ?? 0} participants)
              </h3>
              {(selectedPastSession.players ?? []).length === 0 ? (
                <p className="empty-state">No players participated in this session.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {(selectedPastSession.players ?? []).map((player: any, index: number) => (
                    <div className="leader-row" key={`${player.indexNo}-${player.name}-${index}`} style={{ margin: 0 }}>
                      <span className="rank">{index + 1}</span>
                      <span>
                        <span className="leader-name" style={{ color: "var(--ink)" }}>{player.name}</span>
                        <span className="leader-index">{player.indexNo}</span>
                      </span>
                      <strong>{player.score}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function AdminShell({ children, host, onLogout }: { children: React.ReactNode; host: User | null; onLogout?: () => void }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Trophy size={22} /></span> Nimma Quiz Host</div>
        <div className="button-row">
          {host && <span className="host-chip">{host.displayName ?? host.email}</span>}
          <Link className="nav-link" href="/">Player page</Link>
          {host && <button className="ghost-btn" type="button" onClick={onLogout}><LogOut size={17} /> Sign out</button>}
        </div>
      </header>
      <div className="stage">{children}</div>
    </div>
  );
}
