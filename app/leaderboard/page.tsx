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

  if (!hasFirebaseConfig) {
    return <LeaderboardShell><div className="projector-empty">Firebase is not configured.</div></LeaderboardShell>;
  }

  if (!sessionId) {
    return <LeaderboardShell><div className="projector-empty">Missing session code.</div></LeaderboardShell>;
  }

  return (
    <LeaderboardShell>
      <main className={`projector-board ${session?.status === "ended" ? "final-mode" : ""}`}>
        <section className="projector-hero">
          <div>
            <span className="eyebrow">{session?.status === "ended" ? "Final leaderboard" : "Live leaderboard"}</span>
            <h1>{session?.title ?? "Nimma Quiz"}</h1>
          </div>
          <div className="projector-round">
            <span>Question</span>
            <strong>{session ? Math.min((session.activeQuestion ?? 0) + 1, session.questions?.length ?? 1) : "-"}</strong>
          </div>
        </section>

        <section className="movers-strip">
          {topMovers.map((player, index) => (
            <div className="mover-card" key={`${player.indexNo}-${player.name}`}>
              <span className="mover-rank">Top {index + 1}</span>
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
                {index === 0 ? <Trophy size={26} /> : index < 3 ? <Award size={24} /> : index + 1}
              </div>
              <div>
                <strong>{player.name}</strong>
                <span>{player.indexNo}</span>
              </div>
              <div className="movement">
                {(player.rankDelta ?? 0) > 0 && <><TrendingUp size={20} /> +{player.rankDelta}</>}
                {(player.rankDelta ?? 0) < 0 && <><TrendingDown size={20} /> {player.rankDelta}</>}
                {(player.rankDelta ?? 0) === 0 && <span>steady</span>}
              </div>
              <strong className="projector-score">{player.score}</strong>
            </div>
          ))}
        </section>
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
