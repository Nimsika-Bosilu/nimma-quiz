"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { Award, TrendingDown, TrendingUp, Trophy, Users, Volume2, VolumeX, Zap } from "lucide-react";
import QRCode from "qrcode";
import { getAnonymousUser, getDb, hasFirebaseConfig } from "@/lib/firebase";
import { Question } from "@/lib/quiz";
import { motion, AnimatePresence } from "framer-motion";
import {
  unlockAudio, setMuted,
  startLobbyMusic, stopLobbyMusic,
  sfxQuestionStart, sfxTick, sfxTimeUp, sfxAnswerReveal, sfxLeaderboard
} from "@/lib/sounds";

type Session = {
  title: string;
  status: "lobby" | "closed" | "live" | "answer_reveal" | "leaderboard" | "ended";
  activeQuestion: number;
  questions?: Question[];
  durationSeconds?: number;
  questionStartedAt?: number;
};

type Player = {
  name: string;
  indexNo: string;
  score: number;
  rankDelta?: number;
};

function ConfettiShower() {
  const pieces = useMemo(() => {
    const colors = ["#fbbf24", "#3b82f6", "#ef4444", "#10b981", "#a855f7", "#ec4899", "#06b6d4"];
    return Array.from({ length: 80 }).map((_, i) => {
      const left = Math.random() * 100;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const delay = Math.random() * 4;
      const duration = 2.5 + Math.random() * 2;
      const size = 6 + Math.random() * 8;
      const skew = -20 + Math.random() * 40;
      return {
        id: i,
        style: {
          left: `${left}%`,
          backgroundColor: color,
          animationDelay: `${delay}s`,
          animationDuration: `${duration}s`,
          width: `${size}px`,
          height: `${size * (0.6 + Math.random() * 0.8)}px`,
          transform: `rotate(${skew}deg)`
        }
      };
    });
  }, []);
  return (
    <div className="confetti-container">
      {pieces.map((p) => (
        <div className="confetti-piece" key={p.id} style={p.style} />
      ))}
    </div>
  );
}

