"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { UserPlus, Zap } from "lucide-react";
import { getAnonymousUser, getDb, hasFirebaseConfig } from "@/lib/firebase";
import { Question, scoreForAnswer } from "@/lib/quiz";

type Session = {
  title: string;
  status: "lobby" | "closed" | "live" | "leaderboard" | "ended";
  activeQuestion: number;
  quizId?: string;
  questions: Question[];
  questionStartedAt?: number;
  durationSeconds?: number;
};

type Player = {
  name: string;
  indexNo: string;
  score: number;
  answers?: Record<string, unknown>;
};

export default function HomePage() {
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [uid, setUid] = useState("");
  const [name, setName] = useState("");
  const [indexNo, setIndexNo] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "info" | "success">("error");
  const [joining, setJoining] = useState(false);
  const [leaders, setLeaders] = useState<Player[]>([]);
  const [timeRemaining, setTimeRemaining] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("session") ?? "";
    setSessionId(code.trim());
  }, []);

  useEffect(() => {
    const cleanSessionId = sessionId.trim();
    if (!hasFirebaseConfig || !cleanSessionId) return;
    const db = getDb();
    const unsubSession = onSnapshot(doc(db, "sessions", cleanSessionId), (snap) => {
      setSession(snap.exists() ? snap.data() as Session : null);
    });
    const unsubLeaders = onSnapshot(collection(db, "sessions", cleanSessionId, "players"), (snap) => {
      const rows = snap.docs.map((item) => item.data() as Player);
      setLeaders(rows.sort((a, b) => b.score - a.score).slice(0, 8));
    });
    return () => {
      unsubSession();
      unsubLeaders();
    };
  }, [sessionId]);

  useEffect(() => {
    const cleanSessionId = sessionId.trim();
    if (!hasFirebaseConfig || !cleanSessionId || !uid) return;
    return onSnapshot(doc(getDb(), "sessions", cleanSessionId, "players", uid), (snap) => {
      if (snap.exists()) setPlayer(snap.data() as Player);
    });
  }, [sessionId, uid]);

  const activeQuestion = useMemo(() => {
    const sessionQuestions = session?.questions ?? [];
    if (!session || session.activeQuestion >= sessionQuestions.length) return null;
    return sessionQuestions[session.activeQuestion];
  }, [session]);

  const answered = Boolean(player?.answers?.[String(session?.activeQuestion ?? "")]);

  useEffect(() => {
    if (!session?.questionStartedAt || session.status !== "live") {
      setTimeRemaining(0);
      return;
    }

    const tick = () => {
      const duration = (session.durationSeconds ?? 20) * 1000;
      const left = Math.max(0, Math.ceil((session.questionStartedAt! + duration - Date.now()) / 1000));
      setTimeRemaining(left);
    };

    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [session]);

  async function joinSession(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setMessageType("error");

    if (!hasFirebaseConfig) {
      setMessage("Firebase is not configured yet. Add .env.local values first.");
      return;
    }
    if (!sessionId.trim() || !name.trim() || !indexNo.trim()) {
      setMessage("Enter the session code, your name, and university registration index.");
      return;
    }

    setJoining(true);

    // Stage 1: Read session from Firestore
    let sessionData: Session;
    try {
      const db = getDb();
      const sessionSnap = await getDoc(doc(db, "sessions", sessionId.trim()));
      if (!sessionSnap.exists()) {
        setMessage("❌ Session not found. Double-check the session code and try again.");
        setJoining(false);
        return;
      }
      sessionData = sessionSnap.data() as Session;
    } catch (err: any) {
      setMessage("🌐 Cannot reach Firebase. Check your internet connection and try again.");
      setJoining(false);
      return;
    }

    if (sessionData.status === "closed") {
      setMessageType("info");
      setMessage("🔒 The lobby is currently closed. The quiz will start shortly — please wait.");
      setJoining(false);
      return;
    }
    if (sessionData.status !== "lobby") {
      setMessage("⛔ This quiz has already started. New students cannot join after the game begins.");
      setJoining(false);
      return;
    }

    // Stage 2: Anonymous sign-in
    let uid: string;
    try {
      const user = await getAnonymousUser();
      uid = user.uid;
    } catch (err: any) {
      console.error("Anonymous sign-in error:", err);
      setMessage("🔐 Anonymous sign-in failed. Go to Firebase Console → Authentication → Sign-in method → Enable Anonymous.");
      setJoining(false);
      return;
    }

    // Stage 3: Write player document to Firestore
    try {
      const db = getDb();
      const cleanPlayer = {
        name: name.trim(),
        indexNo: indexNo.trim(),
        score: 0,
        answers: {},
        joinedAt: serverTimestamp(),
        lastSeen: serverTimestamp()
      };
      await setDoc(doc(db, "sessions", sessionId.trim(), "players", uid), cleanPlayer, { merge: true });
      setUid(uid);
      setPlayer(cleanPlayer);
      setMessageType("success");
      setMessage("✅ Joined! Waiting for the host to start the quiz...");
    } catch (err: any) {
      console.error("Firestore write error:", err);
      if (err?.code === "permission-denied") {
        setMessage("🚫 Firestore rules are blocking the join. Go to Firebase Console → Firestore Database → Rules → and update the rules to allow anonymous players to write to sessions. See the setup guide for the exact rules.");
      } else {
        setMessage(`❌ Failed to save player: ${err?.message ?? "Unknown error"}`);
      }
    } finally {
      setJoining(false);
    }
  }

  async function answerQuestion(choice: number) {
    if (!hasFirebaseConfig || !session || !activeQuestion || !uid || answered || session.status !== "live" || timeRemaining <= 0) return;

    const db = getDb();
    const playerRef = doc(db, "sessions", sessionId, "players", uid);
    const key = String(session.activeQuestion);
    const isCorrect = choice === activeQuestion.ans;
    const points = scoreForAnswer(isCorrect, session.questionStartedAt);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(playerRef);
      const data = snap.data() as Player | undefined;
      if (!data || data.answers?.[key]) return;
      tx.update(playerRef, {
        score: (data.score ?? 0) + points,
        [`answers.${key}`]: {
          choice,
          correct: isCorrect,
          points,
          answeredAt: Date.now()
        },
        lastSeen: serverTimestamp()
      });
    });
  }

  if (!hasFirebaseConfig) {
    return (
      <Shell>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">Setup required</div>
            <h1>Nimma Quiz</h1>
            <p className="lead">This app is ready for GitHub Pages, but realtime joining and leaderboard features need Firebase configuration.</p>
          </div>
          <div className="join-panel">
            <p className="notice">Create `.env.local` from `.env.example`, add Firebase web app keys, then run `npm run dev`.</p>
          </div>
        </section>
      </Shell>
    );
  }

  if (player && session && activeQuestion) {
    return (
      <Shell>
        <main className="arena">
          <section className="question-panel">
            <div className="pulse-bg" />
            <div className="question-content">
              <div className="progress"><span style={{ width: `${((session.activeQuestion + 1) / Math.max(session.questions.length, 1)) * 100}%` }} /></div>
              <span className="level">{activeQuestion.level}</span>
              <h1 className="question-title">{activeQuestion.q}</h1>
              {session.status === "lobby" && <p className="lead">Waiting for the host to start the round.</p>}
              {session.status === "closed" && <p className="lead">Lobby is closed. Get ready, the quiz is about to start!</p>}
              {session.status === "ended" && <Result score={player.score} />}
              {session.status === "leaderboard" && <Leaderboard rows={leaders} featured />}
              {session.status === "live" && (
                <>
                  <div className="timer-strip">
                    <span>Time left</span>
                    <strong>{timeRemaining}s</strong>
                  </div>
                  <div className="options-grid">
                    {activeQuestion.opts.map((option, index) => (
                      <button className="answer-btn" disabled={answered || timeRemaining <= 0} key={option} onClick={() => answerQuestion(index)}>
                        <span className="answer-key">{String.fromCharCode(65 + index)}</span>
                        <span>{option}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {answered && <p className="notice">Answer locked. Watch the leaderboard while the next question loads.</p>}
            </div>
          </section>
          <aside className="side-stack">
            <div className="panel">
              <h2>{player.name}</h2>
              <div className="score-big">{player.score}</div>
              <p className="notice">{player.indexNo}</p>
            </div>
            <Leaderboard rows={leaders} />
          </aside>
        </main>
      </Shell>
    );
  }

  if (player && session?.status === "ended") {
    return (
      <Shell>
        <div className="panel">
          <Result score={player.score} />
          <Leaderboard rows={leaders} />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Scan, join, play</div>
          <h1>Nimma Quiz</h1>
          <p className="lead">A live competition quiz platform. Players scan a QR link, enter their university registration index, and compete on a realtime leaderboard.</p>
        </div>
        <form className="join-panel" onSubmit={joinSession}>
          <label className="field">
            <span>Session code</span>
            <input value={sessionId} onChange={(event) => setSessionId(event.target.value.replace(/\s+/g, ""))} placeholder="nimma-final" />
          </label>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Student name" />
          </label>
          <label className="field">
            <span>University registration index</span>
            <input value={indexNo} onChange={(event) => setIndexNo(event.target.value)} placeholder="Registration index or ID" />
          </label>
          <button className="primary-btn" type="submit" disabled={joining} style={{ opacity: joining ? 0.7 : 1 }}>
            <UserPlus size={18} /> {joining ? "Joining..." : "Join session"}
          </button>
          {message && (
            <p className="notice" style={{
              color: messageType === "success" ? "var(--green)" : messageType === "info" ? "var(--yellow)" : "var(--red)",
              fontWeight: 700,
              marginTop: "14px",
              padding: "10px 12px",
              background: messageType === "success" ? "rgba(14,159,110,0.08)" : messageType === "info" ? "rgba(244,180,0,0.08)" : "rgba(217,45,32,0.08)",
              borderRadius: "8px",
              border: `1px solid ${messageType === "success" ? "rgba(14,159,110,0.2)" : messageType === "info" ? "rgba(244,180,0,0.2)" : "rgba(217,45,32,0.2)"}`,
              lineHeight: "1.5"
            }}>{message}</p>
          )}
        </form>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Zap size={22} /></span> Nimma Quiz</div>
      </header>
      <div className="stage">{children}</div>
    </div>
  );
}

function Leaderboard({ rows, featured = false }: { rows: Player[]; featured?: boolean }) {
  return (
    <div className={featured ? "leaderboard-stage" : "panel"}>
      <h3>Leaderboard</h3>
      {rows.length === 0 && <p className="empty-state">No players yet.</p>}
      {rows.map((row, index) => (
        <div className={`leader-row ${featured ? "leader-row-big" : ""}`} key={`${row.indexNo}-${row.name}`}>
          <span className="rank">{index + 1}</span>
          <span>
            <span className="leader-name">{row.name}</span>
            <span className="leader-index">{row.indexNo}</span>
          </span>
          <strong>{row.score}</strong>
        </div>
      ))}
    </div>
  );
}

function Result({ score }: { score: number }) {
  return (
    <div>
      <span className="status-pill">Finished</span>
      <h1 className="question-title">Final score: {score}</h1>
      <p className="lead">The OC leaderboard has the final ranking with registration indexes.</p>
    </div>
  );
}
