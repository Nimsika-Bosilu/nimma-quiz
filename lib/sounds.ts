/**
 * lib/sounds.ts — Kahoot-style synthesised sound effects using Web Audio API.
 * No external audio files are needed. All sounds are generated in-browser.
 */

let _ctx: AudioContext | null = null;
let _lobbyTimeout: ReturnType<typeof setTimeout> | null = null;
let _stopLobby = false;
let _muted = false;

/* ─── Core helpers ──────────────────────────────────────────────────────── */

function getCtx(): AudioContext {
  if (typeof window === "undefined") throw new Error("no window");
  if (!_ctx || _ctx.state === "closed") {
    _ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _ctx;
}

/** Call once after a user gesture to unlock the AudioContext. */
export function unlockAudio(): void {
  try {
    const c = getCtx();
    if (c.state === "suspended") c.resume();
  } catch { /* swallow */ }
}

export function setMuted(muted: boolean) { _muted = muted; }
export function isMuted() { return _muted; }

/**
 * Play a single oscillator note.
 * @param freq        frequency in Hz
 * @param delayS      seconds from now to start
 * @param durS        duration in seconds
 * @param type        oscillator waveform
 * @param vol         peak gain (0–1)
 */
function tone(
  freq: number,
  delayS: number,
  durS: number,
  type: OscillatorType = "sine",
  vol = 0.18
): void {
  if (_muted) return;
  try {
    const c = getCtx();
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now + delayS);
    gain.gain.setValueAtTime(0.001, now + delayS);
    gain.gain.linearRampToValueAtTime(vol, now + delayS + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delayS + durS);
    osc.start(now + delayS);
    osc.stop(now + delayS + durS + 0.05);
  } catch { /* swallow */ }
}

/* ─── One-shot sound effects ────────────────────────────────────────────── */

/** Bright ascending arpeggio – plays when a new question appears. */
export function sfxQuestionStart(): void {
  [523.25, 659.25, 783.99, 1046.50].forEach((f, i) =>
    tone(f, i * 0.09, 0.28, "triangle", 0.14)
  );
}

/**
 * Countdown tick – call once per second.
 * Last 5 seconds: urgent double-tick at higher pitch.
 */
export function sfxTick(secondsLeft: number): void {
  if (secondsLeft <= 5) {
    tone(1046.50, 0,    0.045, "square", 0.20);
    tone(880,     0.06, 0.035, "square", 0.15);
  } else {
    tone(440, 0, 0.040, "square", 0.10);
  }
}

/** Dramatic descending alarm – plays when time runs out. */
export function sfxTimeUp(): void {
  try {
    const c = getCtx();
    const now = c.currentTime;
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, now + offset);
      osc.frequency.exponentialRampToValueAtTime(220, now + offset + 0.18);
      gain.gain.setValueAtTime(_muted ? 0 : 0.16, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.20);
      osc.start(now + offset);
      osc.stop(now + offset + 0.25);
    });
  } catch { /* swallow */ }
}

/** Triumphant rising chord – plays when the correct answer is revealed. */
export function sfxAnswerReveal(): void {
  [523.25, 659.25, 783.99, 1046.50].forEach((f, i) =>
    tone(f, i * 0.055, 0.70, "triangle", 0.13)
  );
  tone(261.63, 0, 0.80, "sine", 0.09); // bass
}

/** Upbeat fanfare – plays when the leaderboard appears. */
export function sfxLeaderboard(): void {
  const melody: [number, number, number][] = [
    [523.25, 0.00, 0.12],
    [659.25, 0.12, 0.12],
    [783.99, 0.24, 0.12],
    [1046.50, 0.36, 0.28],
    [880.00,  0.64, 0.12],
    [1046.50, 0.76, 0.45],
  ];
  melody.forEach(([f, d, dur]) => tone(f, d, dur, "triangle", 0.16));
  tone(130.81, 0, 1.2, "sine", 0.08); // bass root
}

/** Short "swoosh" – plays when a player climbs the leaderboard. */
export function sfxRankUp(): void {
  tone(523.25, 0,    0.08, "sine", 0.10);
  tone(783.99, 0.08, 0.12, "sine", 0.08);
}

/* ─── Lobby music (looping) ─────────────────────────────────────────────── */

const BPM   = 126;
const BEAT  = 60 / BPM;
const BEATS = 8; // loop length in beats

// Kahoot-style upbeat C-major melody
type NoteSpec = [number, number, number, OscillatorType, number];
const MELODY: NoteSpec[] = [
  [523.25, 0.0, 0.45, "triangle", 0.10],
  [783.99, 0.5, 0.45, "triangle", 0.10],
  [659.25, 1.0, 0.45, "triangle", 0.10],
  [1046.50,1.5, 0.45, "triangle", 0.10],
  [783.99, 2.0, 0.45, "triangle", 0.10],
  [659.25, 2.5, 0.45, "triangle", 0.10],
  [523.25, 3.0, 0.85, "triangle", 0.10],
  [523.25, 4.0, 0.45, "triangle", 0.10],
  [587.33, 4.5, 0.45, "triangle", 0.10],
  [659.25, 5.0, 0.45, "triangle", 0.10],
  [783.99, 5.5, 0.45, "triangle", 0.10],
  [1046.50,6.0, 0.45, "triangle", 0.10],
  [783.99, 6.5, 0.45, "triangle", 0.10],
  [659.25, 7.0, 0.85, "triangle", 0.10],
];

const BASS: [number, number][] = [
  [130.81, 0], // C2
  [164.81, 2], // E2
  [196.00, 4], // G2
  [164.81, 6], // E2
];

function scheduleLobbyChunk(absStart: number): void {
  if (_stopLobby) return;
  const c = getCtx();

  MELODY.forEach(([freq, beat, durBeats, type, vol]) => {
    const offset = absStart - c.currentTime + beat * BEAT;
    if (offset >= 0) tone(freq, offset, durBeats * BEAT, type, vol);
  });

  BASS.forEach(([freq, beat]) => {
    const offset = absStart - c.currentTime + beat * BEAT;
    if (offset >= 0) tone(freq, offset, BEAT * 1.6, "sine", 0.07);
  });

  const loopMs = BEATS * BEAT * 1000;
  const nextAbs = absStart + BEATS * BEAT;
  // Reschedule 600 ms before the loop ends to guarantee gap-free playback
  _lobbyTimeout = setTimeout(() => scheduleLobbyChunk(nextAbs), loopMs - 600);
}

export function startLobbyMusic(): void {
  try {
    _stopLobby = false;
    const c = getCtx();
    scheduleLobbyChunk(c.currentTime + 0.15);
  } catch { /* swallow */ }
}

export function stopLobbyMusic(): void {
  _stopLobby = true;
  if (_lobbyTimeout !== null) {
    clearTimeout(_lobbyTimeout);
    _lobbyTimeout = null;
  }
}
