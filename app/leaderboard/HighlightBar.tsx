"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import { getDb, hasFirebaseConfig } from "@/lib/firebase";

/* ══════════════════════════════════════════════════════════════ Types ═ */

export type Priority = "critical" | "high" | "normal";

export type LiveEvent = {
  id: string;
  type: string;
  priority: Priority;
  headline: string;
  subline?: string;
  icon: string;
  playerName?: string;
  accentColor?: string;
  createdAt?: number;
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
  status: string;
  activeQuestion?: number;
  questions?: any[];
  controls?: SessionControls;
};

/* ══════════════════════════════════════════════════════ Avatar util ══ */

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

/* ═══════════════════════════════════════════════ Event generator ═══ */

function generateEvents(players: Player[], session: Session | null): LiveEvent[] {
  const events: LiveEvent[] = [];
  if (!players.length) return events;

  /* ── Mode events (critical) ── */
  if (session?.controls?.doublePts) {
    events.push({
      id: "mode-double-pts",
      type: "MODE_DOUBLE",
      priority: "critical",
      headline: "DOUBLE POINTS!",
      subline: "All answers are worth 2× points right now!",
      icon: "⭐",
      accentColor: "#ffd700",
    });
  }
  if (session?.controls?.suddenDeath) {
    events.push({
      id: "mode-sudden-death",
      type: "MODE_SUDDEN",
      priority: "critical",
      headline: "SUDDEN DEATH!",
      subline: "One wrong answer — you're eliminated!",
      icon: "💀",
      accentColor: "#ef4444",
    });
  }
  if (session?.controls?.bonusRound) {
    events.push({
      id: "mode-bonus-round",
      type: "MODE_BONUS",
      priority: "critical",
      headline: "BONUS ROUND!",
      subline: "Extra points up for grabs — make them count!",
      icon: "💎",
      accentColor: "#a78bfa",
    });
  }

  /* ── Streak king ── */
  const streakPlayer = [...players].sort((a, b) => (b.streak ?? 0) - (a.streak ?? 0))[0];
  const topStreak = streakPlayer?.streak ?? 0;
  if (topStreak >= 3) {
    events.push({
      id: `streak-${streakPlayer.name}-${topStreak}`,
      type: "STREAK_KING",
      priority: topStreak >= 6 ? "high" : "normal",
      headline: topStreak >= 6 ? `${topStreak} IN A ROW!` : "On fire!",
      subline: `${streakPlayer.name} has ${topStreak} correct answers in a row!`,
      icon: "🔥",
      playerName: streakPlayer.name,
      accentColor: "#ff6b35",
    });
  }

  /* ── Speed demon ── */
  const fastPlayers = players.filter(p => p.speedMs && p.speedMs > 0);
  if (fastPlayers.length) {
    const fast = fastPlayers.sort((a, b) => (a.speedMs ?? 99999) - (b.speedMs ?? 99999))[0];
    const secs = ((fast.speedMs ?? 0) / 1000).toFixed(1);
    events.push({
      id: `speed-${fast.name}`,
      type: "SPEED_DEMON",
      priority: parseFloat(secs) < 1.5 ? "high" : "normal",
      headline: `Fastest Answer: ${secs}s!`,
      subline: `${fast.name} is lightning fast!`,
      icon: "⚡",
      playerName: fast.name,
      accentColor: "#00d4ff",
    });
  }

  /* ── Rank jumper ── */
  const jumpers = players
    .filter(p => (p.rankDelta ?? 0) >= 2)
    .sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0));
  if (jumpers.length) {
    const j = jumpers[0];
    events.push({
      id: `rank-jump-${j.name}-${j.rankDelta}`,
      type: "RANK_JUMPER",
      priority: (j.rankDelta ?? 0) >= 4 ? "high" : "normal",
      headline: `+${j.rankDelta} Positions!`,
      subline: `${j.name} is charging up the leaderboard!`,
      icon: "📈",
      playerName: j.name,
      accentColor: "#10b981",
    });
  }

  /* ── Close battle (top 2) ── */
  if (players.length >= 2) {
    const gap = players[0].score - players[1].score;
    if (gap >= 0 && gap <= 20) {
      events.push({
        id: `close-battle-${gap}`,
        type: "CLOSE_BATTLE",
        priority: gap <= 5 ? "high" : "normal",
        headline: gap === 0 ? "TIED AT THE TOP!" : `Only ${gap} point${gap !== 1 ? "s" : ""} apart!`,
        subline: `${players[0].name} vs ${players[1].name} — who will pull ahead?`,
        icon: "⚔️",
        accentColor: "#ec4899",
      });
    }
  }

  /* ── Accuracy ace ── */
  const withAnswers = players.filter(p => (p.totalAnswers ?? 0) >= 3);
  if (withAnswers.length) {
    const ace = withAnswers.sort((a, b) => {
      const aR = (a.correctAnswers ?? 0) / (a.totalAnswers ?? 1);
      const bR = (b.correctAnswers ?? 0) / (b.totalAnswers ?? 1);
      return bR - aR;
    })[0];
    const pct = Math.round(((ace.correctAnswers ?? 0) / (ace.totalAnswers ?? 1)) * 100);
    if (pct >= 80) {
      events.push({
        id: `accuracy-${ace.name}`,
        type: "ACCURACY_ACE",
        priority: pct === 100 ? "high" : "normal",
        headline: `${pct}% Accuracy!`,
        subline: `${ace.name} is the most accurate player!`,
        icon: "🎯",
        playerName: ace.name,
        accentColor: "#a78bfa",
      });
    }
  }

  /* ── Comeback player ── */
  const comebackList = players.filter(
    (p, i) => (p.rankDelta ?? 0) >= 3 && i <= 5
  ).sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0));
  if (comebackList.length) {
    const cb = comebackList[0];
    events.push({
      id: `comeback-${cb.name}`,
      type: "COMEBACK",
      priority: "high",
      headline: "COMEBACK ALERT!",
      subline: `${cb.name} surged ${cb.rankDelta} spots into the top!`,
      icon: "🚀",
      playerName: cb.name,
      accentColor: "#f59e0b",
    });
  }

  /* ── Top 3 celebration (if we have 3+ players) ── */
  if (players.length >= 3 && !events.find(e => e.type === "CLOSE_BATTLE")) {
    const p1 = players[0];
    events.push({
      id: `leader-spotlight-${p1.name}`,
      type: "LEADER_SPOTLIGHT",
      priority: "normal",
      headline: `${p1.name} leads!`,
      subline: `Top score: ${p1.score} pts — can anyone catch up?`,
      icon: "👑",
      playerName: p1.name,
      accentColor: "#ffd700",
    });
  }

  /* ── Sort: critical → high → normal ── */
  const PRIO: Record<Priority, number> = { critical: 0, high: 1, normal: 2 };
  return events.sort((a, b) => PRIO[a.priority] - PRIO[b.priority]);
}

