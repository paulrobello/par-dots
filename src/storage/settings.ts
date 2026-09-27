/**
 * Player settings in localStorage under SETTINGS_KEY, sanitized on every read and write and
 * cached in memory. When storage is unavailable, settings still hold for the session.
 */

import { MAX_COLORS, MIN_COLORS, type PaletteMode } from '../types';

/** Synthesized place-sound variants (see audio/sfx.ts). */
export type PlaceSound = 'click' | 'snap' | 'pop' | 'tick' | 'blip';
/** Place sounds in settings-sheet order; also the allowlist sanitize() accepts. */
export const PLACE_SOUNDS: readonly PlaceSound[] = ['snap', 'click', 'pop', 'tick', 'blip'];

/** App background presets (see ui/background.ts for their colors). */
export type Background = 'gray' | 'blue' | 'green' | 'brown' | 'purple';
/** Backgrounds in settings-sheet order; also the allowlist sanitize() accepts. */
export const BACKGROUNDS: readonly Background[] = ['gray', 'blue', 'green', 'brown', 'purple'];

/** Stored settings. Invalid or missing fields fall back to DEFAULT_SETTINGS. */
export interface Settings {
  /** Play sounds. Default true. */
  sound: boolean;
  /** Sound played when a dot is placed. Default 'snap'. */
  placeSound: PlaceSound;
  /** Vibrate where supported. Default true. */
  haptics: boolean;
  /** Palette mode preselected on the setup screen. Default 'lego'. */
  paletteMode: PaletteMode;
  /** Setup-screen max colors: an integer clamped to MIN_COLORS..MAX_COLORS. Default MAX_COLORS. */
  maxColors: number;
  /** App background preset. Default 'gray'. */
  background: Background;
}

/** Settings used for any field that is missing or invalid. Frozen. */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sound: true,
  placeSound: 'snap',
  haptics: true,
  paletteMode: 'lego',
  maxColors: MAX_COLORS,
  background: 'gray',
});

/** localStorage key holding the settings JSON. */
export const SETTINGS_KEY = 'par-dots:settings';

// Used when localStorage is unavailable, so settings still hold for the session.
let memory: Settings | null = null;

function sanitize(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.sound === 'boolean') s.sound = r.sound;
    if (PLACE_SOUNDS.includes(r.placeSound as PlaceSound))
      s.placeSound = r.placeSound as PlaceSound;
    if (typeof r.haptics === 'boolean') s.haptics = r.haptics;
    if (typeof r.maxColors === 'number' && Number.isInteger(r.maxColors)) {
      s.maxColors = Math.max(MIN_COLORS, Math.min(MAX_COLORS, r.maxColors));
    }
    if (r.paletteMode === 'lego' || r.paletteMode === 'free') s.paletteMode = r.paletteMode;
    if (BACKGROUNDS.includes(r.background as Background)) s.background = r.background as Background;
  }
  return s;
}

// Last known settings; sfx reads them on every placed dot, so avoid re-parsing localStorage.
let cached: Settings | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === SETTINGS_KEY || e.key === null) cached = null;
  });
}

/** Drops the in-memory settings cache (tests stub localStorage directly). */
export function resetSettingsCache(): void {
  cached = null;
}

function readSettings(): Settings {
  try {
    const store = globalThis.localStorage;
    if (store) {
      const text = store.getItem(SETTINGS_KEY);
      return text ? sanitize(JSON.parse(text)) : { ...DEFAULT_SETTINGS };
    }
  } catch (err) {
    // Corrupt JSON means defaults; an unreadable store falls back to this session's copy.
    if (err instanceof SyntaxError) return { ...DEFAULT_SETTINGS };
  }
  return memory ? { ...memory } : { ...DEFAULT_SETTINGS };
}

/** Current settings (a copy), falling back to defaults when storage is unavailable or corrupt. */
export function getSettings(): Settings {
  cached ??= readSettings();
  return { ...cached };
}

/** Merges `patch` into the stored settings and returns the result. */
export function setSettings(patch: Partial<Settings>): Settings {
  const next = sanitize({ ...getSettings(), ...patch });
  memory = next;
  cached = next;
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota); the in-memory copy still applies.
  }
  return { ...next };
}
