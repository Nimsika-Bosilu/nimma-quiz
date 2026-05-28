"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState
} from "react";
import {
  collection, doc, onSnapshot, orderBy, query
} from "firebase/firestore";
import {
  BarChart2, TrendingDown, TrendingUp, Trophy, Users, Volume2, VolumeX, Zap
} from "lucide-react";
import QRCode from "qrcode";
import { getAnonymousUser, getDb, hasFirebaseConfig } from "@/lib/firebase";
import { Question } from "@/lib/quiz";
import { motion, AnimatePresence } from "framer-motion";
import {
  unlockAudio, setMuted,
  startLobbyMusic, stopLobbyMusic,
  sfxQuestionStart, sfxTick, sfxTimeUp, sfxAnswerReveal, sfxLeaderboard,
} from "@/lib/sounds";
import { BottomHighlightBar } from "./HighlightBar";
import Image from "next/image";

/* ══════════════════════════════════════════════════════════ Types ══════ */

type SessionControls = {
  frozen?: boolean;
  doublePts?: boolean;
  suddenDeath?: boolean;
  bonusRound?: boolean;
  analyticsVisible?: boolean;
  hideLeaderboard?: boolean;
};

type Session = {
  title: string;
  status: "lobby" | "closed" | "live" | "answer_reveal" | "leaderboard" | "ended";
  activeQuestion: number;
  questions?: Question[];
  durationSeconds?: number;
  questionStartedAt?: number;
  controls?: SessionControls;
};

type Player = {
  name: string;
  indexNo: string;
  score: number;
  streak?: number;
  speedMs?: number;
  totalAnswers?: number;
  correctAnswers?: number;
  rankDelta?: number;
};

/* ── Insight card types ─────────────────────────────────────────────── */
type InsightType =
  | "on_fire" | "speed_demon" | "rocket_rise" | "flawless"
  | "gap_close" | "neck_and_neck" | "dominator" | "dark_horse"
  | "drop_zone";

type Insight = {
  id: string;
  type: InsightType;
  targetKey: string;   // `${indexNo}-${name}` — matches rowRefs key
  targetRank: number;
  emoji: string;
  title: string;
  body: string;
  accent: string;      // CSS colour for border / glow
};

/* ══════════════════════════════════════════════════════ Helpers ════════ */

const AV_GRADS = [
  "linear-gradient(135deg,#00d4ff,#0072aa)",
  "linear-gradient(135deg,#7c3aed,#4c1d95)",
  "linear-gradient(135deg,#10b981,#065f46)",
  "linear-gradient(135deg,#f59e0b,#92400e)",
  "linear-gradient(135deg,#ef4444,#991b1b)",
  "linear-gradient(135deg,#ec4899,#9d174d)",
  "linear-gradient(135deg,#8b5cf6,#4c1d95)",
  "linear-gradient(135deg,#14b8a6,#134e4a)",
  "linear-gradient(135deg,#f97316,#7c2d12)",
  "linear-gradient(135deg,#84cc16,#365314)",
];

function avGrad(name: string): string {
  let h = 0;
  for (const c of name) h = ((h * 31) + c.charCodeAt(0)) & 0x7fffffff;
  return AV_GRADS[h % AV_GRADS.length];
}

/* ═══════════════════════════════════════════════════ Sub-components ════ */

function ConfettiShower() {
  const pieces = useMemo(() => {
    const colors = ["#ffd700","#00d4ff","#ef4444","#10b981","#a855f7","#ec4899","#f97316"];
    return Array.from({ length: 100 }).map((_, i) => ({
      id: i,
      style: {
        left: `${Math.random() * 100}%`,
        backgroundColor: colors[Math.floor(Math.random() * colors.length)],
        animationDelay: `${Math.random() * 5}s`,
        animationDuration: `${2.5 + Math.random() * 2.5}s`,
        width:  `${6 + Math.random() * 8}px`,
        height: `${4 + Math.random() * 9}px`,
        transform: `rotate(${-30 + Math.random() * 60}deg)`,
      },
    }));
  }, []);
  return (
    <div className="cq-confetti">
      {pieces.map(p => <div key={p.id} className="cq-piece" style={p.style} />)}
    </div>
  );
}

function CinematicBg() {
  return (
    <div className="cq-bg" aria-hidden>
      <div className="cq-bg-nebula" />
      <div className="cq-bg-grid" />
      <div className="cq-scan" />
    </div>
  );
}

