"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { ExternalLink, Trophy, UserPlus, Zap } from "lucide-react";
import Link from "next/link";
import { getAnonymousUser, getDb, hasFirebaseConfig } from "@/lib/firebase";
import { Question, scoreForAnswer } from "@/lib/quiz";

type Session = {
  title: string;
  status: "lobby" | "live" | "ended";
  activeQuestion: number;
  quizId?: string;
  questions: Question[];
  questionStartedAt?: number;
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
  const [leaders, setLeaders] = useState<Player[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionId(params.get("session") ?? "");
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !sessionId) return;
    const db = getDb();
    const unsubSession = onSnapshot(doc(db, "sessions", sessionId), (snap) => {
      setSession(snap.exists() ? snap.data() as Session : null);
    });
    const unsubLeaders = onSnapshot(collection(db, "sessions", sessionId, "players"), (snap) => {
      const rows = snap.docs.map((item) => item.data() as Player);
      setLeaders(rows.sort((a, b) => b.score - a.score).slice(0, 8));
    });
    return () => {
      unsubSession();
      unsubLeaders();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!hasFirebaseConfig || !sessionId || !uid) return;
    return onSnapshot(doc(getDb(), "sessions", sessionId.trim(), "players", uid), (snap) => {
      if (snap.exists()) setPlayer(snap.data() as Player);
    });
  }, [sessionId, uid]);

  const activeQuestion = useMemo(() => {
    const sessionQuestions = session?.questions ?? [];
    if (!session || session.activeQuestion >= sessionQuestions.length) return null;
    return sessionQuestions[session.activeQuestion];
  }, [session]);

  const answered = Boolean(player?.answers?.[String(session?.activeQuestion ?? "")]);

  async function joinSession(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    if (!hasFirebaseConfig) {
      setMessage("Firebase is not configured yet. Add .env.local values first.");
      return;
    }
    if (!sessionId.trim() || !name.trim() || !indexNo.trim()) {
      setMessage("Enter the session code, your name, and university registration index.");
      return;
    }

    const db = getDb();
    const sessionRef = doc(db, "sessions", sessionId.trim());
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) {
      setMessage("Session not found. Ask an OC member to check the QR or code.");
      return;
    }

    const user = await getAnonymousUser();
    const cleanPlayer = {
      name: name.trim(),
      indexNo: indexNo.trim(),
      score: 0,
      answers: {},
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    };
    await setDoc(doc(db, "sessions", sessionId.trim(), "players", user.uid), cleanPlayer, { merge: true });
    setUid(user.uid);
    setPlayer(cleanPlayer);
  }

  async function answerQuestion(choice: number) {
    if (!hasFirebaseConfig || !session || !activeQuestion || !uid || answered) return;

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
              {session.status === "lobby" && <p className="lead">Waiting for OC members to start the round.</p>}
              {session.status === "ended" && <Result score={player.score} />}
              {session.status === "live" && (
                <div className="options-grid">
                  {activeQuestion.opts.map((option, index) => (
                    <button className="answer-btn" disabled={answered} key={option} onClick={() => answerQuestion(index)}>
                      <span className="answer-key">{String.fromCharCode(65 + index)}</span>
                      <span>{option}</span>
                    </button>
                  ))}
                </div>
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
          <div className="button-row">
            <Link className="nav-link" href="/admin"><Trophy size={18} /> OC dashboard</Link>
          </div>
        </div>
        <form className="join-panel" onSubmit={joinSession}>
          <label className="field">
            <span>Session code</span>
            <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="nimma-final" />
          </label>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Student name" />
          </label>
          <label className="field">
            <span>University registration index</span>
            <input value={indexNo} onChange={(event) => setIndexNo(event.target.value)} placeholder="EG/2022/0000" />
          </label>
          <button className="primary-btn" type="submit"><UserPlus size={18} /> Join session</button>
          {message && <p className="notice">{message}</p>}
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
        <a className="nav-link" href="https://github.com/" target="_blank" rel="noreferrer"><ExternalLink size={17} /> Host on GitHub</a>
      </header>
      <div className="stage">{children}</div>
    </div>
  );
}

function Leaderboard({ rows }: { rows: Player[] }) {
  return (
    <div className="panel">
      <h3>Leaderboard</h3>
      {rows.length === 0 && <p className="empty-state">No players yet.</p>}
      {rows.map((row, index) => (
        <div className="leader-row" key={`${row.indexNo}-${row.name}`}>
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
