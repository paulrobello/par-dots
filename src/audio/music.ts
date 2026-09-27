/**
 * Looping background music from bundled MP3s in `public/music/`. One HTMLAudioElement plays the
 * track chosen in settings. Browsers block audio until a user gesture, so playback starts on the
 * first tap or key press; it pauses while the page is hidden. Failures are silent, like sfx.
 */

import { getSettings, type MusicTrack } from '../storage/settings';

/** Settings-sheet label per track. */
export const MUSIC_LABELS: Record<MusicTrack, string> = {
  happy: 'Happy',
  calm: 'Calm',
  energy: 'Energy',
};

const VOLUME = 0.35;

let audio: HTMLAudioElement | null = null;
let current: MusicTrack | null = null;
let unlocked = false;
let initialized = false;

function trackUrl(track: MusicTrack): string {
  return `${import.meta.env.BASE_URL}music/${track}.mp3`;
}

/** Start, stop, or switch the music to match the current settings and page visibility. */
export function syncMusic(): void {
  if (typeof Audio === 'undefined') return;
  const { music, musicTrack } = getSettings();
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!music || !unlocked || hidden) {
    audio?.pause();
    return;
  }
  if (!audio) {
    audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = VOLUME;
  }
  if (current !== musicTrack) {
    current = musicTrack;
    audio.src = trackUrl(musicTrack);
  }
  if (audio.paused) void audio.play().catch(() => undefined);
}

/** Start music on the first user gesture and follow page visibility. Safe to call repeatedly. */
export function initMusic(target: EventTarget = globalThis): void {
  if (initialized) return;
  initialized = true;
  const events = ['pointerdown', 'keydown'];
  const onGesture = (): void => {
    unlocked = true;
    for (const e of events) target.removeEventListener(e, onGesture);
    syncMusic();
  };
  for (const e of events) target.addEventListener(e, onGesture, { passive: true });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', syncMusic);
}
