/**
 * Synthesized sound effects (Web Audio oscillators and noise; no audio files ship) and
 * `navigator.vibrate` haptics. Both honor the current settings and fail silently, so audio
 * problems never break gameplay. The AudioContext is unlocked by the first user gesture.
 */

import { getSettings, type PlaceSound } from '../storage/settings';

export type SoundName =
  | 'place'
  | 'remove'
  | 'colorDone'
  | 'panelComplete'
  | 'pictureComplete'
  | 'error';
export type HapticName = SoundName;

/** Vibration patterns (ms) per named haptic. */
export const HAPTIC_PATTERNS: Record<HapticName, number | number[]> = {
  place: 8,
  remove: 5,
  colorDone: [15, 40, 15],
  error: [60, 40, 60],
  panelComplete: [30, 50, 30, 50, 60],
  pictureComplete: [40, 60, 40, 60, 40, 60, 120],
};

interface Note {
  freq: number;
  start: number; // seconds after trigger
  dur: number;
  type: OscillatorType;
  gain: number;
  /** Optional end frequency for a pitch glide. */
  toFreq?: number;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;

/** Synthesized note sequences; no audio assets are shipped. */
export const SOUNDS: Record<SoundName, Note[]> = {
  place: [{ freq: 1800, toFreq: 900, start: 0, dur: 0.045, type: 'triangle', gain: 0.35 }],
  remove: [{ freq: 700, toFreq: 350, start: 0, dur: 0.06, type: 'sine', gain: 0.2 }],
  error: [
    { freq: 330, toFreq: 300, start: 0, dur: 0.14, type: 'square', gain: 0.12 },
    { freq: 247, toFreq: 220, start: 0.15, dur: 0.22, type: 'square', gain: 0.12 },
  ],
  colorDone: [
    { freq: E6, start: 0, dur: 0.25, type: 'sine', gain: 0.25 },
    { freq: G6, start: 0.08, dur: 0.35, type: 'sine', gain: 0.22 },
  ],
  panelComplete: [
    { freq: C5, start: 0, dur: 0.15, type: 'triangle', gain: 0.3 },
    { freq: E5, start: 0.12, dur: 0.15, type: 'triangle', gain: 0.3 },
    { freq: G5, start: 0.24, dur: 0.15, type: 'triangle', gain: 0.3 },
    { freq: C6, start: 0.36, dur: 0.5, type: 'triangle', gain: 0.32 },
  ],
  pictureComplete: [
    { freq: C5, start: 0, dur: 0.18, type: 'triangle', gain: 0.28 },
    { freq: E5, start: 0.15, dur: 0.18, type: 'triangle', gain: 0.28 },
    { freq: G5, start: 0.3, dur: 0.18, type: 'triangle', gain: 0.28 },
    { freq: C6, start: 0.45, dur: 0.25, type: 'triangle', gain: 0.3 },
    { freq: G5, start: 0.7, dur: 0.15, type: 'triangle', gain: 0.25 },
    { freq: C6, start: 0.85, dur: 0.9, type: 'triangle', gain: 0.3 },
    { freq: E6, start: 0.85, dur: 0.9, type: 'sine', gain: 0.18 },
    { freq: G6, start: 0.85, dur: 0.9, type: 'sine', gain: 0.14 },
  ],
};

type AudioCtor = new () => AudioContext;

let ctx: AudioContext | null = null;
let listening = false;

function audioCtor(): AudioCtor | undefined {
  const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext;
}

/** Creates (or resumes) the AudioContext. Call from a user gesture; safe to call repeatedly. */
export function unlockAudio(): AudioContext | null {
  if (!ctx) {
    const Ctor = audioCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Installs one-shot gesture listeners that unlock audio on the first tap or key press. */
export function initAudio(target: EventTarget = globalThis): void {
  if (listening) return;
  listening = true;
  const events = ['pointerdown', 'touchend', 'keydown'];
  const detach = (): void => {
    for (const e of events) target.removeEventListener(e, handler);
  };
  // Detach only once audio is running: iOS may ignore a gesture it does not treat as activation.
  const handler = (): void => {
    const ac = unlockAudio();
    if (!ac || ac.state === 'running') {
      detach();
      return;
    }
    void ac
      .resume()
      .then(() => {
        if (ac.state === 'running') detach();
      })
      .catch(() => undefined);
  };
  for (const e of events) target.addEventListener(e, handler, { passive: true });
}

function schedule(ac: AudioContext, notes: Note[]): void {
  const t0 = ac.currentTime + 0.005;
  for (const n of notes) {
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    const start = t0 + n.start;
    const end = start + n.dur;
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.freq, start);
    if (n.toFreq) osc.frequency.exponentialRampToValueAtTime(n.toFreq, end);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(n.gain, start + Math.min(0.01, n.dur / 4));
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

/** A short decaying noise burst, band-passed: the body of a plastic click. */
function noiseBurst(
  ac: AudioContext,
  at: number,
  dur: number,
  freq: number,
  q: number,
  gain: number,
): void {
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    data[i] = (Math.random() * 2 - 1) * (1 - t) ** 4;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.connect(bp);
  bp.connect(amp);
  amp.connect(ac.destination);
  src.start(at);
}

/** Place-sound variants; `click` is a crisp, very short brick-snap. */
const PLACE_VOICES: Record<PlaceSound, (ac: AudioContext) => void> = {
  click: (ac) => {
    const t = ac.currentTime + 0.003;
    noiseBurst(ac, t, 0.018, 3200, 1.4, 0.9);
    schedule(ac, [{ freq: 220, toFreq: 120, start: 0, dur: 0.03, type: 'sine', gain: 0.35 }]);
  },
  snap: (ac) => {
    const t = ac.currentTime + 0.003;
    noiseBurst(ac, t, 0.012, 5200, 2.5, 0.8);
    noiseBurst(ac, t + 0.018, 0.02, 2400, 1.2, 0.5);
  },
  pop: (ac) => {
    schedule(ac, [{ freq: 900, toFreq: 260, start: 0, dur: 0.05, type: 'sine', gain: 0.4 }]);
  },
  tick: (ac) => {
    noiseBurst(ac, ac.currentTime + 0.003, 0.008, 6000, 3, 0.7);
  },
  blip: (ac) => schedule(ac, SOUNDS.place),
};

/** Plays one place-sound variant (used for the settings preview). */
export function playPlaceSound(kind: PlaceSound): void {
  if (!getSettings().sound) return;
  const ac = ctx ?? unlockAudio();
  if (!ac || ac.state === 'closed') return;
  try {
    PLACE_VOICES[kind](ac);
  } catch {
    // Audio failures must never break gameplay.
  }
}

/** Plays a synthesized sound if sound is enabled and audio has been unlocked. */
export function play(name: SoundName): void {
  if (name === 'place') {
    playPlaceSound(getSettings().placeSound);
    return;
  }
  if (!getSettings().sound) return;
  const ac = ctx ?? unlockAudio();
  if (!ac || ac.state === 'closed') return;
  try {
    schedule(ac, SOUNDS[name]);
  } catch {
    // Audio failures must never break gameplay.
  }
}

/** Vibrates with a named or explicit pattern when supported and haptics are enabled. */
export function haptic(pattern: HapticName | number | number[]): void {
  if (!getSettings().haptics) return;
  const nav = globalThis.navigator as (Navigator & { vibrate?: unknown }) | undefined;
  if (!nav || typeof nav.vibrate !== 'function') return;
  const p = typeof pattern === 'string' ? HAPTIC_PATTERNS[pattern] : pattern;
  try {
    nav.vibrate(p);
  } catch {
    // Unsupported or blocked; degrade silently.
  }
}

/** Resets module state (tests only). */
export function resetAudioForTests(): void {
  ctx = null;
  listening = false;
}