/* ── Lobby ──────────────────────────────────────────────────────────── */
function LobbySection({
  players, qrCodeData, lobbyStatus,
}: { players: Player[]; qrCodeData: string; lobbyStatus: string }) {
  return (
    <div className="cq-lobby">
      <div className="cq-lobby-top">
        {qrCodeData && (
          <div className="cq-qr">
            <img src={qrCodeData} alt="Scan to Join" width={230} height={230} />
          </div>
        )}
        <div className="cq-lobby-info">
          <div className="cq-lobby-status">
            <span
              className="cq-status-dot"
              style={{ background: lobbyStatus === "lobby" ? "#10b981" : "#f59e0b" }}
            />
            <span style={{ color: lobbyStatus === "lobby" ? "#10b981" : "#f59e0b" }}>
              {lobbyStatus === "lobby" ? "Lobby Open — Players Can Join" : "Lobby Closed — Get Ready!"}
            </span>
          </div>
          <div>
            <div className="cq-big-num">{players.length}</div>
            <div className="cq-big-lbl">Players Joined</div>
          </div>
          <p className="cq-lobby-hint">
            {players.length === 0
              ? "Waiting for players to scan and join…"
              : `${players.length} player${players.length !== 1 ? "s" : ""} ready!`}
          </p>
        </div>
      </div>
      {players.length > 0 && (
        <div className="cq-players-grid">
          {players.map((p, i) => (
            <div
              key={`${p.indexNo}-${p.name}`}
              className="cq-player-chip"
              style={{ animationDelay: `${Math.min(i * 35, 700)}ms` }}
            >
              <div className="cq-chip-av" style={{ background: avGrad(p.name) }}>
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="cq-chip-name">{p.name}</div>
                <div className="cq-chip-idx">{p.indexNo}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Question / Answer Reveal ───────────────────────────────────────── */
function QuestionSection({
  session, timeRemaining, isReveal,
}: { session: Session; timeRemaining: number; isReveal: boolean }) {
  const q = session.questions?.[session.activeQuestion];
  if (!q) return null;
  const total  = q.timeLimitOverride ?? session.durationSeconds ?? 20;
  const pct    = total > 0 ? (timeRemaining / total) * 100 : 0;
  const tColor = timeRemaining <= 5 ? "#ef4444" : timeRemaining <= 10 ? "#f59e0b" : "#10b981";

  return (
    <div className="cq-question">
      {isReveal ? (
        <div className="cq-reveal-banner">
          <div className="cq-reveal-title">Correct Answer</div>
        </div>
      ) : (
        <div className="cq-timer-block">
          <div className="cq-timer-num" style={{ color: tColor }}>{timeRemaining}</div>
          <div className="cq-timer-bar-wrap">
            <div
              className="cq-timer-bar-fill"
              style={{
                width: `${pct}%`,
                background: tColor,
                boxShadow: `0 0 20px ${tColor}90`,
              }}
            />
          </div>
        </div>
      )}

      <div className="cq-q-num">Question {(session.activeQuestion ?? 0) + 1}</div>
      <div className="cq-q-text">{q.q}</div>

      {q.imageUrl && (
        <div style={{ position: "relative", width: "100%", height: "220px" }}>
          <Image 
            src={q.imageUrl} 
            alt="Question" 
            fill
            className="cq-q-img"
            style={{ objectFit: "contain" }}
            unoptimized
          />
        </div>
      )}

      <div className="cq-options">
        {q.opts.map((opt, i) => {
          const correct = i === q.ans;
          return (
            <div
              key={i}
              className={`cq-option${isReveal && correct ? " cq-opt-correct" : ""}${isReveal && !correct ? " cq-opt-wrong" : ""}`}
            >
              <div className="cq-opt-letter">{String.fromCharCode(65 + i)}</div>
              <span>{opt}</span>
              {isReveal && correct && <span className="cq-opt-tick">&#10003;</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Individual player row ──────────────────────────────────────────── */
function PlayerRow({ player, rank }: { player: Player; rank: number }) {
  const delta = player.rankDelta ?? 0;

  const rankDisplay = () => {
    if (rank === 1) return <Trophy size={22} />;
    return <span>{rank}</span>;
  };

  return (
    <div className="cq-row-inner">
      {/* Rank */}
      <div className="cq-rank">{rankDisplay()}</div>

      {/* Avatar */}
      <div className="cq-av" style={{ background: avGrad(player.name) }}>
        {player.name.charAt(0).toUpperCase()}
      </div>

      {/* Name + ID */}
      <div className="cq-pinfo">
        <div className="cq-pname">{player.name}</div>
        <div className="cq-pidx">{player.indexNo}</div>
      </div>

      {/* Badges */}
      <div className="cq-badges">
        {(player.streak ?? 0) >= 2 && (
          <span className="cq-fire">&#128293; {player.streak}</span>
        )}
        {player.speedMs && player.speedMs < 3000 && (
          <span className="cq-bolt">&#9889;</span>
        )}
      </div>

      {/* Score + delta */}
      <div className="cq-score">
        <span className="cq-score-num">{player.score}</span>
      </div>

      {/* Movement */}
      <div className="cq-move">
        {delta > 0 && <span className="cq-up"><TrendingUp size={18} /> {delta}</span>}
        {delta < 0 && <span className="cq-dn"><TrendingDown size={18} /> {Math.abs(delta)}</span>}
        {delta === 0 && <span className="cq-eq">—</span>}
      </div>
    </div>
  );
}

/* ── Insight card logic ─────────────────────────────────────────────── */
function computeInsights(players: Player[], session: Session | null): Insight[] {
  const out: Insight[] = [];

  players.slice(0, 10).forEach((p, i) => {
    const rank = i + 1;
    const key  = `${p.indexNo}-${p.name}`;
    const fn   = p.name.split(" ")[0];

    // 🔥 On Fire — streak of consecutive correct answers
    if ((p.streak ?? 0) >= 3)
      out.push({ id: `fire-${key}`, type: "on_fire", targetKey: key, targetRank: rank,
        emoji: "🔥", accent: "#f97316",
        title: `${fn} is ON FIRE!`,
        body:  `${p.streak} correct answers in a row!` });

    // ⚡ Speed Demon — lightning-fast correct answer
    if ((p.speedMs ?? 0) > 0 && (p.speedMs ?? 9999) < 2500 && (p.correctAnswers ?? 0) > 0)
      out.push({ id: `spd-${key}`, type: "speed_demon", targetKey: key, targetRank: rank,
        emoji: "⚡", accent: "#eab308",
        title: `${fn} — Lightning Speed!`,
        body:  `Fastest correct answer: ${((p.speedMs ?? 0) / 1000).toFixed(1)}s` });

    // 🚀 Rocket Rise — jumped many places
    if ((p.rankDelta ?? 0) >= 3)
      out.push({ id: `rise-${key}`, type: "rocket_rise", targetKey: key, targetRank: rank,
        emoji: "🚀", accent: "#10b981",
        title: `${fn} is Surging!`,
        body:  `Climbed ${p.rankDelta} places this round!` });

    // 🎯 Flawless — perfect accuracy across 3+ answers
    if ((p.totalAnswers ?? 0) >= 3 && (p.correctAnswers ?? 0) === (p.totalAnswers ?? 0))
      out.push({ id: `pure-${key}`, type: "flawless", targetKey: key, targetRank: rank,
        emoji: "🎯", accent: "#8b5cf6",
        title: `${fn} — Flawless!`,
        body:  `${p.correctAnswers}/${p.totalAnswers} correct — zero mistakes!` });

    // 🐎 Dark Horse — broke into top 3
    if (rank <= 3 && (p.rankDelta ?? 0) >= 2)
      out.push({ id: `dark-${key}`, type: "dark_horse", targetKey: key, targetRank: rank,
        emoji: "🐎", accent: "#ec4899",
        title: "Dark Horse!",
        body:  `${fn} surged into Top ${rank}!` });

    // 📉 Drop Zone — fell sharply
    if ((p.rankDelta ?? 0) <= -3)
      out.push({ id: `drop-${key}`, type: "drop_zone", targetKey: key, targetRank: rank,
        emoji: "📉", accent: "#ef4444",
        title: `${fn} dropped ${Math.abs(p.rankDelta!)} places!`,
        body:  "Time to fight back — anything can happen!" });
  });

  // ⚔️ Gap Close — 2nd approaching 1st
  if (players.length >= 2) {
    const gap = players[0].score - players[1].score;
    const fn2 = players[1].name.split(" ")[0];
    if (gap > 0 && gap < 600)
      out.push({ id: "gap-close", type: "gap_close",
        targetKey: `${players[1].indexNo}-${players[1].name}`, targetRank: 2,
        emoji: "⚔️", accent: "#f59e0b",
        title: `${fn2} is Closing In!`,
        body:  `Only ${gap} pts behind 1st place!` });

    // 👑 Dominator — massive lead
    if (gap > 1500)
      out.push({ id: "dominator", type: "dominator",
        targetKey: `${players[0].indexNo}-${players[0].name}`, targetRank: 1,
        emoji: "👑", accent: "#ffd700",
        title: `${players[0].name.split(" ")[0]} Dominates!`,
        body:  `Crushing lead of ${gap} points!` });
  }

  // 🤝 Neck & Neck — two consecutive players within 100 pts
  for (let i = 0; i < Math.min(players.length - 1, 8); i++) {
    const a = players[i], b = players[i + 1];
    const diff = a.score - b.score;
    if (diff >= 0 && diff <= 100) {
      out.push({ id: `neck-${i}`, type: "neck_and_neck",
        targetKey: `${b.indexNo}-${b.name}`, targetRank: i + 2,
        emoji: "🤝", accent: "#00d4ff",
        title: "Neck & Neck!",
        body:  `${a.name.split(" ")[0]} vs ${b.name.split(" ")[0]} — just ${diff} pts apart!` });
      break;
    }
  }

  // ⏰ Final-question pressure
  const totalQ = session?.questions?.length ?? 0;
  const doneQ  = (session?.activeQuestion ?? 0) + 1;
  if (totalQ > 0 && totalQ - doneQ === 1 && players.length >= 2) {
    const gap = players[0].score - players[1].score;
    const fn2 = players[1].name.split(" ")[0];
    out.push({ id: "final-q", type: "gap_close",
      targetKey: `${players[1].indexNo}-${players[1].name}`, targetRank: 2,
      emoji: "⏰", accent: "#f59e0b",
      title: "FINAL QUESTION NEXT!",
      body:  `${fn2} needs ${gap + 1}+ pts to take the lead!` });
  }

  return out;
}

/* ── Floating Insight Card component ────────────────────────────────── */
function FloatingInsightCard({
  insight, uid, rowRefs,
}: {
  insight: Insight;
  uid: number;
  rowRefs: { current: Map<string, HTMLDivElement> };
}) {
  const [pos, setPos] = useState<number | null>(null);

  useEffect(() => {
    const compute = () => {
      const el = rowRefs.current.get(insight.targetKey);
      if (!el) { setPos(null); return; }
      const rect = el.getBoundingClientRect();
      setPos(rect.top + rect.height / 2);
    };
    compute();
    const t = window.setTimeout(compute, 180);
    return () => window.clearTimeout(t);
  }, [insight.targetKey, uid, rowRefs]);

  return (
    <AnimatePresence mode="wait">
      {pos !== null && (
        <motion.div
          key={uid}
          className="cq-insight"
          style={{
            top: pos,
            borderColor: insight.accent,
            boxShadow: `0 0 32px ${insight.accent}55, 0 10px 48px rgba(0,0,0,0.8)`,
          }}
          initial={{ opacity: 0, x: 90, scale: 0.82 }}
          animate={{ opacity: 1, x: 0,  scale: 1 }}
          exit={{    opacity: 0, x: 90, scale: 0.82 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
        >
          <div className="cq-insight-arrow" style={{ borderRightColor: insight.accent }} />
          <div className="cq-insight-emoji">{insight.emoji}</div>
          <div className="cq-insight-text">
            <div className="cq-insight-title" style={{ color: insight.accent }}>{insight.title}</div>
            <div className="cq-insight-body">{insight.body}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Leaderboard (ranked list) ──────────────────────────────────────── */
function LeaderboardSection({ players, topMovers, rowRefs }: {
  players: Player[];
  topMovers: Player[];
  rowRefs: { current: Map<string, HTMLDivElement> };
}) {
  const top  = players.slice(0, 10);
  const rest = players.slice(10, 20);

  return (
    <div className="cq-leaderboard">
      {/* Climbers strip */}
      {topMovers.some(m => (m.rankDelta ?? 0) > 0) && (
        <div className="cq-movers">
          {topMovers.filter(m => (m.rankDelta ?? 0) > 0).map((m, i) => (
            <div className="cq-mover-chip" key={i}>
              <span className="cq-mover-lbl">&#128200; Climber</span>
              <strong>{m.name}</strong>
              <span className="cq-mover-d">+{m.rankDelta}</span>
            </div>
          ))}
        </div>
      )}

      {/* Column headers */}
      <div className="cq-leader-cols">
        <span>#</span>
        <span></span>
        <span>Player</span>
        <span>Badges</span>
        <span style={{ textAlign: "right" }}>Score</span>
        <span style={{ textAlign: "center" }}>Move</span>
      </div>

      {/* Top-10 animated rows */}
      <AnimatePresence>
        {top.map((p, i) => (
          <motion.div
            key={`${p.indexNo}-${p.name}`}
            ref={(el: HTMLDivElement | null) => {
              const k = `${p.indexNo}-${p.name}`;
              if (el) rowRefs.current.set(k, el);
              else rowRefs.current.delete(k);
            }}
            layout
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 320, damping: 32, delay: i * 0.025 }}
            className={`cq-row-wrap r${Math.min(i + 1, 4)}`}
          >
            <PlayerRow player={p} rank={i + 1} />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Rest (11-20) */}
      {rest.length > 0 && (
        <>
          <div className="cq-divider"><span>Other Competitors</span></div>
          <div className="cq-rest">
            {rest.map((p, i) => (
              <div key={`rest-${p.indexNo}`} className="cq-rest-row">
                <span className="cq-rest-rank">#{i + 11}</span>
                <div className="cq-mini-av" style={{ background: avGrad(p.name) }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <span className="cq-rest-name">{p.name}</span>
                <span className="cq-rest-score">{p.score}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Podium (ended) ─────────────────────────────────────────────────── */
function PodiumSection({
  gold, silver, bronze, remaining,
}: { gold: Player | null; silver: Player | null; bronze: Player | null; remaining: Player[] }) {
  return (
    <div className="cq-podium-wrap">
      <div className="cq-podium-headline">
        <Trophy size={30} color="#ffd700" />
        Final Results
        <Trophy size={30} color="#ffd700" />
      </div>

      <div className="cq-stage">
        {/* Silver — 2nd */}
        <motion.div
          className="cq-slot"
          initial={{ opacity: 0, y: 70 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, type: "spring", stiffness: 200, damping: 22 }}
        >
          {silver && (
            <div className="cq-pcard">
              <div className="cq-pav" style={{ background: avGrad(silver.name) }}>
                {silver.name.charAt(0).toUpperCase()}
              </div>
              <div className="cq-pname">{silver.name}</div>
              <div className="cq-pidx2">{silver.indexNo}</div>
              <div className="cq-pscore cq-pscore-silver">{silver.score} pts</div>
            </div>
          )}
          <div className="cq-block cq-block-silver">
            <span className="cq-block-num">2</span>
          </div>
        </motion.div>

        {/* Gold — 1st */}
        <motion.div
          className="cq-slot"
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 22 }}
        >
          {gold && (
            <div className="cq-pcard cq-pcard-gold">
              <div className="cq-crown">&#128081;</div>
              <div className="cq-pav cq-pav-gold" style={{ background: avGrad(gold.name) }}>
                {gold.name.charAt(0).toUpperCase()}
              </div>
              <div className="cq-pname cq-pname-gold">{gold.name}</div>
              <div className="cq-pidx2">{gold.indexNo}</div>
              <div className="cq-pscore cq-pscore-gold">{gold.score} pts</div>
            </div>
          )}
          <div className="cq-block cq-block-gold">
            <span className="cq-block-num">1</span>
          </div>
        </motion.div>

        {/* Bronze — 3rd */}
        <motion.div
          className="cq-slot"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, type: "spring", stiffness: 200, damping: 22 }}
        >
          {bronze && (
            <div className="cq-pcard">
              <div className="cq-pav" style={{ background: avGrad(bronze.name) }}>
                {bronze.name.charAt(0).toUpperCase()}
              </div>
              <div className="cq-pname">{bronze.name}</div>
              <div className="cq-pidx2">{bronze.indexNo}</div>
              <div className="cq-pscore cq-pscore-bronze">{bronze.score} pts</div>
            </div>
          )}
          <div className="cq-block cq-block-bronze">
            <span className="cq-block-num">3</span>
          </div>
        </motion.div>
      </div>

      {/* All remaining players */}
      {remaining.length > 0 && (
        <div className="cq-remaining">
          <div className="cq-divider"><span>All Competitors</span></div>
          <div className="cq-rem-list">
            {remaining.map((p, i) => (
              <div key={`rem-${p.indexNo}-${i}`} className="cq-rem-row">
                <span className="cq-rem-rank">#{i + 4}</span>
                <div className="cq-mini-av" style={{ background: avGrad(p.name) }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <span className="cq-rem-name">{p.name}</span>
                <span className="cq-rem-score">{p.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Analytics bar ──────────────────────────────────────────────────── */
type AnalyticsData = {
  activeCount: number;
  avgAccuracy: number | null;
  topStreak: number;
  fastest: Player | null;
  mostImproved: Player | null;
};

function AnalyticsBar({ data }: { data: AnalyticsData }) {
  return (
    <div className="cq-analytics">
      <div className="cq-analytic-item">
        <span className="cq-analytic-icon"><Users size={16} /></span>
        <span className="cq-analytic-val">{data.activeCount}</span>
        <span className="cq-analytic-lbl">Active</span>
      </div>
      {data.avgAccuracy !== null && (
        <div className="cq-analytic-item">
          <span className="cq-analytic-icon"><BarChart2 size={16} /></span>
          <span className="cq-analytic-val">{data.avgAccuracy.toFixed(0)}%</span>
          <span className="cq-analytic-lbl">Avg Accuracy</span>
        </div>
      )}
      {data.topStreak > 0 && (
        <div className="cq-analytic-item">
          <span className="cq-analytic-icon" style={{ fontSize: 16 }}>&#128293;</span>
          <span className="cq-analytic-val">{data.topStreak}</span>
          <span className="cq-analytic-lbl">Best Streak</span>
        </div>
      )}
      {data.fastest?.speedMs && (
        <div className="cq-analytic-item">
          <span className="cq-analytic-icon" style={{ fontSize: 16 }}>&#9889;</span>
          <span className="cq-analytic-val">{data.fastest.name.split(" ")[0]}</span>
          <span className="cq-analytic-lbl">Fastest</span>
        </div>
      )}
      {data.mostImproved && (data.mostImproved.rankDelta ?? 0) > 0 && (
        <div className="cq-analytic-item">
          <span className="cq-analytic-icon"><TrendingUp size={16} /></span>
          <span className="cq-analytic-val">{data.mostImproved.name.split(" ")[0]}</span>
          <span className="cq-analytic-lbl">Most Improved</span>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════ Main Page ═════ */

export default function ProjectorLeaderboardPage() {
  /* ── State ── */
  const [sessionId,    setSessionId]    = useState("");
  const [session,      setSession]      = useState<Session | null>(null);
  const [players,      setPlayers]      = useState<Player[]>([]);
  const [authReady,    setAuthReady]    = useState(false);
  const [qrCodeData,   setQrCodeData]   = useState("");
  const [timeRemaining,setTimeRemaining]= useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [muted,        setMutedState]   = useState(false);

  const previousRanks  = useRef<Record<string, number>>({});
  const prevStatusRef  = useRef<string | null>(null);
  const prevTickSecRef = useRef(-1);
  const rowRefs        = useRef<Map<string, HTMLDivElement>>(new Map());

  const [insightIdx,   setInsightIdx]   = useState(0);
  const [insightUid,   setInsightUid]   = useState(0);

  /* ── URL param ── */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setSessionId(p.get("session") ?? "");
  }, []);

  /* ── QR code ── */
  useEffect(() => {
    if (!sessionId) return;
    const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
    const url  = `${window.location.origin}${base}/?session=${encodeURIComponent(sessionId)}`;
    QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: "#000", light: "#fff" } })
      .then(setQrCodeData).catch(console.error);
  }, [sessionId]);

  /* ── Timer countdown ── */
  useEffect(() => {
    if (!session?.questionStartedAt || session.status !== "live") {
      setTimeRemaining(0);
      return;
    }
    const tick = () => {
      const q   = session.questions?.[session.activeQuestion];
      const dur = (q?.timeLimitOverride ?? session.durationSeconds ?? 20) * 1000;
      const left = Math.max(0, Math.ceil((session.questionStartedAt! + dur - Date.now()) / 1000));
      setTimeRemaining(left);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [session]);

  /* ── Audio ── */
  const enableAudio = useCallback(() => { unlockAudio(); setAudioEnabled(true); }, []);
  useEffect(() => { try { unlockAudio(); setAudioEnabled(true); } catch { /* needs gesture */ } }, []);
  const toggleMute  = useCallback(() => {
    const n = !muted;
    setMutedState(n); setMuted(n);
    if (n) stopLobbyMusic();
    else if (session?.status === "lobby" || session?.status === "closed") startLobbyMusic();
  }, [muted, session?.status]);

  /* ── Sounds on status change ── */
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = session?.status ?? null;
    prevStatusRef.current = curr;
    if (!audioEnabled) return;
    if (curr === "lobby" || curr === "closed") {
      if (prev !== "lobby" && prev !== "closed") startLobbyMusic();
    } else {
      stopLobbyMusic();
    }
    if (curr === "live"          && prev !== "live")          sfxQuestionStart();
    if (curr === "answer_reveal" && prev !== "answer_reveal") { sfxTimeUp(); setTimeout(sfxAnswerReveal, 900); }
    if (curr === "leaderboard"   && prev !== "leaderboard")   sfxLeaderboard();
    if (curr === "ended"         && prev !== "ended")         sfxLeaderboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, audioEnabled]);

  /* ── Countdown ticks ── */
  useEffect(() => {
    if (!audioEnabled || session?.status !== "live" || timeRemaining <= 0) {
      prevTickSecRef.current = -1; return;
    }
    if (timeRemaining !== prevTickSecRef.current) {
      prevTickSecRef.current = timeRemaining;
      sfxTick(timeRemaining);
    }
  }, [timeRemaining, session?.status, audioEnabled]);

  /* ── Auth ── */
  useEffect(() => {
    if (!hasFirebaseConfig) return;
    getAnonymousUser().then(() => setAuthReady(true)).catch(() => setAuthReady(true));
  }, []);

  /* ── Firestore listeners ── */
  useEffect(() => {
    if (!hasFirebaseConfig || !sessionId.trim() || !authReady) return;
    const db = getDb();
    const unsubSession = onSnapshot(doc(db, "sessions", sessionId.trim()), snap => {
      setSession(snap.exists() ? (snap.data() as Session) : null);
    });
    const leaderQ = query(
      collection(db, "sessions", sessionId.trim(), "players"),
      orderBy("score", "desc"),
    );
    const unsubPlayers = onSnapshot(leaderQ, snap => {
      const next = snap.docs.map((item, i) => {
        const data = item.data() as Player;
        const prev = previousRanks.current[item.id] ?? i + 1;
        return { ...data, rankDelta: prev - (i + 1) };
      });
      previousRanks.current = Object.fromEntries(snap.docs.map((d, i) => [d.id, i + 1]));
      setPlayers(next);
    });
    return () => { unsubSession(); unsubPlayers(); };
  }, [sessionId, authReady]);

  /* ── Computed values ── */
  const podium = useMemo(() => ({
    gold:   players[0] ?? null,
    silver: players[1] ?? null,
    bronze: players[2] ?? null,
  }), [players]);

  const remaining = useMemo(() => players.slice(3), [players]);

  const topMovers = useMemo(() => {
    const movers = players
      .filter(p => (p.rankDelta ?? 0) > 0)
      .sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0))
      .slice(0, 3);
    return movers.length ? movers : players.slice(0, 3);
  }, [players]);

  const analytics = useMemo((): AnalyticsData => {
    const withAns  = players.filter(p => (p.totalAnswers ?? 0) > 0);
    const avgAcc   = withAns.length
      ? withAns.reduce((s, p) => s + ((p.correctAnswers ?? 0) / (p.totalAnswers ?? 1) * 100), 0) / withAns.length
      : null;
    const topStreak = players.reduce((m, p) => Math.max(m, p.streak ?? 0), 0);
    const fastest   = [...players].sort((a, b) => (a.speedMs ?? 999999) - (b.speedMs ?? 999999))[0] ?? null;
    const improved  = [...players].sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0))[0] ?? null;
    return { activeCount: players.length, avgAccuracy: avgAcc, topStreak, fastest, mostImproved: improved };
  }, [players]);

  /* ── Insights (computed per leaderboard view) ── */
  const insights = useMemo(
    () => session?.status === "leaderboard" ? computeInsights(players, session) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.status, players]
  );

  // Cycle through floating insight cards every 4.5 s while board is shown
  useEffect(() => {
    if (session?.status !== "leaderboard" || insights.length === 0) {
      setInsightIdx(0);
      return;
    }
    setInsightIdx(0);
    setInsightUid(u => u + 1);
    const id = window.setInterval(() => {
      setInsightIdx(i => (i + 1) % insights.length);
      setInsightUid(u => u + 1);
    }, 4500);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, insights.length]);

  /* ── Guards ── */
  if (!hasFirebaseConfig) {
    return (
      <div className="cq-shell">
        <CinematicBg />
        <div className="cq-error">Firebase not configured.</div>
      </div>
    );
  }
  if (!sessionId) {
    return (
      <div className="cq-shell">
        <CinematicBg />
        <div className="cq-error">Missing session code in URL.</div>
      </div>
    );
  }

  /* ── Derived flags ── */
  const status  = session?.status ?? null;
  const ctrl    = session?.controls;
  const isLobby = status === "lobby" || status === "closed";
  const isLive  = status === "live";
  const isReveal= status === "answer_reveal";
  const isBoard = status === "leaderboard";
  const isEnded = status === "ended";
  const showBar = (isLive || isReveal || isBoard) && players.length >= 2;

  /* ── Render ── */
  return (
    <div className="cq-shell">
      <CinematicBg />
      {isEnded && <ConfettiShower />}

      {/* Audio enable overlay */}
      {!audioEnabled && (
        <div className="cq-audio-overlay" onClick={enableAudio}>
          <div className="cq-audio-icon">&#128266;</div>
          <div className="cq-audio-title">Click to Enable Sound</div>
          <div className="cq-audio-sub">Kahoot-style audio will play during the quiz</div>
        </div>
      )}

      {/* Frozen leaderboard overlay */}
      {ctrl?.frozen && (
        <div className="cq-frozen">
          <div className="cq-frozen-tag">&#10052; LEADERBOARD FROZEN</div>
        </div>
      )}

      {/* Mode badges — stacked vertically so they never overlap */}
      <div className="cq-mode-stack">
        {ctrl?.doublePts   && (
          <div className="cq-mode cq-mode-gold">
            <span className="cq-mode-icon">⭐</span>
            DOUBLE POINTS ACTIVE
          </div>
        )}
        {ctrl?.suddenDeath && (
          <div className="cq-mode cq-mode-red">
            <span className="cq-mode-icon">☠</span>
            SUDDEN DEATH MODE
          </div>
        )}
        {ctrl?.bonusRound  && (
          <div className="cq-mode cq-mode-purple">
            <span className="cq-mode-icon">◆</span>
            BONUS ROUND
          </div>
        )}
      </div>

      {/* Mute button */}
      <button className="cq-mute" onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
        {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>

      {/* ── Main content ── */}
      <div className={`cq-content${showBar ? " cq-content-with-bar" : ""}`}>

        {/* Header */}
        <header className="cq-header">
          <div className="cq-brand">
            <Zap size={22} style={{ filter: "drop-shadow(0 0 6px rgba(0,212,255,0.8))" }} />
            Nimma Quiz
          </div>

          <div className="cq-title-center">
            <h1 className="cq-main-title">{session?.title ?? "Nimma Quiz"}</h1>
            <div className="cq-status-row">
              {(isLive || isReveal) && (
                <span className="cq-badge cq-badge-live">
                  <span className="cq-live-dot" />
                  LIVE
                </span>
              )}
              {isLobby  && <span className="cq-badge cq-badge-lobby">LOBBY OPEN</span>}
              {isBoard  && <span className="cq-badge cq-badge-leader">LEADERBOARD</span>}
              {isEnded  && <span className="cq-badge cq-badge-ended">FINAL RESULTS</span>}
            </div>
          </div>

          <div className="cq-header-right">
            <div className="cq-chip">
              <span className="cq-chip-val">{players.length}</span>
              <span className="cq-chip-lbl">Players</span>
            </div>
            {(isLive || isReveal || isBoard) && session && (
              <div className="cq-chip">
                <span className="cq-chip-val">Q{(session.activeQuestion ?? 0) + 1}</span>
                <span className="cq-chip-lbl">Round</span>
              </div>
            )}
          </div>
        </header>

        {/* Lobby */}
        {isLobby && (
          <LobbySection
            players={players}
            qrCodeData={qrCodeData}
            lobbyStatus={status!}
          />
        )}

        {/* Question / Answer Reveal */}
        {(isLive || isReveal) && session && (
          <QuestionSection
            session={session}
            timeRemaining={timeRemaining}
            isReveal={isReveal}
          />
        )}

        {/* Leaderboard */}
        {isBoard && !ctrl?.hideLeaderboard && (
          <LeaderboardSection players={players} topMovers={topMovers} rowRefs={rowRefs} />
        )}
        {isBoard && ctrl?.hideLeaderboard && (
          <div className="cq-hidden">
            <div>&#128683;</div>
            <div>Leaderboard Hidden</div>
          </div>
        )}

        {/* Final podium */}
        {isEnded && (
          <PodiumSection
            gold={podium.gold}
            silver={podium.silver}
            bronze={podium.bronze}
            remaining={remaining}
          />
        )}

        {/* Analytics bar */}
        {ctrl?.analyticsVisible && players.length > 0 && (
          <AnalyticsBar data={analytics} />
        )}

      </div>

      {/* ── Bottom highlight bar (fixed) ── */}
      {showBar && (
        <BottomHighlightBar
          players={players}
          session={session}
          sessionId={sessionId}
        />
      )}

      {/* ── Floating insight cards — positioned dynamically next to player rows ── */}
      <AnimatePresence mode="wait">
        {isBoard && !ctrl?.hideLeaderboard && insights.length > 0 && (
          <FloatingInsightCard
            key={insightUid}
            insight={insights[insightIdx % insights.length]}
            uid={insightUid}
            rowRefs={rowRefs}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