/* ══════════════════════════════════════════════════ Waveform bars ══ */

function EnergyWave({ color }: { color: string }) {
  return (
    <div className="cq-hbar-wave">
      {[0.8, 1.2, 0.6, 1.5, 1.0, 0.7, 1.3, 0.9, 1.4, 0.5, 1.1, 0.8].map((dur, i) => (
        <div
          key={i}
          className="cq-hbar-wave-bar"
          style={{
            background: color,
            animationDuration: `${dur}s`,
            animationDelay: `${i * 0.07}s`,
            height: `${10 + Math.sin(i * 0.9) * 10}px`,
          }}
        />
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════ Progress dots ══ */

function ProgressDots({ total, current }: { total: number; current: number }) {
  if (total <= 1) return null;
  const count = Math.min(total, 8);
  const active = current % count;
  return (
    <div className="cq-hbar-dots">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          className="cq-hbar-dot"
          animate={{
            width:   i === active ? "22px" : "6px",
            opacity: i === active ? 0.9 : 0.25,
          }}
          transition={{ duration: 0.35 }}
        />
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════ Floating particles */

function FloatingParticles({ color }: { color: string }) {
  const particles = useMemo(() =>
    Array.from({ length: 8 }).map((_, i) => ({
      id: i,
      style: {
        left: `${10 + i * 11}%`,
        animationDelay: `${i * 0.4}s`,
        animationDuration: `${2 + (i % 3) * 0.8}s`,
        background: color,
        width: `${4 + (i % 3) * 2}px`,
        height: `${4 + (i % 3) * 2}px`,
      },
    })), [color]);

  return (
    <div className="cq-hbar-particles" aria-hidden>
      {particles.map(p => (
        <div key={p.id} className="cq-hbar-particle" style={p.style} />
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════ Critical overlay ═ */

function CriticalOverlay({ event }: { event: LiveEvent }) {
  const color = event.accentColor ?? "#00d4ff";

  return (
    <motion.div
      key={event.id}
      initial={{ y: 100, opacity: 0, scaleX: 0.92 }}
      animate={{ y: 0, opacity: 1, scaleX: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      className="cq-hbar-critical"
      style={{
        background: `linear-gradient(135deg, rgba(4,4,14,0.94) 0%, ${color}22 50%, rgba(4,4,14,0.94) 100%)`,
        borderTop: `2px solid ${color}`,
        boxShadow: `0 -12px 60px ${color}44, 0 0 120px ${color}18`,
      }}
    >
      {/* Animated background pulse */}
      <motion.div
        animate={{ scale: [1, 1.4, 1], opacity: [0.15, 0.3, 0.15] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="cq-hbar-critical-glow"
        style={{ background: color }}
      />

      <FloatingParticles color={color} />

      {/* Left side: icon + avatar */}
      <div className="cq-hbar-left">
        <motion.div
          animate={{ scale: [1, 1.18, 1], rotate: [0, -5, 5, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          className="cq-hbar-icon-wrap cq-hbar-icon-xl"
        >
          {event.icon}
        </motion.div>

        {event.playerName && (
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 260 }}
            className="cq-hbar-avatar cq-hbar-avatar-lg"
            style={{
              background: avGrad(event.playerName),
              border: `3px solid ${color}`,
              boxShadow: `0 0 25px ${color}88, 0 0 50px ${color}33`,
            }}
          >
            {event.playerName.charAt(0).toUpperCase()}
          </motion.div>
        )}
      </div>

      {/* Center: text */}
      <div className="cq-hbar-center">
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, type: "spring" }}
          className="cq-hbar-headline cq-hbar-headline-xl"
          style={{
            fontFamily: "'Orbitron', sans-serif",
            color: color,
            textShadow: `0 0 30px ${color}cc, 0 0 60px ${color}55`,
          }}
        >
          {event.headline}
        </motion.div>

        {event.subline && (
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.22 }}
            className="cq-hbar-subline cq-hbar-subline-xl"
          >
            {event.subline}
          </motion.div>
        )}
      </div>

      {/* Right: waveform */}
      <div className="cq-hbar-right">
        <EnergyWave color={color} />
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════ Normal bar ═════ */

function NormalBar({
  event,
  total,
  current,
}: {
  event: LiveEvent;
  total: number;
  current: number;
}) {
  const color = event.accentColor ?? "#00d4ff";
  const isHigh = event.priority === "high";

  return (
    <motion.div
      key={event.id}
      initial={{ y: 72, opacity: 0, scale: 0.97 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -20, opacity: 0, scale: 0.99 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className={`cq-hbar-normal ${isHigh ? "cq-hbar-high" : ""}`}
      style={{
        background: isHigh
          ? `linear-gradient(135deg, rgba(7,7,17,0.90) 0%, ${color}1a 50%, rgba(7,7,17,0.90) 100%)`
          : "rgba(7,7,17,0.88)",
        borderTop: `1px solid ${color}${isHigh ? "55" : "2a"}`,
        boxShadow: isHigh
          ? `0 -8px 40px ${color}33`
          : "0 -4px 24px rgba(0,212,255,0.08)",
      }}
    >
      {/* Left accent glow line */}
      <div
        className="cq-hbar-accent-line"
        style={{ background: `linear-gradient(to bottom, transparent, ${color}, transparent)`, boxShadow: `0 0 12px ${color}` }}
      />

      {/* Icon */}
      <motion.div
        animate={
          isHigh
            ? { scale: [1, 1.14, 1], rotate: [0, -4, 4, 0] }
            : { scale: [1, 1.06, 1] }
        }
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        className={`cq-hbar-icon-wrap ${isHigh ? "cq-hbar-icon-lg" : "cq-hbar-icon-md"}`}
      >
        {event.icon}
      </motion.div>

      {/* Player avatar */}
      {event.playerName && (
        <motion.div
          initial={{ scale: 0, rotate: -160 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.12, type: "spring", stiffness: 280 }}
          className={`cq-hbar-avatar ${isHigh ? "cq-hbar-avatar-md" : "cq-hbar-avatar-sm"}`}
          style={{
            background: avGrad(event.playerName),
            border: `2px solid ${color}66`,
            boxShadow: `0 0 14px ${color}44`,
          }}
        >
          {event.playerName.charAt(0).toUpperCase()}
        </motion.div>
      )}

      {/* Text */}
      <div className="cq-hbar-text">
        <motion.div
          initial={{ x: 22, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.08, type: "spring" }}
          className={`cq-hbar-headline ${isHigh ? "cq-hbar-headline-lg" : "cq-hbar-headline-md"}`}
          style={
            isHigh
              ? { fontFamily: "'Orbitron', sans-serif", color, textShadow: `0 0 18px ${color}88`, letterSpacing: "0.05em", textTransform: "uppercase" }
              : { color: "#fff" }
          }
        >
          {event.headline}
        </motion.div>

        {event.subline && (
          <motion.div
            initial={{ x: 22, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.18, type: "spring" }}
            className="cq-hbar-subline"
          >
            {event.subline}
          </motion.div>
        )}
      </div>

      {/* Right: waveform + dots */}
      <div className="cq-hbar-right">
        <EnergyWave color={color} />
        <ProgressDots total={total} current={current} />
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════ Main export ══ */

/**
 * BottomHighlightBar
 *
 * A fixed bottom overlay that rotates through live competition highlights.
 * Events are auto-generated from `players` + `session.controls`.
 * Also listens to optional Firestore collection `liveEvents/{sessionId}/events`
 * for admin-pushed announcements.
 *
 * Firestore schema for admin-pushed events:
 *   liveEvents/{sessionId}/events/{eventId}
 *   {
 *     id: string,
 *     type: string,            // e.g. "NEW_LEADER"
 *     priority: "critical"|"high"|"normal",
 *     headline: string,        // large bold text
 *     subline?: string,        // supporting detail
 *     icon: string,            // emoji
 *     playerName?: string,     // for avatar
 *     accentColor?: string,    // hex color
 *     createdAt: serverTimestamp()
 *   }
 */
export function BottomHighlightBar({
  players,
  session,
  sessionId,
}: {
  players: Player[];
  session: Session | null;
  sessionId: string;
}) {
  const [currentIdx,      setCurrentIdx]      = useState(0);
  const [firestoreEvents, setFirestoreEvents] = useState<LiveEvent[]>([]);
  const [leaderEvent,     setLeaderEvent]     = useState<LiveEvent | null>(null);
  const prevLeaderRef = useRef<string>("");

  /* ── Detect new leader (side-effect safe) ── */
  useEffect(() => {
    const currentLeader = players[0]?.name ?? "";
    if (prevLeaderRef.current && currentLeader && prevLeaderRef.current !== currentLeader) {
      const ev: LiveEvent = {
        id: `new-leader-${currentLeader}-${Date.now()}`,
        type: "NEW_LEADER",
        priority: "critical",
        headline: "NEW LEADER!",
        subline: `${currentLeader} takes the top spot with ${players[0].score} pts!`,
        icon: "👑",
        playerName: currentLeader,
        accentColor: "#ffd700",
        createdAt: Date.now(),
      };
      setLeaderEvent(ev);
      const t = setTimeout(() => setLeaderEvent(null), 7000);
      return () => clearTimeout(t);
    }
    prevLeaderRef.current = currentLeader;
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players[0]?.name]);

  /* ── Optional Firestore liveEvents listener ── */
  useEffect(() => {
    if (!hasFirebaseConfig || !sessionId) return;
    try {
      const db = getDb();
      const col = collection(db, "liveEvents", sessionId, "events");
      const q = query(col, orderBy("createdAt", "desc"));
      const unsub = onSnapshot(q, snap => {
        const now = Date.now();
        const fresh = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as LiveEvent))
          .filter(e => !e.createdAt || now - e.createdAt < 30_000);
        setFirestoreEvents(fresh);
      }, () => { /* silently ignore if collection doesn't exist */ });
      return unsub;
    } catch { return undefined; }
  }, [sessionId]);

  /* ── Generate events from player data ── */
  const generated = useMemo(
    () => generateEvents(players, session),
    [players, session]
  );

  /* ── Merge all event sources (Firestore > leaderEvent > generated) ── */
  const allEvents = useMemo<LiveEvent[]>(() => {
    const seen = new Set<string>();
    const merged: LiveEvent[] = [];
    const push = (e: LiveEvent) => {
      if (!seen.has(e.type)) { seen.add(e.type); merged.push(e); }
    };
    if (leaderEvent)        push(leaderEvent);
    firestoreEvents.forEach(push);
    generated.forEach(push);
    return merged;
  }, [leaderEvent, firestoreEvents, generated]);

  /* ── Rotation every 4.5 s ── */
  useEffect(() => {
    if (allEvents.length <= 1) return;
    const id = setInterval(() => {
      setCurrentIdx(i => (i + 1) % allEvents.length);
    }, 4500);
    return () => clearInterval(id);
  }, [allEvents.length]);

  /* ── Reset index when player count changes ── */
  useEffect(() => { setCurrentIdx(0); }, [players.length]);

  /* ── Guard ── */
  if (!allEvents.length) return null;
  const event = allEvents[currentIdx % allEvents.length];
  if (!event) return null;

  return (
    <div className="cq-hbar-shell">
      <AnimatePresence mode="wait">
        {event.priority === "critical" ? (
          <CriticalOverlay key={`crit-${event.id}`} event={event} />
        ) : (
          <NormalBar
            key={`norm-${event.id}`}
            event={event}
            total={allEvents.length}
            current={currentIdx}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
