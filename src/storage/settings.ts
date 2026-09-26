import type { PaletteMode } from '../types';

export type PlaceSound = 'click' | 'snap' | 'pop' | 'tick' | 'blip';
export const PLACE_SOUNDS: readonly PlaceSound[] = ['snap', 'click', 'pop', 'tick', 'blip'];

export interface Settings {
  sound: boolean;
  placeSound: PlaceSound;
  haptics: boolean;
  paletteMode: PaletteMode;
  maxColors: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sound: true,
  placeSound: 'snap',
  haptics: true,
  paletteMode: 'lego',
  maxColors: 32,
});

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
      s.maxColors = Math.max(2, Math.min(32, r.maxColors));
    }
    if (r.paletteMode === 'lego' || r.paletteMode === 'free') s.paletteMode = r.paletteMode;
  }
  return s;
}

/** Current settings, falling back to defaults when storage is unavailable or corrupt. */
export function getSettings(): Settings {
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

/** Merges `patch` into the stored settings and returns the result. */
export function setSettings(patch: Partial<Settings>): Settings {
  const next = sanitize({ ...getSettings(), ...patch });
  memory = next;
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota); the in-memory copy still applies.
  }
  return { ...next };
}
