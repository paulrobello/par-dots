/**
 * App background presets. Each preset overrides the baseplate CSS variables on :root and the
 * theme-color meta, so the studded body background and browser chrome recolor together.
 */

import type { Background } from '../storage/settings';

/** Baseplate colors for one preset; `a` is also the theme color. */
export interface BackgroundColors {
  label: string;
  top: string;
  a: string;
  b: string;
  studHi: string;
}

/** Colors per preset. 'gray' matches the defaults in styles.css. */
export const BACKGROUND_COLORS: Readonly<Record<Background, BackgroundColors>> = {
  gray: { label: 'Gray', top: '#3b3f44', a: '#34383c', b: '#26292d', studHi: '#55595e' },
  blue: { label: 'Blue', top: '#2c4466', a: '#253a58', b: '#18263b', studHi: '#3a5680' },
  green: { label: 'Green', top: '#2e5238', a: '#274530', b: '#1a2f20', studHi: '#3d6649' },
  brown: { label: 'Brown', top: '#5a4330', a: '#4c3828', b: '#33251a', studHi: '#6e5540' },
  purple: { label: 'Purple', top: '#4a3660', a: '#3f2e52', b: '#2a1e38', studHi: '#5c4676' },
};

/** Applies a preset to :root and the theme-color meta. */
export function applyBackground(bg: Background, doc: Document = document): void {
  const c = BACKGROUND_COLORS[bg];
  const style = doc.documentElement.style;
  style.setProperty('--bg-top', c.top);
  style.setProperty('--bg-a', c.a);
  style.setProperty('--bg-b', c.b);
  style.setProperty('--bg-stud-hi', c.studHi);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.a);
}
