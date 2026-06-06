"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { CheckCircle, Trophy, UserPlus, XCircle, Zap } from "lucide-react";
import { getAnonymousUser, getDb, hasFirebaseConfig } from "@/lib/firebase";
import { Question, scoreForAnswer } from "@/lib/quiz";
import { gtagPageview, QuizEvents } from "@/lib/gtag";
import Image from "next/image";

type Session = {
  title: string;
  status: "lobby" | "closed" | "live" | "answer_reveal" | "leaderboard" | "ended";
  activeQuestion: number;
  quizId?: string;
  questions: Question[];
  questionStartedAt?: number;
  durationSeconds?: number;
  controls?: {
    doublePts?: boolean;
    frozen?: boolean;
    suddenDeath?: boolean;
    bonusRound?: boolean;
    hideLeaderboard?: boolean;
  };
};

type Player = {
  name: string;
  indexNo: string;
  score: number;
  answers?: Record<string, { choice: number; correct: boolean; points: number }>;
  totalAnswers?: number;
  correctAnswers?: number;
  streak?: number;
  speedMs?: number;
};

// Colour palette for answer buttons (A/B/C/D)
const OPTION_COLORS = [
  { bg: "linear-gradient(135deg,#e74c3c,#c0392b)", shadow: "rgba(231,76,60,0.4)" },
  { bg: "linear-gradient(135deg,#3498db,#2980b9)", shadow: "rgba(52,152,219,0.4)" },
  { bg: "linear-gradient(135deg,#f39c12,#d68910)", shadow: "rgba(243,156,18,0.4)" },
  { bg: "linear-gradient(135deg,#27ae60,#1e8449)", shadow: "rgba(39,174,96,0.4)"  },
];

