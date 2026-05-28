/**
 * lib/gtag.ts
 * ──────────────────────────────────────────────────────────────
 * Google Analytics 4 helpers for Nimma Quiz.
 *
 * Usage in components:
 *   import { gtagEvent } from "@/lib/gtag";
 *   gtagEvent("quiz_started", { session_id: "nimma-0523" });
 */

export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_ID ?? "";

/** True only when a GA ID is configured and we're in the browser */
export const isGaEnabled =
  typeof window !== "undefined" && Boolean(GA_MEASUREMENT_ID);

/* ── Type declarations ─────────────────────────────────────────── */

interface GTagEvent {
  action:   string;
  category?: string;
  label?:   string;
  value?:   number;
  [key: string]: unknown;
}

declare global {
  interface Window {
    gtag?: (
      command: "config" | "event" | "js" | "set",
      targetId: string | Date,
      params?: Record<string, unknown>
    ) => void;
    dataLayer?: unknown[];
  }
}

/* ── Helpers ───────────────────────────────────────────────────── */

/**
 * Track a virtual page view — call this in a useEffect after
 * the user navigates to a new screen within the SPA.
 */
export function gtagPageview(url: string): void {
  if (!isGaEnabled || !window.gtag) return;
  window.gtag("config", GA_MEASUREMENT_ID, { page_path: url });
}

/**
 * Track a GA4 custom event.
 * Example: gtagEvent("quiz_started", { session_id: "abc" })
 */
export function gtagEvent({ action, category, label, value, ...rest }: GTagEvent): void {
  if (!isGaEnabled || !window.gtag) return;
  window.gtag("event", action, {
    event_category: category,
    event_label:    label,
    value,
    ...rest,
  });
}

/* ── Nimma Quiz domain events ──────────────────────────────────── */

export const QuizEvents = {
  joinSession:     (sessionId: string) =>
    gtagEvent({ action: "join_session",      category: "engagement", session_id: sessionId }),

  answerSubmitted: (sessionId: string, questionIdx: number, correct: boolean) =>
    gtagEvent({ action: "answer_submitted",  category: "engagement", session_id: sessionId, question_index: questionIdx, correct }),

  viewLeaderboard: (sessionId: string) =>
    gtagEvent({ action: "view_leaderboard",  category: "engagement", session_id: sessionId }),

  adminLogin:      () =>
    gtagEvent({ action: "admin_login",       category: "admin" }),

  sessionCreated:  (sessionId: string) =>
    gtagEvent({ action: "session_created",   category: "admin",      session_id: sessionId }),
};
