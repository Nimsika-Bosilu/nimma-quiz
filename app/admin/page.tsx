"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import QRCode from "qrcode";
import { ChevronLeft, ChevronRight, CopyPlus, Eye, LogIn, LogOut, Play, Plus, QrCode, Save, Square, Timer, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { getDb, getFirebaseAuth, hasFirebaseConfig, signInHostWithGoogle, signOutHost } from "@/lib/firebase";
import { createBlankQuestion, Question, questions as starterQuestions, QuizDoc, QuizLevel } from "@/lib/quiz";

type SessionStatus = "lobby" | "live" | "leaderboard" | "ended";

type Session = {
  title: string;
  status: SessionStatus;
  activeQuestion: number;
  quizId?: string;
  questions: Question[];
  questionStartedAt?: number;
  durationSeconds?: number;
  hostUid?: string;
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
    const quizQuery = query(collection(getDb(), "quizzes"), orderBy("updatedAt", "desc"));
    return onSnapshot(quizQuery, (snap) => {
      const rows = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }) as QuizWithId)
        .filter((quiz) => !quiz.ownerUid || quiz.ownerUid === host.uid);
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
            <p className="lead">Sign in with Gmail to create quizzes, launch live sessions, and control the competition flow.</p>
          </div>
          <div className="join-panel">
            <button className="primary-btn" type="button" onClick={loginWithGoogle}><LogIn size={18} /> Continue with Gmail</button>
            {message && <p className="notice">{message}</p>}
          </div>
        </section>
      </AdminShell>
    );
  }

  return (
    <AdminShell host={host} onLogout={logout}>
      <main className="admin-workspace">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Quiz library</h2>
              <p className="notice">Signed in as {host.email}. Create question banks, then run a live session from the selected quiz.</p>
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

        <section className="editor-grid">
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
                        {question.opts.map((_, optionIndex) => <option key={optionIndex} value={optionIndex}>Option {String.fromCharCode(65 + optionIndex)}</option>)}
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

          <section className="side-stack">
            <form className="panel" onSubmit={createSession}>
              <h2>Create session</h2>
              <label className="field">
                <span>Session code</span>
                <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
              </label>
              <label className="field">
                <span>Question countdown</span>
                <input type="number" min={5} max={180} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} />
              </label>
              <p className="notice">Selected quiz: {selectedQuiz?.title ?? "none"} ({selectedQuiz?.questions?.length ?? 0} MCQs)</p>
              <button className="primary-btn" type="submit" disabled={!selectedQuizId}><QrCode size={18} /> Create session QR</button>
              {message && <p className="notice">{message}</p>}
            </form>

            <div className="panel">
              <h2>Join QR</h2>
              <div className="qr-box">{qr ? <img alt="Player join QR code" src={qr} /> : "QR will appear here"}</div>
              <p className="notice">{joinUrl}</p>
              {leaderboardUrl && <a className="ghost-btn wide-btn" href={leaderboardUrl} target="_blank" rel="noreferrer"><Eye size={18} /> Open projector leaderboard</a>}
            </div>

            <div className="question-panel compact-panel">
              <div className="pulse-bg" />
              <div className="question-content">
                <span className="status-pill">{session?.status ?? "No session"}</span>
                <h1 className="question-title">{currentSessionQuestion?.q ?? "Create the lobby first"}</h1>
                {session?.status === "live" && (
                  <div className="timer-strip">
                    <span>Time left</span>
                    <strong>{timeRemaining}s</strong>
                  </div>
                )}
                <div className="button-row">
                  <button className="ghost-btn" type="button" onClick={previous} disabled={!session || session.activeQuestion === 0}><ChevronLeft size={18} /> Previous</button>
                  <button className="primary-btn" type="button" onClick={start} disabled={!session}><Play size={18} /> Start</button>
                  <button className="ghost-btn" type="button" onClick={showLeaderboard} disabled={!session}><Timer size={18} /> Show leaderboard</button>
                  <button className="ghost-btn" type="button" onClick={next} disabled={!session || session.activeQuestion >= (session.questions?.length ?? 1) - 1}><ChevronRight size={18} /> Next</button>
                  <button className="danger-btn" type="button" onClick={end} disabled={!session}><Square size={18} /> End</button>
                </div>
                {session && <p className="notice">Question {session.activeQuestion + 1} of {session.questions?.length ?? 0}</p>}
              </div>
            </div>

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
          </section>
        </section>
      </main>
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