export default function ProjectorLeaderboardPage() {
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [qrCodeData, setQrCodeData] = useState("");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [muted, setMutedState] = useState(false);
  const previousRanks = useRef<Record<string, number>>({});
  const prevStatusRef = useRef<string | null>(null);
  const prevTickSecRef = useRef(-1);

  // ── Enable audio ──────────────────────────────────────────────
  const enableAudio = useCallback(() => {
    unlockAudio();
    setAudioEnabled(true);
  }, []);

  // Try to auto-unlock on mount (works when page opened via window.open)
  useEffect(() => {
    try { unlockAudio(); setAudioEnabled(true); } catch { /* needs gesture */ }
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
    if (next) stopLobbyMusic();
    else if (session?.status === "lobby" || session?.status === "closed") startLobbyMusic();
  }, [muted, session?.status]);

  useEffect(() => {
    if (!sessionId) return;
    const url = window.location.origin + process.env.NEXT_PUBLIC_BASE_PATH + "/?session=" + encodeURIComponent(sessionId);
    QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then(setQrCodeData)
      .catch(console.error);
  }, [sessionId]);

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

  // ── Sound effects on status change ───────────────────────────
  useEffect(() => {
    const prev  = prevStatusRef.current;
    const curr  = session?.status ?? null;
    prevStatusRef.current = curr;
    if (!audioEnabled) return;

    if (curr === "lobby" || curr === "closed") {
      if (prev !== "lobby" && prev !== "closed") startLobbyMusic();
    } else {
      stopLobbyMusic();
    }

    if (curr === "live"         && prev !== "live")          sfxQuestionStart();
    if (curr === "answer_reveal"&& prev !== "answer_reveal") {
      sfxTimeUp();
      setTimeout(sfxAnswerReveal, 900);
    }
    if (curr === "leaderboard"  && prev !== "leaderboard")   sfxLeaderboard();
    if (curr === "ended"        && prev !== "ended")         sfxLeaderboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, audioEnabled]);

  // ── Countdown ticks (fire once per integer second) ────────────
  useEffect(() => {
    if (!audioEnabled || session?.status !== "live" || timeRemaining <= 0) {
      prevTickSecRef.current = -1;
      return;
    }
    if (timeRemaining !== prevTickSecRef.current) {
      prevTickSecRef.current = timeRemaining;
      sfxTick(timeRemaining);
    }
  }, [timeRemaining, session?.status, audioEnabled]);


  // Sign in anonymously first so Firestore listeners have auth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionId(params.get("session") ?? "");
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig) return;
    getAnonymousUser()
      .then(() => setAuthReady(true))
      .catch(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !sessionId.trim() || !authReady) return;
    const db = getDb();
    const unsubSession = onSnapshot(doc(db, "sessions", sessionId.trim()), (snap) => {
      setSession(snap.exists() ? snap.data() as Session : null);
    });
    const leaderQuery = query(
      collection(db, "sessions", sessionId.trim(), "players"),
      orderBy("score", "desc")
    );
    const unsubPlayers = onSnapshot(leaderQuery, (snap) => {
      const nextPlayers = snap.docs.map((item, index) => {
        const data = item.data() as Player;
        const key = item.id;
        const previousRank = previousRanks.current[key] ?? index + 1;
        return { ...data, rankDelta: previousRank - (index + 1) };
      });
      previousRanks.current = Object.fromEntries(
        snap.docs.map((item, index) => [item.id, index + 1])
      );
      setPlayers(nextPlayers);
    });
    return () => { unsubSession(); unsubPlayers(); };
  }, [sessionId, authReady]);

  const topMovers = useMemo(() => {
    const movers = players
      .filter((p) => (p.rankDelta ?? 0) > 0)
      .sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0))
      .slice(0, 3);
    return movers.length ? movers : players.slice(0, 3);
  }, [players]);

  const podiumPlayers = useMemo(() => ({
    gold: players[0] || null,
    silver: players[1] || null,
    bronze: players[2] || null,
  }), [players]);

  const remainingPlayers = useMemo(() => players.slice(3), [players]);

  if (!hasFirebaseConfig) {
    return <LeaderboardShell><div className="projector-empty">Firebase is not configured.</div></LeaderboardShell>;
  }
  if (!sessionId) {
    return <LeaderboardShell><div className="projector-empty">Missing session code.</div></LeaderboardShell>;
  }

  const isEnded = session?.status === "ended";
  const isLobby = session?.status === "lobby" || session?.status === "closed";

  return (
    <LeaderboardShell>
      {isEnded && <ConfettiShower />}

      {/* Click-to-enable sound overlay — shown only if AudioContext is still locked */}
      {!audioEnabled && (
        <div
          onClick={enableAudio}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)",
            cursor: "pointer", animation: "fade-in-slide 0.4s ease both"
          }}
        >
          <div style={{ fontSize: "64px", marginBottom: "16px" }}>&#128266;</div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: "28px" }}>Click to enable sound</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "15px", marginTop: "8px" }}>Kahoot-style audio will play during the quiz</div>
        </div>
      )}

      <main className={`projector-board ${isEnded ? "final-mode" : ""}`}>

        {/* Header */}
        <section className="projector-hero">
          <div>
            <span className="eyebrow">
              {isEnded ? "GRAND FINALE" : isLobby ? "LOBBY OPEN" : "LIVE LEADERBOARD"}
            </span>
            <h1>{session?.title ?? "Nimma Quiz"}</h1>
          </div>
          {/* Mute button */}
          <button
            onClick={toggleMute}
            title={muted ? "Unmute" : "Mute"}
            style={{
              position: "absolute", top: "16px", right: "16px",
              background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "50%", width: "44px", height: "44px",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "white", transition: "background 0.2s"
            }}
          >
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <div className="projector-round">
            {isLobby ? (
              <>
                <span><Users size={18} style={{ marginBottom: 4 }} /></span>
                <strong style={{ fontSize: "42px" }}>{players.length}</strong>
                <span style={{ fontSize: "11px", marginTop: "2px" }}>JOINED</span>
              </>
            ) : (
              <>
                <span>{isEnded ? "STATUS" : "QUESTION"}</span>
                <strong>
                  {isEnded ? "" : session
                    ? Math.min((session.activeQuestion ?? 0) + 1, session.questions?.length ?? 1)
                    : "-"}
                </strong>
              </>
            )}
          </div>
        </section>

        {/* LOBBY VIEW  live joined players grid */}
        {isLobby && (
          <section style={{ animation: "fade-in-slide 0.6s ease both" }}>
            <div style={{
              textAlign: "center",
              padding: "28px 20px 20px",
              background: "rgba(255,255,255,0.7)",
              borderRadius: "16px",
              border: "1px solid var(--line)",
              marginBottom: "24px",
              boxShadow: "var(--shadow)"
            }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                background: session?.status === "lobby" ? "rgba(14,159,110,0.12)" : "rgba(244,180,0,0.12)",
                border: `1px solid ${session?.status === "lobby" ? "rgba(14,159,110,0.3)" : "rgba(244,180,0,0.3)"}`,
                borderRadius: "999px",
                padding: "8px 20px",
                marginBottom: "16px"
              }}>
                <span style={{
                  display: "inline-block",
                  width: "10px", height: "10px",
                  borderRadius: "50%",
                  background: session?.status === "lobby" ? "var(--green)" : "var(--yellow)",
                  boxShadow: `0 0 10px ${session?.status === "lobby" ? "var(--green)" : "var(--yellow)"}`,
                  animation: "pulse 1.4s ease infinite"
                }} />
                <span style={{
                  fontWeight: 800, fontSize: "14px",
                  color: session?.status === "lobby" ? "var(--green)" : "#b45309",
                  textTransform: "uppercase", letterSpacing: "0.08em"
                }}>
                  {session?.status === "lobby" ? "Lobby Open  Players Can Join" : "Lobby Closed  Get Ready!"}
                </span>
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                {qrCodeData && (
                  <div style={{ background: "white", padding: "8px", borderRadius: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", display: "inline-block" }}>
                    <img src={qrCodeData} alt="Join QR Code" style={{ width: "220px", height: "220px", display: "block" }} />
                  </div>
                )}
                <p style={{ color: "var(--muted)", fontSize: "16px", margin: 0 }}>
                  {players.length === 0
                    ? "Waiting for players to scan the QR code and join..."
                    : `${players.length} player${players.length === 1 ? "" : "s"} ready and waiting for the quiz to start`}
                </p>
              </div>
            </div>

            {players.length === 0 ? (
              <div className="projector-empty" style={{ fontSize: "18px" }}>
                No players yet  share the QR code!
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "14px"
              }}>
                {players.map((player, index) => (
                  <div
                    key={`${player.indexNo}-${player.name}-${index}`}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      background: "rgba(255,255,255,0.9)",
                      border: "1px solid var(--line)",
                      borderRadius: "12px", padding: "14px 16px",
                      boxShadow: "0 4px 16px rgba(22,20,31,0.08)",
                      animation: "row-pop 400ms ease both",
                      animationDelay: `${Math.min(index * 40, 600)}ms`
                    }}
                  >
                    <div style={{
                      width: "38px", height: "38px", borderRadius: "50%",
                      background: `hsl(${(index * 47) % 360}, 70%, 58%)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "white", fontWeight: 900, fontSize: "17px", flexShrink: 0
                    }}>
                      {player.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ overflow: "hidden", minWidth: 0 }}>
                      <div style={{
                        fontWeight: 800, fontSize: "14px", color: "var(--ink)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                      }}>
                        {player.name}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                        {player.indexNo}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ENDED  Grand Podium */}
        {isEnded && (
          <section className="podium-section" style={{ animation: "fade-in-slide 0.8s ease both" }}>
            <div className="podium-container">
              <div className="podium-step silver">
                {podiumPlayers.silver && (
                  <div className="podium-avatar">
                    <span style={{ fontSize: "20px" }}></span>
                    <span className="podium-name">{podiumPlayers.silver.name}</span>
                    <span className="podium-index">{podiumPlayers.silver.indexNo}</span>
                    <span className="podium-score">{podiumPlayers.silver.score} pts</span>
                  </div>
                )}
                <div className="podium-block"><span className="podium-label">2</span></div>
              </div>
              <div className="podium-step gold">
                {podiumPlayers.gold && (
                  <div className="podium-avatar">
                    <span className="podium-crown"></span>
                    <span className="podium-name" style={{ fontSize: "22px", color: "var(--violet)" }}>{podiumPlayers.gold.name}</span>
                    <span className="podium-index">{podiumPlayers.gold.indexNo}</span>
                    <span className="podium-score" style={{ fontSize: "18px" }}>{podiumPlayers.gold.score} pts</span>
                  </div>
                )}
                <div className="podium-block"><span className="podium-label">1</span></div>
              </div>
              <div className="podium-step bronze">
                {podiumPlayers.bronze && (
                  <div className="podium-avatar">
                    <span style={{ fontSize: "20px" }}></span>
                    <span className="podium-name">{podiumPlayers.bronze.name}</span>
                    <span className="podium-index">{podiumPlayers.bronze.indexNo}</span>
                    <span className="podium-score">{podiumPlayers.bronze.score} pts</span>
                  </div>
                )}
                <div className="podium-block"><span className="podium-label">3</span></div>
              </div>
            </div>
            {remainingPlayers.length > 0 && (
              <div style={{ marginTop: "40px" }}>
                <h2 style={{ textAlign: "center", marginBottom: "20px", color: "var(--muted)", textTransform: "uppercase", fontSize: "14px", letterSpacing: "0.1em" }}>
                  Runner-ups &amp; Competitors
                </h2>
                <section className="projector-list">
                  {remainingPlayers.map((player, index) => (
                    <div className="projector-row" key={`${player.indexNo}-${player.name}-${index}`}>
                      <div className="projector-rank">{index + 4}</div>
                      <div><strong>{player.name}</strong><span>{player.indexNo}</span></div>
                      <div className="movement">
                        {(player.rankDelta ?? 0) > 0 && <><TrendingUp size={20} /> +{player.rankDelta}</>}
                        {(player.rankDelta ?? 0) < 0 && <><TrendingDown size={20} /> {player.rankDelta}</>}
                        {(player.rankDelta ?? 0) === 0 && <span style={{ color: "var(--muted)" }}>steady</span>}
                      </div>
                      <strong className="projector-score">{player.score}</strong>
                    </div>
                  ))}
                </section>
              </div>
            )}
          </section>
        )}

        {/* QUESTION VIEW  live or answer_reveal */}
        {(session?.status === "live" || session?.status === "answer_reveal") && (() => {
          const q = session.questions?.[session.activeQuestion];
          if (!q) return null;
          return (
            <section style={{ animation: "fade-in-slide 0.6s ease both", display: "flex", flexDirection: "column", height: "100%", justifyContent: "center" }}>
              {session.status === "live" && (
                <div style={{ textAlign: "center", marginBottom: "30px" }}>
                  <div style={{ fontSize: "16px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>Time Remaining</div>
                  <div style={{ fontSize: "64px", fontWeight: 900, lineHeight: 1, color: timeRemaining <= 5 ? "var(--red)" : timeRemaining <= 10 ? "var(--yellow)" : "var(--green)", transition: "color 0.5s" }}>
                    {timeRemaining}
                  </div>
                  <div style={{ margin: "16px auto 0", height: "8px", width: "100%", maxWidth: "600px", background: "rgba(0,0,0,0.05)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${(timeRemaining / (session.durationSeconds ?? 20)) * 100}%`,
                      background: timeRemaining <= 5 ? "var(--red)" : timeRemaining <= 10 ? "var(--yellow)" : "var(--green)",
                      borderRadius: "99px", transition: "width 0.25s linear, background 0.5s"
                    }} />
                  </div>
                </div>
              )}

              {session.status === "answer_reveal" && (
                <div style={{ textAlign: "center", marginBottom: "30px", animation: "pop-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)" }}>
                  <div style={{ fontSize: "20px", color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 800 }}>Time's Up!</div>
                  <div style={{ fontSize: "42px", fontWeight: 900, color: "var(--ink)" }}>Correct Answer</div>
                </div>
              )}

              <div style={{ textAlign: "center", marginBottom: "40px" }}>
                <h2 style={{ fontSize: "36px", fontWeight: 800, color: "var(--ink)", maxWidth: "800px", margin: "0 auto", lineHeight: 1.3 }}>{q.q}</h2>
              </div>

              {q.imageUrl && (
                <div style={{ textAlign: "center", marginBottom: "40px" }}>
                  <img src={q.imageUrl} alt="Question Image" style={{ maxWidth: "100%", maxHeight: "300px", borderRadius: "16px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }} />
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", maxWidth: "900px", margin: "0 auto", width: "100%" }}>
                {q.opts.map((opt, i) => {
                  const isReveal = session.status === "answer_reveal";
                  const isCorrect = i === q.ans;
                  return (
                    <div key={i} style={{
                      background: isReveal ? (isCorrect ? "var(--green)" : "rgba(0,0,0,0.05)") : "white",
                      color: isReveal ? (isCorrect ? "white" : "var(--muted)") : "var(--ink)",
                      padding: "24px 32px",
                      borderRadius: "16px",
                      fontSize: "24px",
                      fontWeight: 700,
                      boxShadow: isReveal && !isCorrect ? "none" : "0 8px 24px rgba(0,0,0,0.08)",
                      border: isReveal && !isCorrect ? "2px solid transparent" : "2px solid var(--line)",
                      display: "flex", alignItems: "center", gap: "20px",
                      transform: isReveal && isCorrect ? "scale(1.05)" : "scale(1)",
                      transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
                    }}>
                      <div style={{
                        width: "48px", height: "48px", borderRadius: "12px",
                        background: isReveal && isCorrect ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.05)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "24px", fontWeight: 900
                      }}>
                        {String.fromCharCode(65 + i)}
                      </div>
                      {opt}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* LEADERBOARD  ranked list */}
        {session?.status === "leaderboard" && (
          <>
            <section className="movers-strip">
              {topMovers.map((player, index) => (
                <div className="mover-card" key={`${player.indexNo}-${player.name}-${index}`}>
                  <span className="mover-rank">Round Mover #{index + 1}</span>
                  <strong>{player.name}</strong>
                  <span>{(player.rankDelta ?? 0) > 0 ? `+${player.rankDelta} places` : `${player.score} pts`}</span>
                </div>
              ))}
            </section>
            <section className="projector-list" style={{ position: "relative" }}>
              {players.length === 0 && <div className="projector-empty">Waiting for players to join.</div>}
              <AnimatePresence>
                {players.map((player, index) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className={`projector-row rank-${index + 1}`} 
                    key={`${player.indexNo}-${player.name}`}
                    style={{ position: "relative", zIndex: 100 - index }}
                  >
                    <div className="projector-rank">
                      {index === 0
                        ? <Trophy size={26} style={{ color: "#ffd700" }} />
                        : index < 3
                          ? <Award size={24} style={{ color: index === 1 ? "#cbd5e1" : "#f97316" }} />
                          : index + 1}
                    </div>
                    <div><strong>{player.name}</strong><span>{player.indexNo}</span></div>
                    <div className="movement">
                      {(player.rankDelta ?? 0) > 0 && <><TrendingUp size={20} /> +{player.rankDelta}</>}
                      {(player.rankDelta ?? 0) < 0 && <><TrendingDown size={20} /> {player.rankDelta}</>}
                      {(player.rankDelta ?? 0) === 0 && <span style={{ color: "var(--muted)" }}>steady</span>}
                    </div>
                    <strong className="projector-score">{player.score}</strong>
                  </motion.div>
                ))}
              </AnimatePresence>
            </section>
          </>
        )}
      </main>
    </LeaderboardShell>
  );
}

function LeaderboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="projector-shell">
      <header className="projector-topbar">
        <div className="brand"><span className="brand-mark"><Zap size={22} /></span> Nimma Quiz</div>
      </header>
      {children}
    </div>
  );
}
