"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { Award, TrendingDown, TrendingUp, Trophy, Zap } from "lucide-react";
import { getDb, hasFirebaseConfig } from "@/lib/firebase";

type Session = {
  title: string;
  status: "lobby" | "live" | "leaderboard" | "ended";
  activeQuestion: number;
  questions?: unknown[];
};

type Player = {
  name: string;
  indexNo: string;
  score: number;
  rankDelta?: number;
};

// Pure CSS Confetti Shower Component
function ConfettiShower() {
  const pieces = useMemo(() => {
    const colors = ["#fbbf24", "#3b82f6", "#ef4444", "#10b981", "#a855f7", "#ec4899", "#06b6d4"];
    return Array.from({ length: 80 }).map((_, i) => {
      const left = Math.random() * 100; // 0 to 100vw
      const color = colors[Math.floor(Math.random() * colors.length)];
      const delay = Math.random() * 4; // 0s to 4s
      const duration = 2.5 + Math.random() * 2; // 2.5s to 4.5s
      const size = 6 + Math.random() * 8; // 6px to 14px
      const skew = -20 + Math.random() * 40; // skew rotation angle
      
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
  const previousRanks = useRef<Record<string, number>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionId(params.get("session") ?? "");
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !sessionId.trim()) return;
    const db = getDb();
    const unsubSession = onSnapshot(doc(db, "sessions", sessionId.trim()), (snap) => {
      setSession(snap.exists() ? snap.data() as Session : null);
    });
    const leaderQuery = query(collection(db, "sessions", sessionId.trim(), "players"), orderBy("score", "desc"));
    const unsubPlayers = onSnapshot(leaderQuery, (snap) => {
      const nextPlayers = snap.docs.map((item, index) => {
        const data = item.data() as Player;
        const key = item.id;
        const previousRank = previousRanks.current[key] ?? index + 1;
        return {
          ...data,
          rankDelta: previousRank - (index + 1)
        };
      });
      previousRanks.current = Object.fromEntries(snap.docs.map((item, index) => [item.id, index + 1]));
      setPlayers(nextPlayers);
    });
    return () => {
      unsubSession();
      unsubPlayers();
    };
  }, [sessionId]);

  const topMovers = useMemo(() => {
    const movers = players
      .filter((player) => (player.rankDelta ?? 0) > 0)
      .sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0))
      .slice(0, 3);
    return movers.length ? movers : players.slice(0, 3);
  }, [players]);

  const podiumPlayers = useMemo(() => {
    return {
      gold: players[0] || null,
      silver: players[1] || null,
      bronze: players[2] || null,
    };
  }, [players]);

  const remainingPlayers = useMemo(() => {
    return players.slice(3);
  }, [players]);

  if (!hasFirebaseConfig) {
    return <LeaderboardShell><div className="projector-empty">Firebase is not configured.</div></LeaderboardShell>;
  }

  if (!sessionId) {
    return <LeaderboardShell><div className="projector-empty">Missing session code.</div></LeaderboardShell>;
  }

  const isEnded = session?.status === "ended";

  return (
    <LeaderboardShell>
      {isEnded && <ConfettiShower />}

      <main className={`projector-board ${isEnded ? "final-mode" : ""}`}>
        <section className="projector-hero">
          <div>
            <span className="eyebrow">{isEnded ? "✨ GRAND FINALE ✨" : "LIVE LEADERBOARD"}</span>
            <h1>{session?.title ?? "Nimma Quiz"}</h1>
          </div>
          <div className="projector-round">
            <span>{isEnded ? "STATUS" : "QUESTION"}</span>
            <strong>{isEnded ? "🎉" : session ? Math.min((session.activeQuestion ?? 0) + 1, session.questions?.length ?? 1) : "-"}</strong>
          </div>
        </section>

        {isEnded ? (
          /* Spectacular Final 3D Podium View */
          <section className="podium-section" style={{ animation: "fade-in-slide 0.8s ease both" }}>
            <div className="podium-container">
              {/* 2nd Place (Silver) */}
              <div className="podium-step silver">
                {podiumPlayers.silver && (
                  <div className="podium-avatar">
                    <span style={{ fontSize: "20px" }}>🥈</span>
                    <span className="podium-name">{podiumPlayers.silver.name}</span>
                    <span className="podium-index">{podiumPlayers.silver.indexNo}</span>
                    <span className="podium-score">{podiumPlayers.silver.score} pts</span>
                  </div>
                )}
                <div className="podium-block">
                  <span className="podium-label">2</span>
                </div>
              </div>

              {/* 1st Place (Gold) */}
              <div className="podium-step gold">
                {podiumPlayers.gold && (
                  <div className="podium-avatar">
                    <span className="podium-crown">👑</span>
                    <span className="podium-name" style={{ fontSize: "22px", color: "var(--violet)" }}>{podiumPlayers.gold.name}</span>
                    <span className="podium-index">{podiumPlayers.gold.indexNo}</span>
                    <span className="podium-score" style={{ fontSize: "18px" }}>{podiumPlayers.gold.score} pts</span>
                  </div>
                )}
                <div className="podium-block">
                  <span className="podium-label">1</span>
                </div>
              </div>

              {/* 3rd Place (Bronze) */}
              <div className="podium-step bronze">
                {podiumPlayers.bronze && (
                  <div className="podium-avatar">
                    <span style={{ fontSize: "20px" }}>🥉</span>
                    <span className="podium-name">{podiumPlayers.bronze.name}</span>
                    <span className="podium-index">{podiumPlayers.bronze.indexNo}</span>
                    <span className="podium-score">{podiumPlayers.bronze.score} pts</span>
                  </div>
                )}
                <div className="podium-block">
                  <span className="podium-label">3</span>
                </div>
              </div>
            </div>

            {/* List all remaining participants below podium */}
            {remainingPlayers.length > 0 && (
              <div style={{ marginTop: "40px" }}>
                <h2 style={{ textAlign: "center", marginBottom: "20px", color: "var(--muted)", textTransform: "uppercase", fontSize: "14px", letterSpacing: "0.1em" }}>Runner-ups & Competitors</h2>
                <section className="projector-list">
                  {remainingPlayers.map((player, index) => (
                    <div className="projector-row" key={`${player.indexNo}-${player.name}`}>
                      <div className="projector-rank">
                        {index + 4}
                      </div>
                      <div>
                        <strong>{player.name}</strong>
                        <span>{player.indexNo}</span>
                      </div>
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
        ) : (
          /* Live Leaderboard showing all players with rank badges */
          <>
            <section className="movers-strip">
              {topMovers.map((player, index) => (
                <div className="mover-card" key={`${player.indexNo}-${player.name}`}>
                  <span className="mover-rank">Round Mover #{index + 1}</span>
                  <strong>{player.name}</strong>
                  <span>{(player.rankDelta ?? 0) > 0 ? `+${player.rankDelta} places` : `${player.score} pts`}</span>
                </div>
              ))}
            </section>

            <section className="projector-list">
              {players.length === 0 && <div className="projector-empty">Waiting for players to join.</div>}
              {players.map((player, index) => (
                <div className={`projector-row rank-${index + 1}`} key={`${player.indexNo}-${player.name}`}>
                  <div className="projector-rank">
                    {index === 0 ? (
                      <Trophy size={26} style={{ color: "#ffd700" }} />
                    ) : index < 3 ? (
                      <Award size={24} style={{ color: index === 1 ? "#cbd5e1" : "#f97316" }} />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <div>
                    <strong>{player.name}</strong>
                    <span>{player.indexNo}</span>
                  </div>
                  <div className="movement">
                    {(player.rankDelta ?? 0) > 0 && <><TrendingUp size={20} /> +{player.rankDelta}</>}
                    {(player.rankDelta ?? 0) < 0 && <><TrendingDown size={20} /> {player.rankDelta}</>}
                    {(player.rankDelta ?? 0) === 0 && <span style={{ color: "var(--muted)" }}>steady</span>}
                  </div>
                  <strong className="projector-score">{player.score}</strong>
                </div>
              ))}
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
