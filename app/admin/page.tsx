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
                  placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
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

  // â”€â”€ STAGE LOGIC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // stage 1: no session exists yet  â†’ Setup
  // stage 2: session.status=lobby/closed â†’ Lobby
  // stage 3: session.status=live/leaderboard â†’ Live Control
  // stage 4: session.status=ended â†’ Results
  const stage: "setup" | "lobby" | "live" | "ended" =
    !session ? "setup"
    : session.status === "ended" ? "ended"
    : session.status === "live" || session.status === "leaderboard" ? "live"
    : "lobby";

  const stageSteps = [
    { key: "setup",  label: "1  Setup",   icon: "ðŸ“‹" },
    { key: "lobby",  label: "2  Lobby",   icon: "ðŸŽ®" },
    { key: "live",   label: "3  Live",    icon: "âš¡" },
    { key: "ended",  label: "4  Results", icon: "ðŸ†" },
  ];

  return (
    <AdminShell host={host} onLogout={logout}>

      {/* â”€â”€ Stage progress bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={{
        display: "flex", alignItems: "stretch",
        background: "rgba(255,255,255,0.7)",
        borderBottom: "1px solid var(--line)",
        backdropFilter: "blur(8px)",
        position: "sticky", top: "60px", zIndex: 100,
        overflow: "hidden"
      }}>
        {stageSteps.map((s, i) => {
          const isActive = s.key === stage;
          const isDone   = stageSteps.findIndex(x => x.key === stage) > i;
          return (
            <div key={s.key} style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: "12px 8px", gap: "4px",
              background: isActive ? "rgba(124,58,237,0.08)" : "transparent",
              borderBottom: isActive ? "3px solid var(--violet)" : "3px solid transparent",
              transition: "all 0.3s ease"
            }}>
              <span style={{ fontSize: "18px" }}>{isDone ? "âœ…" : s.icon}</span>
              <span style={{
                fontSize: "11px", fontWeight: isActive ? 900 : 600,
                color: isActive ? "var(--violet)" : isDone ? "var(--green)" : "var(--muted)",
                textAlign: "center", whiteSpace: "nowrap"
              }}>{s.label}</span>
            </div>
          );
        })}
      </div>

      <main style={{ padding: "24px 20px", maxWidth: "1100px", margin: "0 auto" }}>

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            STAGE 1 â€” SETUP: Pick quiz, configure session, create lobby
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {stage === "setup" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>

            {/* Left: Quiz Library + Editor */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* Quiz Library */}
              <div className="panel">
                <div className="section-head">
                  <div>
                    <h2>ðŸ“š Quiz Library</h2>
                    <p className="notice">Select a quiz to host, or create a new one.</p>
                  </div>
                  <button className="primary-btn" onClick={createNewQuiz}><Plus size={16} /> New</button>
                </div>
                <div className="quiz-list" style={{ marginTop: "12px" }}>
                  {quizzes.length === 0 && (
                    <p className="empty-state">No quizzes yet. Create one or load starter MCQs.</p>
                  )}
                  {quizzes.map((quiz) => (
                    <button
                      className={`quiz-item ${quiz.id === selectedQuizId ? "active" : ""}`}
                      key={quiz.id}
                      onClick={() => setSelectedQuizId(quiz.id)}
                    >
                      <strong>{quiz.title}</strong>
                      <span>{quiz.questions?.length ?? 0} MCQs</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Past Sessions */}
              <div className="panel">
                <h2>ðŸ—‚ï¸ Past Sessions</h2>
                <p className="notice">Archived results from previous quiz runs.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px", maxHeight: "220px", overflowY: "auto" }}>
                  {pastSessions.length === 0 && <p className="empty-state">No past sessions yet.</p>}
                  {pastSessions.map((ps) => (
                    <div className="quiz-item" key={ps.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "default" }}>
                      <div>
                        <strong style={{ display: "block", fontSize: "13px" }}>{ps.title}</strong>
                        <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                          {ps.sessionId} Â· {ps.players?.length ?? 0} players Â· {ps.endedAt?.seconds ? new Date(ps.endedAt.seconds * 1000).toLocaleDateString() : "Recent"}
                        </span>
                      </div>
                      <button className="ghost-btn" style={{ padding: "4px 10px", fontSize: "12px", minHeight: "30px" }} onClick={() => setSelectedPastSession(ps)}>
                        View
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Quiz Editor + Session Setup */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* MCQ Editor */}
              <form className="panel" onSubmit={saveQuiz}>
                <div className="section-head">
                  <h2>âœï¸ MCQ Editor</h2>
                  <div className="button-row">
                    <button className="ghost-btn" type="button" onClick={useStarterQuestions}><CopyPlus size={16} /> Starter</button>
                    <button className="primary-btn" type="submit"><Save size={16} /> Save</button>
                    <button className="danger-btn" type="button" onClick={deleteQuiz} disabled={!selectedQuizId}><Trash2 size={16} /></button>
                  </div>
                </div>
                <label className="field" style={{ marginTop: "12px" }}>
                  <span>Quiz title</span>
                  <input value={quizDraft.title} onChange={(e) => setQuizDraft((d) => ({ ...d, title: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Description</span>
                  <textarea value={quizDraft.description ?? ""} onChange={(e) => setQuizDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Optional note" />
                </label>
                <div className="question-editor-list">
                  {quizDraft.questions.map((question, qi) => (
                    <div className="question-editor" key={qi}>
                      <div className="section-head compact">
                        <h3>MCQ {qi + 1}</h3>
                        <div className="button-row">
                          <button className="ghost-btn icon-btn" type="button" onClick={() => duplicateQuestion(qi)}><CopyPlus size={15} /></button>
                          <button className="danger-btn icon-btn" type="button" onClick={() => removeQuestion(qi)}><Trash2 size={15} /></button>
                        </div>
                      </div>
                      <label className="field">
                        <span>Question</span>
                        <textarea value={question.q} onChange={(e) => updateQuestion(qi, { q: e.target.value })} />
                      </label>
                      <div className="mcq-row">
                        <label className="field">
                          <span>Level</span>
                          <select value={question.level} onChange={(e) => updateQuestion(qi, { level: e.target.value as QuizLevel })}>
                            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </label>
                        <label className="field">
                          <span>Correct answer</span>
                          <select value={question.ans} onChange={(e) => updateQuestion(qi, { ans: Number(e.target.value) })}>
                            {question.opts.map((_, oi) => <option key={oi} value={oi}>Option {String.fromCharCode(65 + oi)}</option>)}
                          </select>
                        </label>
                      </div>
                      {question.opts.map((opt, oi) => (
                        <label className="field" key={oi}>
                          <span>Option {String.fromCharCode(65 + oi)}</span>
                          <input value={opt} onChange={(e) => updateOption(qi, oi, e.target.value)} />
                        </label>
                      ))}
                      <label className="field">
                        <span>Explanation</span>
                        <textarea value={question.exp} onChange={(e) => updateQuestion(qi, { exp: e.target.value })} />
                      </label>
                    </div>
                  ))}
                </div>
                <button className="ghost-btn" type="button" onClick={addQuestion}><Plus size={16} /> Add MCQ</button>
              </form>

              {/* Session Setup */}
              <form className="panel" onSubmit={createSession} style={{ border: "2px solid rgba(124,58,237,0.25)", background: "rgba(124,58,237,0.03)" }}>
                <h2 style={{ color: "var(--violet)" }}>ðŸš€ Create Session</h2>
                <p className="notice" style={{ marginBottom: "16px" }}>
                  After saving your quiz above, configure and launch a lobby here. Each quiz run needs its own unique session code.
                </p>

                {!selectedQuizId && (
                  <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "10px", padding: "12px 14px", marginBottom: "14px", color: "#b45309", fontSize: "13px" }}>
                    âš ï¸ <strong>Select a quiz</strong> from the library on the left first.
                  </div>
                )}
                {selectedQuizId && (
                  <div style={{ background: "rgba(14,159,110,0.08)", border: "1px solid rgba(14,159,110,0.2)", borderRadius: "10px", padding: "10px 14px", marginBottom: "14px", color: "var(--green)", fontSize: "13px" }}>
                    âœ… Using: <strong>{selectedQuiz?.title}</strong> ({selectedQuiz?.questions?.length ?? 0} questions)
                  </div>
                )}

                <label className="field">
                  <span>Session code (unique per run)</span>
                  <input value={sessionId} onChange={(e) => setSessionId(e.target.value.replace(/\s+/g, ""))} placeholder="nimma-20260522" />
                </label>
                <label className="field">
                  <span>Seconds per question</span>
                  <input type="number" min={5} max={180} value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} />
                </label>

                <button className="primary-btn" type="submit" disabled={!selectedQuizId} style={{ width: "100%", marginTop: "4px", fontSize: "15px", padding: "14px" }}>
                  <QrCode size={18} /> Open Lobby â†’ Next Step
                </button>
                {message && <p className="notice" style={{ color: "var(--violet)", fontWeight: 700, marginTop: "10px" }}>{message}</p>}
              </form>

            </div>
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            STAGE 2 â€” LOBBY: Show QR, wait for players, start when ready
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {stage === "lobby" && session && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>

            {/* Left: QR + Join info */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div className="panel" style={{ textAlign: "center" }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: "8px",
                  background: session.status === "lobby" ? "rgba(14,159,110,0.12)" : "rgba(245,158,11,0.12)",
                  border: `1px solid ${session.status === "lobby" ? "rgba(14,159,110,0.3)" : "rgba(245,158,11,0.3)"}`,
                  borderRadius: "999px", padding: "6px 16px", marginBottom: "16px"
                }}>
                  <span style={{
                    width: "8px", height: "8px", borderRadius: "50%",
                    background: session.status === "lobby" ? "var(--green)" : "var(--yellow)",
                    display: "inline-block", animation: "pulse 1.2s ease infinite",
                    boxShadow: `0 0 6px ${session.status === "lobby" ? "var(--green)" : "var(--yellow)"}`
                  }} />
                  <strong style={{ fontSize: "13px", color: session.status === "lobby" ? "var(--green)" : "#b45309" }}>
                    {session.status === "lobby" ? "Lobby Open â€” Players Can Join" : "Lobby Closed â€” Ready to Start"}
                  </strong>
                </div>

                <h2 style={{ margin: "0 0 4px" }}>{session.title}</h2>
                <p className="notice" style={{ marginBottom: "16px" }}>
                  Session code: <strong style={{ fontSize: "18px", color: "var(--violet)" }}>{sessionId}</strong>
                </p>

                <div className="qr-box" style={{ margin: "0 auto 16px" }}>
                  {qr ? <img alt="QR code" src={qr} /> : "Generating QRâ€¦"}
                </div>
                <p className="notice" style={{ wordBreak: "break-all", fontSize: "12px" }}>{joinUrl}</p>

                <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                  {session.status === "lobby" ? (
                    <button className="danger-btn" style={{ flex: 1 }} onClick={() => patchSession({ status: "closed" })}>
                      ðŸ”’ Close Lobby
                    </button>
                  ) : (
                    <button className="primary-btn" style={{ flex: 1, background: "var(--green)" }} onClick={() => patchSession({ status: "lobby" })}>
                      ðŸ”“ Reopen Lobby
                    </button>
                  )}
                  {leaderboardUrl && (
                    <a className="ghost-btn" href={leaderboardUrl} target="_blank" rel="noreferrer" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", textDecoration: "none" }}>
                      <Eye size={16} /> Projector View
                    </a>
                  )}
                </div>
              </div>

              {/* Quiz summary */}
              <div className="panel">
                <h3 style={{ margin: "0 0 10px", fontSize: "14px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Quiz Summary</h3>
                <p style={{ margin: "0 0 6px", fontWeight: 800, fontSize: "16px" }}>{session.title}</p>
                <p className="notice" style={{ margin: 0 }}>{session.questions?.length ?? 0} questions Â· {session.durationSeconds}s per question</p>
              </div>
            </div>

            {/* Right: Players list + Start control */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* Start button â€” the main CTA */}
              <div className="panel" style={{ border: "2px solid rgba(124,58,237,0.3)", background: "rgba(124,58,237,0.04)", textAlign: "center" }}>
                <h2 style={{ color: "var(--violet)", margin: "0 0 8px" }}>Ready to start?</h2>
                <p className="notice" style={{ marginBottom: "20px" }}>
                  {players.length === 0
                    ? "No players yet â€” share the QR code and wait for them to join."
                    : `${players.length} player${players.length === 1 ? "" : "s"} joined and waiting!`}
                </p>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={start}
                  disabled={players.length === 0}
                  style={{ width: "100%", fontSize: "16px", padding: "16px", background: players.length > 0 ? "var(--violet)" : undefined }}
                >
                  <Play size={20} /> Start Quiz Now!
                </button>
                {players.length === 0 && (
                  <p className="notice" style={{ marginTop: "10px", color: "var(--muted)" }}>Waiting for at least 1 player to joinâ€¦</p>
                )}
              </div>

              {/* Live players */}
              <div className="panel" style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h2 style={{ margin: 0 }}>ðŸ‘¥ Players Joined</h2>
                  <span style={{ background: "var(--violet)", color: "#fff", borderRadius: "999px", padding: "2px 12px", fontWeight: 900, fontSize: "16px" }}>
                    {players.length}
                  </span>
                </div>
                {players.length === 0 && <p className="empty-state">No players yet â€” share the QR code!</p>}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "400px", overflowY: "auto" }}>
                  {players.map((p, i) => (
                    <div key={`${p.name}-${p.indexNo}`} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      background: "rgba(255,255,255,0.85)", border: "1px solid var(--line)",
                      borderRadius: "10px", padding: "10px 14px",
                      animation: "row-pop 400ms ease both", animationDelay: `${i * 30}ms`
                    }}>
                      <div style={{
                        width: "32px", height: "32px", borderRadius: "50%",
                        background: `hsl(${(i * 47) % 360},70%,58%)`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontWeight: 900, fontSize: "14px", flexShrink: 0
                      }}>
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, overflow: "hidden" }}>
                        <div style={{ fontWeight: 700, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div style={{ fontSize: "11px", color: "var(--muted)" }}>{p.indexNo}</div>
                      </div>
                      <span style={{ fontWeight: 900, fontSize: "13px", color: "var(--green)" }}>âœ“</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            STAGE 3 â€” LIVE: Control questions, view leaderboard
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {stage === "live" && session && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "24px" }}>

            {/* Left: Question control panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* Status bar */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: session.status === "live" ? "rgba(239,68,68,0.08)" : "rgba(124,58,237,0.08)",
                border: `1px solid ${session.status === "live" ? "rgba(239,68,68,0.2)" : "rgba(124,58,237,0.2)"}`,
                borderRadius: "12px", padding: "14px 18px"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{
                    width: "10px", height: "10px", borderRadius: "50%",
                    background: session.status === "live" ? "var(--red)" : "var(--violet)",
                    display: "inline-block", animation: "pulse 1s ease infinite",
                    boxShadow: `0 0 8px ${session.status === "live" ? "var(--red)" : "var(--violet)"}`
                  }} />
                  <strong style={{ fontSize: "15px", color: session.status === "live" ? "var(--red)" : "var(--violet)" }}>
                    {session.status === "live" ? "ðŸ”´ LIVE â€” Round Running" : "ðŸ“Š Leaderboard Showing"}
                  </strong>
                </div>
                <div style={{ fontWeight: 800, color: "var(--muted)", fontSize: "14px" }}>
                  Q {session.activeQuestion + 1} / {session.questions?.length ?? 0}
                </div>
              </div>

              {/* Timer (only during live) */}
              {session.status === "live" && (
                <div style={{
                  textAlign: "center", padding: "20px",
                  background: timeRemaining <= 5 ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.7)",
                  border: `2px solid ${timeRemaining <= 5 ? "rgba(239,68,68,0.3)" : "var(--line)"}`,
                  borderRadius: "16px"
                }}>
                  <div style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>Time Remaining</div>
                  <div style={{
                    fontSize: "72px", fontWeight: 900, lineHeight: 1,
                    color: timeRemaining <= 5 ? "var(--red)" : timeRemaining <= 10 ? "var(--yellow)" : "var(--green)",
                    transition: "color 0.5s"
                  }}>
                    {timeRemaining}
                  </div>
                  <div style={{ fontSize: "14px", color: "var(--muted)", marginTop: "6px" }}>seconds</div>
                  <div style={{ margin: "12px auto 0", height: "6px", width: "80%", background: "rgba(0,0,0,0.07)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${(timeRemaining / (session.durationSeconds ?? 20)) * 100}%`,
                      background: timeRemaining <= 5 ? "var(--red)" : timeRemaining <= 10 ? "var(--yellow)" : "var(--green)",
                      borderRadius: "99px", transition: "width 0.25s linear, background 0.5s"
                    }} />
                  </div>
                </div>
              )}

              {/* Current question */}
              <div className="panel">
                <div style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                  Current Question
                </div>
                <h2 style={{ margin: "0 0 16px", lineHeight: "1.4", fontSize: "18px" }}>
                  {currentSessionQuestion?.q ?? "â€”"}
                </h2>
                {currentSessionQuestion && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    {currentSessionQuestion.opts.map((opt, i) => (
                      <div key={i} style={{
                        padding: "10px 12px", borderRadius: "10px",
                        background: i === currentSessionQuestion.ans ? "rgba(14,159,110,0.1)" : "rgba(0,0,0,0.03)",
                        border: `1px solid ${i === currentSessionQuestion.ans ? "rgba(14,159,110,0.3)" : "var(--line)"}`,
                        fontSize: "13px", fontWeight: i === currentSessionQuestion.ans ? 800 : 500,
                        color: i === currentSessionQuestion.ans ? "var(--green)" : "var(--ink)"
                      }}>
                        <span style={{ fontWeight: 900, marginRight: "6px" }}>{String.fromCharCode(65 + i)}.</span>
                        {opt}
                        {i === currentSessionQuestion.ans && <span style={{ float: "right" }}>âœ“</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Control buttons */}
              <div className="panel">
                <h3 style={{ margin: "0 0 14px", fontSize: "13px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Quiz Controls</h3>

                {/* Context tip */}
                <div style={{
                  padding: "10px 14px", borderRadius: "10px", marginBottom: "14px",
                  background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)",
                  fontSize: "13px", color: "var(--violet)", lineHeight: "1.5"
                }}>
                  {session.status === "live" && "â³ Timer is running. Click <strong>Show Leaderboard</strong> early, or wait for auto-end."}
                  {session.status === "leaderboard" && "ðŸ“Š Leaderboard is visible. Click <strong>Next Question</strong> to continue, or <strong>End Quiz</strong> if done."}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <button className="ghost-btn" onClick={previous} disabled={session.activeQuestion === 0}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <ChevronLeft size={16} /> Prev Q
                  </button>

                  <button className="ghost-btn" onClick={next}
                    disabled={session.activeQuestion >= (session.questions?.length ?? 1) - 1}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    Next Q <ChevronRight size={16} />
                  </button>

                  <button className="primary-btn" onClick={showLeaderboard}
                    style={{ background: "var(--violet)", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <Trophy size={16} /> Show Leaderboard
                  </button>

                  <button className="primary-btn" onClick={start}
                    style={{ background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <Play size={16} /> Start/Restart Round
                  </button>

                  <button className="danger-btn" onClick={end}
                    style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "12px" }}>
                    <Square size={16} /> End Quiz & Save Results
                  </button>
                </div>

                {leaderboardUrl && (
                  <a className="ghost-btn wide-btn" href={leaderboardUrl} target="_blank" rel="noreferrer"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginTop: "10px", textDecoration: "none" }}>
                    <Eye size={16} /> Open Projector Leaderboard
                  </a>
                )}
              </div>
            </div>

            {/* Right: Live leaderboard */}
            <div className="panel" style={{ position: "sticky", top: "120px", alignSelf: "start" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <h2 style={{ margin: 0 }}>ðŸ† Live Leaderboard</h2>
                <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--muted)" }}>{players.length} players</span>
              </div>
              {players.length === 0 && <p className="empty-state">No answers yet.</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "600px", overflowY: "auto" }}>
                {players.map((p, i) => (
                  <div key={`${p.name}-${p.indexNo}`} style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "10px 14px", borderRadius: "10px",
                    background: i === 0 ? "rgba(251,191,36,0.1)" : "rgba(255,255,255,0.7)",
                    border: `1px solid ${i === 0 ? "rgba(251,191,36,0.3)" : "var(--line)"}`,
                  }}>
                    <span style={{ fontWeight: 900, minWidth: "28px", fontSize: i < 3 ? "18px" : "14px", textAlign: "center" }}>
                      {i === 0 ? "ðŸ¥‡" : i === 1 ? "ðŸ¥ˆ" : i === 2 ? "ðŸ¥‰" : `#${i + 1}`}
                    </span>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ fontWeight: 700, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>{p.indexNo}</div>
                    </div>
                    <strong style={{ fontSize: "16px", color: "var(--violet)" }}>{p.score}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            STAGE 4 â€” ENDED: Final results + run again
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {stage === "ended" && session && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>

            {/* Left: Summary + New Session CTA */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div className="panel" style={{ textAlign: "center", border: "2px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.04)" }}>
                <div style={{ fontSize: "64px", marginBottom: "12px" }}>ðŸ†</div>
                <div className="eyebrow">Quiz Complete!</div>
                <h1 style={{ margin: "8px 0 4px" }}>{session.title}</h1>
                <p className="notice">{players.length} participants Â· Session: <strong>{sessionId}</strong></p>
                <p className="notice" style={{ marginBottom: "20px" }}>Results have been archived automatically in Past Sessions.</p>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{
                    padding: "14px", background: "rgba(14,159,110,0.08)",
                    border: "1px solid rgba(14,159,110,0.2)", borderRadius: "12px",
                    fontSize: "13px", color: "var(--green)", fontWeight: 700
                  }}>
                    âœ… Results saved to Past Sessions
                  </div>

                  <button className="primary-btn" style={{ fontSize: "15px", padding: "14px" }}
                    onClick={() => {
                      setSessionId(defaultSessionCode());
                      setSession(null);
                    }}>
                    <Plus size={18} /> Run Another Session
                  </button>

                  {leaderboardUrl && (
                    <a className="ghost-btn" href={leaderboardUrl} target="_blank" rel="noreferrer"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", textDecoration: "none", padding: "12px" }}>
                      <Eye size={16} /> View Final Projector Podium
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Final leaderboard */}
            <div className="panel">
              <h2 style={{ margin: "0 0 14px" }}>ðŸŽ–ï¸ Final Standings</h2>
              {players.length === 0 && <p className="empty-state">No participants.</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {players.map((p, i) => (
                  <div key={`${p.name}-${p.indexNo}`} style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "12px 16px", borderRadius: "12px",
                    background: i === 0 ? "rgba(251,191,36,0.12)" : i === 1 ? "rgba(203,213,225,0.15)" : i === 2 ? "rgba(249,115,22,0.08)" : "rgba(255,255,255,0.7)",
                    border: `1px solid ${i === 0 ? "rgba(251,191,36,0.3)" : i === 1 ? "rgba(203,213,225,0.3)" : i === 2 ? "rgba(249,115,22,0.2)" : "var(--line)"}`,
                  }}>
                    <span style={{ fontWeight: 900, minWidth: "32px", fontSize: i < 3 ? "22px" : "15px", textAlign: "center" }}>
                      {i === 0 ? "ðŸ¥‡" : i === 1 ? "ðŸ¥ˆ" : i === 2 ? "ðŸ¥‰" : `#${i + 1}`}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: "15px" }}>{p.name}</div>
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>{p.indexNo}</div>
                    </div>
                    <strong style={{ fontSize: "18px", color: "var(--violet)" }}>{p.score}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* â”€â”€ Past session results modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {selectedPastSession && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, padding: "20px", animation: "fade-in-slide 0.3s ease both"
        }}>
          <div className="panel" style={{
            width: "100%", maxWidth: "560px", maxHeight: "80vh",
            display: "flex", flexDirection: "column",
            background: "rgba(255,255,255,0.97)", borderRadius: "16px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <span className="status-pill" style={{ background: "rgba(14,159,110,0.15)", color: "var(--green)" }}>Archived</span>
                <h2 style={{ margin: "8px 0 2px", textAlign: "left" }}>{selectedPastSession.title}</h2>
                <p className="notice" style={{ margin: 0, textAlign: "left" }}>
                  {selectedPastSession.sessionId} Â· {selectedPastSession.players?.length ?? 0} players Â· {selectedPastSession.endedAt?.seconds ? new Date(selectedPastSession.endedAt.seconds * 1000).toLocaleString() : "Recent"}
                </p>
              </div>
              <button className="ghost-btn" style={{ padding: "6px 14px", minHeight: "32px" }} onClick={() => setSelectedPastSession(null)}>âœ• Close</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {(selectedPastSession.players ?? []).length === 0
                ? <p className="empty-state">No players participated.</p>
                : (selectedPastSession.players ?? []).map((p: any, i: number) => (
                    <div className="leader-row" key={`${p.name}-${i}`}>
                      <span className="rank">{i + 1}</span>
                      <span>
                        <span className="leader-name">{p.name}</span>
                        <span className="leader-index">{p.indexNo}</span>
                      </span>
                      <strong>{p.score}</strong>
                    </div>
                  ))
              }
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