export default function HomePage() {
  const [sessionId,    setSessionId]    = useState("");
  const [session,      setSession]      = useState<Session | null>(null);
  const [player,       setPlayer]       = useState<Player | null>(null);
  const [uid,          setUid]          = useState("");
  const [name,         setName]         = useState("");
  const [indexNo,      setIndexNo]      = useState("");
  const [message,      setMessage]      = useState("");
  const [messageType,  setMessageType]  = useState<"error"|"info"|"success">("error");
  const [joining,      setJoining]      = useState(false);
  const [leaders,      setLeaders]      = useState<Player[]>([]);
  const [timeRemaining,setTimeRemaining]= useState(0);
  const [lastPoints,   setLastPoints]   = useState<number|null>(null);
  const [chosenIdx,    setChosenIdx]    = useState<number|null>(null);
  const [authReady,    setAuthReady]    = useState(false);
  // true while we are restoring a previous session from sessionStorage
  const [restoring,    setRestoring]    = useState(true);
  const lastQuestionRef = useRef<number>(-1);

  /* ── sessionStorage helpers ─────────────────────────────────────────── */
  const STORAGE_KEY = "nimma_quiz_player";
  function saveIdentity(sId: string, pUid: string, pName: string, pIndex: string) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: sId, uid: pUid, name: pName, indexNo: pIndex }));
    } catch { /* storage not available (private mode etc.) — silent */ }
  }
  function clearIdentity() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* silent */ }
  }

  // Sign in anonymously on page load so Firestore listeners always have request.auth
  useEffect(() => {
    if (!hasFirebaseConfig) return;
    getAnonymousUser()
      .then(() => setAuthReady(true))
      .catch(() => setAuthReady(true)); // proceed even if it fails
  }, []);

  // Restore saved identity from sessionStorage (runs once on mount)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { sessionId: string; uid: string; name: string; indexNo: string };
        if (saved.sessionId && saved.uid && saved.name) {
          setSessionId(saved.sessionId);
          setUid(saved.uid);
          setName(saved.name);
          setIndexNo(saved.indexNo ?? "");
          setRestoring(false);
          return;
        }
      }
    } catch { /* storage not readable */ }
    setRestoring(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read session code from URL (only used when NOT restoring from storage)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlSession = (params.get("session") ?? "").trim();
    if (urlSession) setSessionId(urlSession);
  }, []);

  // Track pageview on mount
  useEffect(() => {
    gtagPageview(window.location.pathname);
  }, []);

  // Real-time session + leaderboard listeners  wait for auth before attaching
  useEffect(() => {
    const id = sessionId.trim();
    if (!hasFirebaseConfig || !id || !authReady) return;
    const db = getDb();
    const unsubSession = onSnapshot(doc(db, "sessions", id), (snap) => {
      setSession(snap.exists() ? snap.data() as Session : null);
    });
    const unsubLeaders = onSnapshot(collection(db, "sessions", id, "players"), (snap) => {
      const rows = snap.docs.map((d) => d.data() as Player);
      setLeaders(rows.sort((a, b) => b.score - a.score).slice(0, 10));
    });
    return () => { unsubSession(); unsubLeaders(); };
  }, [sessionId, authReady]);

  // Real-time own player doc
  useEffect(() => {
    const id = sessionId.trim();
    if (!hasFirebaseConfig || !id || !uid) return;
    return onSnapshot(doc(getDb(), "sessions", id, "players", uid), (snap) => {
      if (snap.exists()) setPlayer(snap.data() as Player);
    });
  }, [sessionId, uid]);

  // ── Screen-lock recovery (Page Visibility API) ───────────────────────────
  // Mobile browsers freeze JS when the screen locks, silently dropping the
  // Firebase WebSocket. The onSnapshot listener misses any status changes that
  // happened while the screen was off (e.g. host starting the quiz).
  // Solution: when the screen unlocks (visibilityState → 'visible'), force a
  // one-shot getDoc to immediately catch up to the current session state.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const id = sessionId.trim();
      if (!hasFirebaseConfig || !id || !authReady) return;
      const db = getDb();
      // Re-fetch session doc to catch any status change missed while frozen
      getDoc(doc(db, "sessions", id))
        .then(snap => {
          if (snap.exists()) setSession(snap.data() as Session);
        })
        .catch(() => { /* silent — the onSnapshot will catch up shortly */ });
      // Re-fetch own player doc to catch any score/answer updates
      if (uid) {
        getDoc(doc(db, "sessions", id, "players", uid))
          .then(snap => { if (snap.exists()) setPlayer(snap.data() as Player); })
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [sessionId, uid, authReady]);

  // Reset chosen answer when question changes
  useEffect(() => {
    if (session && session.activeQuestion !== lastQuestionRef.current) {
      lastQuestionRef.current = session.activeQuestion;
      setChosenIdx(null);
      setLastPoints(null);
    }
  }, [session?.activeQuestion]);

  const activeQuestion = useMemo(() => {
    const qs = session?.questions ?? [];
    if (!session || session.activeQuestion >= qs.length) return null;
    return qs[session.activeQuestion];
  }, [session?.questions, session?.activeQuestion]);

  // Countdown timer
  useEffect(() => {
    if (!session?.questionStartedAt || session.status !== "live" || !activeQuestion) {
      setTimeRemaining(0);
      return;
    }
    const tick = () => {
      const duration = (activeQuestion.timeLimitOverride ?? session.durationSeconds ?? 20) * 1000;
      const left = Math.max(0, Math.ceil((session.questionStartedAt! + duration - Date.now()) / 1000));
      setTimeRemaining(left);
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [session?.questionStartedAt, session?.status, session?.durationSeconds, activeQuestion?.timeLimitOverride]);

  const answered = Boolean(player?.answers?.[String(session?.activeQuestion ?? "")]);
  const myAnswer  = answered ? player!.answers![String(session!.activeQuestion)] : null;
  const duration  = activeQuestion?.timeLimitOverride ?? session?.durationSeconds ?? 20;
  const timerPct  = duration > 0 ? (timeRemaining / duration) * 100 : 0;
  const timerColor = timerPct > 50 ? "#10b981" : timerPct > 25 ? "#f59e0b" : "#ef4444";

  const displayOptions = useMemo(() => {
    if (!activeQuestion) return [];
    const arr = activeQuestion.opts.map((opt, i) => ({ opt, originalIndex: i }));
    if (activeQuestion.shuffleOptions) {
      let seed = (session?.activeQuestion ?? 0) + (player?.name.length ?? 0);
      const random = () => {
         const x = Math.sin(seed++) * 10000;
         return x - Math.floor(x);
      };
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    return arr;
  }, [session?.activeQuestion, activeQuestion?.shuffleOptions, activeQuestion?.opts, player?.name]);

  // Join session flow
  async function joinSession(event: FormEvent) {
    event.preventDefault();
    setMessage(""); setMessageType("error");
    if (!hasFirebaseConfig) { setMessage("Firebase not configured."); return; }
    if (!sessionId.trim() || !name.trim() || !indexNo.trim()) {
      setMessage("Enter the session code, your name, and registration index.");
      return;
    }
    setJoining(true);

    // 1. Sign in anonymously first
    let playerUid: string;
    try {
      playerUid = (await getAnonymousUser()).uid;
    } catch {
      setMessage(" Anonymous sign-in failed. Enable it in Firebase Console  Authentication.");
      setJoining(false); return;
    }

    // 2. Read session
    let sessionData: Session;
    try {
      const snap = await getDoc(doc(getDb(), "sessions", sessionId.trim()));
      if (!snap.exists()) { setMessage(" Session not found. Check the code and try again."); setJoining(false); return; }
      sessionData = snap.data() as Session;
    } catch (err: any) {
      setMessage(err?.code === "permission-denied"
        ? " Firestore rules blocking reads. Update rules in Firebase Console."
        : " Cannot reach Firebase. Check your internet.");
      setJoining(false); return;
    }

    if (sessionData.status === "closed") {
      setMessageType("info");
      setMessage(" Lobby closed. The quiz will start shortly  please wait.");
      setJoining(false); return;
    }
    if (sessionData.status !== "lobby") {
      setMessage(" Quiz already started. New players cannot join now.");
      setJoining(false); return;
    }

    // 3. Write player doc
    try {
      const cleanPlayer = {
        name: name.trim(), indexNo: indexNo.trim(),
        score: 0, answers: {},
        joinedAt: serverTimestamp(), lastSeen: serverTimestamp()
      };
      await setDoc(doc(getDb(), "sessions", sessionId.trim(), "players", playerUid), cleanPlayer, { merge: true });
      setUid(playerUid);
      setPlayer(cleanPlayer);
      // Persist identity so a reload reconnects automatically
      saveIdentity(sessionId.trim(), playerUid, name.trim(), indexNo.trim());
      setMessageType("success");
      setMessage(" Joined! Waiting for the host to start the quiz...");
      QuizEvents.joinSession(sessionId.trim());
    } catch (err: any) {
      setMessage(err?.code === "permission-denied"
        ? " Firestore rules blocking player write. Update rules in Firebase Console."
        : ` Failed to save: ${err?.message ?? "Unknown error"}`);
    } finally {
      setJoining(false);
    }
  }

  // Leave / reset — clear stored identity and reload to the join screen
  function leaveSession() {
    clearIdentity();
    setUid(""); setPlayer(null); setSession(null);
    setName(""); setIndexNo(""); setSessionId(""); setMessage("");
  }

  // Submit answer
  async function answerQuestion(choice: number) {
    if (!hasFirebaseConfig || !session || !activeQuestion || !uid || answered || session.status !== "live" || timeRemaining <= 0) return;
    setChosenIdx(choice);
    const db      = getDb();
    const ref     = doc(db, "sessions", sessionId, "players", uid);
    const key     = String(session.activeQuestion);
    const correct = choice === activeQuestion.ans;
    // Apply 2x multiplier if Double Points is active on this question
    const doublePts = session.controls?.doublePts ? 2 : 1;
    const points  = scoreForAnswer(correct, session.questionStartedAt, (activeQuestion.pointsMultiplier ?? 1) * doublePts);
    setLastPoints(correct ? points : 0);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as Player | undefined;
      if (!data || data.answers?.[key]) return;

      const answeredAt  = Date.now();
      const speedMs     = session.questionStartedAt ? answeredAt - session.questionStartedAt : null;
      const newStreak   = correct ? (data.streak ?? 0) + 1 : 0;

      const updateFields: Record<string, unknown> = {
        score:          (data.score ?? 0) + points,
        [`answers.${key}`]: { choice, correct, points, answeredAt },
        totalAnswers:   (data.totalAnswers ?? 0) + 1,
        correctAnswers: (data.correctAnswers ?? 0) + (correct ? 1 : 0),
        streak:         newStreak,
        lastSeen:       serverTimestamp(),
      };
      // Track fastest correct answer across all questions
      if (correct && speedMs !== null && speedMs < (data.speedMs ?? 999_999)) {
        updateFields.speedMs = speedMs;
      }

      tx.update(ref, updateFields);
      QuizEvents.answerSubmitted(sessionId, session.activeQuestion, correct);
    });
  }

  //  SCREENS 

  // No Firebase
  if (!hasFirebaseConfig) {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div className="eyebrow">Setup required</div>
          <h1 className="sr-only">Nimma Quiz Setup</h1>
          <p className="lead">Add Firebase environment variables to <code>.env.local</code> to enable live play.</p>
        </div>
      </Shell>
    );
  }

  // Reconnecting — restoring a previous session from sessionStorage
  // Show a spinner while auth + first Firestore snapshot arrive
  if (restoring || (uid && authReady && !session && !player)) {
    return (
      <Shell>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70vh", gap: "20px", textAlign: "center", padding: "24px" }}>
          <div style={{ fontSize: "48px", animation: "pulse 1.2s ease infinite" }}>⚡</div>
          <div>
            <div className="eyebrow">Reconnecting…</div>
            <p className="lead" style={{ margin: "8px 0 0", fontSize: "15px" }}>Getting your session back. One moment!</p>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            {[0,1,2].map(i => (
              <span key={i} style={{ width: "9px", height: "9px", borderRadius: "50%", background: "var(--violet)", display: "inline-block", animation: `pulse 1.2s ease ${i * 0.2}s infinite` }} />
            ))}
          </div>
          <button onClick={leaveSession} style={{ marginTop: "12px", background: "none", border: "1px solid var(--line)", borderRadius: "8px", padding: "8px 18px", fontSize: "13px", color: "var(--muted)", cursor: "pointer" }}>
            Join as a different player
          </button>
        </div>
      </Shell>
    );
  }

  // Lobby / closed  waiting room
  if (player && session && (session.status === "lobby" || session.status === "closed")) {
    return (
      <Shell>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "80vh", gap: "28px", padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: "64px", animation: "pulse 2s ease infinite" }}></div>
          <div>
            <div className="eyebrow">{session.status === "lobby" ? "You're in the lobby!" : "Get ready!"}</div>
            <h1 style={{ margin: "8px 0 12px" }}>{session.title}</h1>
            <p className="lead" style={{ maxWidth: "340px", margin: "0 auto" }}>
              {session.status === "lobby"
                ? "The host will start the quiz shortly. Stay on this screen!"
                : " Lobby is locked. The quiz is about to begin  stay ready!"}
            </p>
          </div>
          <div style={{ background: "rgba(255,255,255,0.85)", border: "1px solid var(--line)", borderRadius: "16px", padding: "20px 32px", boxShadow: "var(--shadow)" }}>
            <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "4px" }}>Playing as</div>
            <div style={{ fontWeight: 900, fontSize: "22px", color: "var(--ink)" }}>{player.name}</div>
            <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>{player.indexNo}</div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "var(--green)", display: "inline-block", animation: "pulse 1.2s ease infinite", boxShadow: "0 0 8px var(--green)" }} />
            <span style={{ color: "var(--muted)", fontSize: "14px" }}>Waiting for host</span>
          </div>
          <button
            onClick={leaveSession}
            style={{ marginTop: "8px", background: "none", border: "none", color: "var(--muted)", fontSize: "12px", cursor: "pointer", textDecoration: "underline", padding: "4px 8px" }}
          >
            Leave session
          </button>
        </div>
      </Shell>
    );
  }

  // Live question or Answer Reveal screen
  if (player && session && (session.status === "live" || session.status === "answer_reveal") && activeQuestion) {
    const qNum = session.activeQuestion + 1;
    const qTotal = session.questions.length;
    const isReveal = session.status === "answer_reveal";

    return (
      <Shell>
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", padding: "0" }}>

          {/* Top bar  timer + score */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 0", gap: "16px" }}>
            {/* Timer ring */}
            <div style={{ position: "relative", width: "64px", height: "64px", flexShrink: 0 }}>
              <svg viewBox="0 0 64 64" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)", width: "64px", height: "64px" }}>
                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="5" />
                <circle
                  cx="32" cy="32" r="28" fill="none"
                  stroke={timerColor}
                  strokeWidth="5"
                  strokeDasharray={`${2 * Math.PI * 28}`}
                  strokeDashoffset={`${2 * Math.PI * 28 * (1 - timerPct / 100)}`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.25s linear, stroke 0.5s ease" }}
                />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: "18px", color: timerColor, transition: "color 0.5s" }}>
                {timeRemaining}
              </div>
            </div>

            {/* Q counter */}
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Question</div>
              <div style={{ fontWeight: 900, fontSize: "20px" }}>{qNum} / {qTotal}</div>
            </div>

            {/* Score pill */}
            <div key={player.score} style={{ background: "linear-gradient(135deg,var(--violet),#6366f1)", color: "#fff", borderRadius: "999px", padding: "8px 18px", fontWeight: 900, fontSize: "16px", flexShrink: 0, boxShadow: "0 4px 16px rgba(124,58,237,0.35)", animation: "score-pulse 0.6s ease" }}>
              {player.score} <span style={{ fontSize: "11px", opacity: 0.8 }}>pts</span>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ margin: "14px 20px 0", height: "5px", background: "rgba(0,0,0,0.07)", borderRadius: "99px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(qNum / qTotal) * 100}%`, background: "var(--violet)", borderRadius: "99px", transition: "width 0.4s ease" }} />
          </div>

          {/* Question text & Image */}
          <div style={{ padding: "24px 20px 16px", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ display: "inline-block", background: "rgba(124,58,237,0.1)", color: "var(--violet)", borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>
                {activeQuestion.level}
              </div>
              {(activeQuestion.pointsMultiplier ?? 1) !== 1 && (
                <div style={{ display: "inline-block", background: "rgba(245,158,11,0.1)", color: "#d97706", borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 700 }}>
                  {activeQuestion.pointsMultiplier}x Points
                </div>
              )}
            </div>
            {activeQuestion.imageUrl && (
              <div style={{ position: "relative", width: "100%", height: "200px", marginBottom: "16px" }}>
                <Image 
                  src={activeQuestion.imageUrl} 
                  alt="Question media" 
                  fill 
                  style={{ objectFit: "contain", borderRadius: "12px", background: "rgba(0,0,0,0.03)" }}
                  unoptimized 
                />
              </div>
            )}
            <h2 style={{ fontSize: "clamp(18px, 5vw, 26px)", fontWeight: 900, lineHeight: "1.35", color: "var(--ink)", margin: 0 }}>
              {activeQuestion.q}
            </h2>
          </div>

          {/* Answer buttons */}
          <div className="player-options-grid">
            {displayOptions.map((item, idx) => {
              const isChosen = chosenIdx === item.originalIndex || myAnswer?.choice === item.originalIndex;
              const isCorrect = item.originalIndex === activeQuestion.ans;

              const col = OPTION_COLORS[idx % OPTION_COLORS.length];
              
              // Base styling
              let bg = col.bg;
              let border = "none";
              let opacity = answered ? (isChosen ? 1 : 0.45) : 1;

              // Reveal logic: only apply correct/incorrect colors when time is up and answer is revealed
              if (answered && isReveal) {
                if (isCorrect)       { bg = "linear-gradient(135deg,#10b981,#059669)"; opacity = 1; border = "2px solid #059669"; }
                else if (isChosen)   { bg = "linear-gradient(135deg,#ef4444,#dc2626)"; opacity = 1; border = "2px solid #dc2626"; }
              } else if (isChosen) {
                // Before reveal, just highlight what they chose with a white border
                border = "2px solid #fff"; 
              }

              return (
                <button
                  key={item.originalIndex}
                  onClick={() => answerQuestion(item.originalIndex)}
                  disabled={answered || timeRemaining <= 0 || isReveal}
                  style={{
                    background: bg,
                    border,
                    borderRadius: "16px",
                    padding: "20px 14px",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: "clamp(13px, 3.5vw, 16px)",
                    textAlign: "left",
                    cursor: answered ? "default" : "pointer",
                    boxShadow: isChosen ? `0 0 0 3px #fff, 0 8px 24px ${col.shadow}` : `0 6px 20px ${col.shadow}`,
                    opacity,
                    transform: isChosen ? "scale(0.97)" : "scale(1)",
                    animation: "fade-in-slide 0.4s ease both",
                    animationDelay: `${idx * 0.08}s`,
                    transition: "all 0.2s ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    minHeight: "100px",
                    lineHeight: "1.35",
                    WebkitTapHighlightColor: "transparent",
                    position: "relative",
                    overflow: "hidden",
                    justifyContent: "center"
                  }}
                >
                  {/* Answer key badge */}
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", background: "rgba(255,255,255,0.25)", borderRadius: "8px", fontWeight: 900, fontSize: "13px", flexShrink: 0 }}>
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span>{item.opt}</span>
                  {/* Correct / wrong icon overlay (only shown during reveal) */}
                  {answered && isReveal && isCorrect && <CheckCircle size={20} style={{ position: "absolute", top: "12px", right: "12px", opacity: 0.9, color: "white" }} />}
                  {answered && isReveal && isChosen && !isCorrect && <XCircle size={20} style={{ position: "absolute", top: "12px", right: "12px", opacity: 0.9, color: "white" }} />}
                </button>
              );
            })}
          </div>

          {/* Post-answer feedback */}
          {answered && (
            <div style={{
              margin: "0 16px 24px",
              padding: "16px 20px",
              borderRadius: "14px",
              background: isReveal ? (myAnswer?.correct ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)") : "rgba(124,58,237,0.1)",
              border: `1.5px solid ${isReveal ? (myAnswer?.correct ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)") : "rgba(124,58,237,0.3)"}`,
              display: "flex",
              alignItems: "center",
              gap: "14px",
              animation: "fade-in-slide 0.3s ease both"
            }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: "16px", color: isReveal ? (myAnswer?.correct ? "#059669" : "#dc2626") : "var(--violet)" }}>
                  {!isReveal ? "Answer locked in!" : (myAnswer?.correct ? `+${myAnswer.points} points!` : "Wrong answer")}
                </div>
                <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
                  {!isReveal 
                    ? "Wait for the timer to finish to see the correct answer."
                    : (myAnswer?.correct
                        ? myAnswer.points > 800 ? " Lightning fast!" : myAnswer.points > 650 ? " Great speed!" : "Good job!"
                        : `Correct answer was: ${String.fromCharCode(65 + activeQuestion.ans)}`)}
                </div>
                {isReveal && (
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                    Look at the projector for the leaderboard!
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // Leaderboard between rounds
  if (player && session && session.status === "leaderboard") {
    const myRank = leaders.findIndex((l) => l.name === player.name && l.indexNo === player.indexNo) + 1;
    return (
      <Shell>
        <div style={{ padding: "32px 20px", display: "flex", flexDirection: "column", gap: "20px", alignItems: "center" }}>
          <div className="eyebrow">Round Over</div>
          <h1 style={{ margin: 0 }}>Leaderboard</h1>
          {myRank > 0 && (
            <div style={{ background: "linear-gradient(135deg,var(--violet),#6366f1)", color: "#fff", borderRadius: "14px", padding: "16px 28px", textAlign: "center", boxShadow: "0 8px 32px rgba(124,58,237,0.3)" }}>
              <div style={{ fontSize: "12px", opacity: 0.85, marginBottom: "4px" }}>YOUR RANK</div>
              <div style={{ fontWeight: 900, fontSize: "40px" }}>#{myRank}</div>
              <div style={{ fontSize: "14px", opacity: 0.85 }}>{player.score} pts</div>
            </div>
          )}
          <div style={{ width: "100%", maxWidth: "480px" }}>
            <Leaderboard rows={leaders} currentName={player.name} currentIndex={player.indexNo} />
          </div>
          <p className="lead" style={{ textAlign: "center", fontSize: "14px" }}>Next question coming up  stay ready!</p>
        </div>
      </Shell>
    );
  }

  // Ended
  if (player && session && session.status === "ended") {
    const myRank = leaders.findIndex((l) => l.name === player.name && l.indexNo === player.indexNo) + 1;
    return (
      <Shell>
        <div style={{ padding: "40px 20px", display: "flex", flexDirection: "column", gap: "24px", alignItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: "72px" }}></div>
          <div className="eyebrow">Quiz Complete!</div>
          <h1 style={{ margin: 0 }}>{session.title}</h1>
          <div style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)", color: "#fff", borderRadius: "20px", padding: "24px 40px", boxShadow: "0 12px 40px rgba(251,191,36,0.4)" }}>
            <div style={{ fontSize: "12px", opacity: 0.85, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Final Score</div>
            <div style={{ fontWeight: 900, fontSize: "56px", lineHeight: 1 }}>{player.score}</div>
            <div style={{ fontSize: "14px", opacity: 0.85, marginTop: "4px" }}>points</div>
          </div>
          {myRank > 0 && (
            <div style={{ fontWeight: 800, fontSize: "20px" }}>
              You finished #{myRank} 
            </div>
          )}
          <div style={{ width: "100%", maxWidth: "480px" }}>
            <Leaderboard rows={leaders} currentName={player.name} currentIndex={player.indexNo} />
          </div>
        </div>
      </Shell>
    );
  }

  // Join screen (default)
  return (
    <Shell>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Scan, join, play</div>
          <h1>Nimma Quiz</h1>
          <p className="lead">A live competition quiz. Enter your details below to join the session.</p>
        </div>
        <form className="join-panel" onSubmit={joinSession}>
          <label className="field">
            <span>Session code</span>
            <input value={sessionId} onChange={(e) => setSessionId(e.target.value.replace(/\s+/g, ""))} placeholder="nimma-final" />
          </label>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Student name" />
          </label>
          <label className="field">
            <span>University registration index</span>
            <input value={indexNo} onChange={(e) => setIndexNo(e.target.value)} placeholder="Registration index or ID" />
          </label>
          <button className="primary-btn" type="submit" disabled={joining} style={{ opacity: joining ? 0.7 : 1 }}>
            <UserPlus size={18} /> {joining ? "Joining" : "Join session"}
          </button>
          {message && (
            <p className="notice" style={{
              color: messageType === "success" ? "var(--green)" : messageType === "info" ? "var(--yellow)" : "var(--red)",
              fontWeight: 700, marginTop: "14px", padding: "10px 12px",
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
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/nimma-quiz";
  const adminHref = `${basePath}/admin/`;

  return (
    <div className="app-shell">
      {/* ── Navbar ── */}
      <nav className="navbar" aria-label="Main navigation">
        {/* Left: Brand */}
        <a className="navbar-brand" href={`${basePath}/`} aria-label="Nimma Quiz home">
          <span className="navbar-brand-mark">
            <Zap size={20} />
          </span>
          <span className="navbar-brand-name">Nimma Quiz</span>
        </a>

        {/* Right: Actions */}
        <div className="navbar-actions">
          {/* Create a Quiz CTA */}
          <a
            className="navbar-btn navbar-btn-primary"
            href={adminHref}
            aria-label="Create a quiz"
          >
            <span className="navbar-btn-icon">✏️</span>
            <span>Create a Quiz</span>
          </a>
        </div>
      </nav>

      {/* ── Page content ── */}
      <div className="stage">{children}</div>
    </div>
  );
}

function Leaderboard({ rows, currentName, currentIndex }: { rows: Player[]; currentName?: string; currentIndex?: string }) {
  const medals = ["","",""];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {rows.length === 0 && <p className="empty-state">No players yet.</p>}
      {rows.map((row, i) => {
        const isMe = row.name === currentName && row.indexNo === currentIndex;
        return (
          <div
            key={`${row.indexNo}-${row.name}-${i}`}
            style={{
              display: "flex", alignItems: "center", gap: "12px",
              background: isMe ? "rgba(124,58,237,0.1)" : "rgba(255,255,255,0.85)",
              border: isMe ? "1.5px solid rgba(124,58,237,0.4)" : "1px solid var(--line)",
              borderRadius: "12px", padding: "12px 16px",
              boxShadow: isMe ? "0 4px 16px rgba(124,58,237,0.15)" : "0 2px 8px rgba(0,0,0,0.04)",
              fontWeight: isMe ? 800 : 600
            }}
          >
            <span style={{ fontSize: i < 3 ? "22px" : "14px", minWidth: "28px", textAlign: "center", fontWeight: 900 }}>
              {i < 3 ? medals[i] : `#${i + 1}`}
            </span>
            <span style={{ flex: 1, overflow: "hidden" }}>
              <span style={{ display: "block", fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.name}{isMe ? " (you)" : ""}
              </span>
              <span style={{ display: "block", fontSize: "11px", color: "var(--muted)" }}>{row.indexNo}</span>
            </span>
            <span style={{ fontWeight: 900, fontSize: "16px", color: isMe ? "var(--violet)" : "var(--ink)" }}>
              {row.score}
            </span>
          </div>
        );
      })}
    </div>
  );
}
