/**
 * Settings bottom sheet: sound, place sound (with preview), haptics, background music and its
 * track, background color, storage
 * usage (with Keep safe when not persistent), and Install app when
 * the app is not already installed. Changes are stored immediately.
 */

import { MUSIC_LABELS, syncMusic } from '../audio/music';
import { playPlaceSound } from '../audio/sfx';
import {
  canRequestPersistence,
  isPersisted,
  requestPersistence,
  storageEstimate,
} from '../storage/quota';
import {
  BACKGROUNDS,
  getSettings,
  MUSIC_TRACKS,
  PLACE_SOUNDS,
  type PlaceSound,
  type Settings,
  setSettings,
} from '../storage/settings';
import { applyBackground, BACKGROUND_COLORS } from './background';
import { h, openSheet } from './dom';
import { canOfferInstall, installApp } from './install';
import { formatBytes } from './pure';

/** Sound, haptics, music and appearance settings in a bottom sheet. */
export function openSettingsSheet(onClose?: () => void): void {
  const row = (key: 'sound' | 'haptics' | 'music', label: string, note: string): HTMLElement => {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
    input.checked = getSettings()[key];
    input.addEventListener('change', () => {
      const patch: Partial<Settings> = { [key]: input.checked };
      setSettings(patch);
      if (key === 'music') syncMusic();
    });
    return h(
      'label',
      { class: 'setting-row' },
      h('span', {}, h('strong', {}, label), h('small', {}, note)),
      input,
    );
  };
  const soundLabel: Record<PlaceSound, string> = {
    click: 'Click',
    snap: 'Snap',
    pop: 'Pop',
    tick: 'Tick',
    blip: 'Blip',
  };
  const placeSoundRow = h(
    'div',
    { class: 'setting-row column' },
    h('span', {}, h('strong', {}, 'Place sound'), h('small', {}, 'Tap to preview')),
    h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': 'Place sound' },
      ...PLACE_SOUNDS.map((kind) => {
        const b = h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: getSettings().placeSound === kind ? 'on' : '',
            'aria-checked': String(getSettings().placeSound === kind),
          },
          soundLabel[kind],
        );
        b.addEventListener('click', () => {
          setSettings({ placeSound: kind });
          for (const el of b.parentElement?.children ?? []) {
            el.setAttribute('aria-checked', String(el === b));
            el.classList.toggle('on', el === b);
          }
          playPlaceSound(kind);
        });
        return b;
      }),
    ),
  );
  const musicTrackRow = h(
    'div',
    { class: 'setting-row column' },
    h('span', {}, h('strong', {}, 'Music track'), h('small', {}, 'Background music style')),
    h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': 'Music track' },
      ...MUSIC_TRACKS.map((track) => {
        const on = getSettings().musicTrack === track;
        const b = h(
          'button',
          { type: 'button', role: 'radio', class: on ? 'on' : '', 'aria-checked': String(on) },
          MUSIC_LABELS[track],
        );
        b.addEventListener('click', () => {
          setSettings({ musicTrack: track });
          syncMusic();
          for (const el of b.parentElement?.children ?? []) {
            el.setAttribute('aria-checked', String(el === b));
            el.classList.toggle('on', el === b);
          }
        });
        return b;
      }),
    ),
  );
  const backgroundRow = h(
    'div',
    { class: 'setting-row column' },
    h('span', {}, h('strong', {}, 'Background'), h('small', {}, 'Color behind the board')),
    h(
      'div',
      { class: 'swatches', role: 'radiogroup', 'aria-label': 'Background' },
      ...BACKGROUNDS.map((bg) => {
        const on = getSettings().background === bg;
        const b = h('button', {
          type: 'button',
          role: 'radio',
          class: on ? 'swatch on' : 'swatch',
          'aria-checked': String(on),
          'aria-label': BACKGROUND_COLORS[bg].label,
          title: BACKGROUND_COLORS[bg].label,
        });
        b.style.background = BACKGROUND_COLORS[bg].a;
        b.addEventListener('click', () => {
          setSettings({ background: bg });
          applyBackground(bg);
          for (const el of b.parentElement?.children ?? []) {
            el.setAttribute('aria-checked', String(el === b));
            el.classList.toggle('on', el === b);
          }
        });
        return b;
      }),
    ),
  );
  const installRow = canOfferInstall()
    ? h(
        'div',
        { class: 'setting-row' },
        h('span', {}, h('strong', {}, 'Install app'), h('small', {}, 'Full screen and offline')),
        h(
          'button',
          { type: 'button', class: 'btn primary', on: { click: () => void installApp() } },
          'Install',
        ),
      )
    : null;
  const storageNote = h('small', {}, 'Checking…');
  const keepSafeBtn = h('button', { type: 'button', class: 'btn' }, 'Keep safe');
  keepSafeBtn.hidden = true;
  const refreshStorage = async (): Promise<void> => {
    const [estimate, persisted] = await Promise.all([storageEstimate(), isPersisted()]);
    if (!estimate) {
      storageNote.textContent = 'Unavailable';
      keepSafeBtn.hidden = true;
      return;
    }
    const used = `${formatBytes(estimate.usage)} used`;
    storageNote.textContent = persisted
      ? `${used} · kept safe`
      : `${used} · may be cleared by the browser`;
    keepSafeBtn.hidden = persisted || !canRequestPersistence();
  };
  keepSafeBtn.addEventListener('click', () => {
    void requestPersistence().then(refreshStorage);
  });
  const storageRow = h(
    'div',
    { class: 'setting-row' },
    h('span', {}, h('strong', {}, 'Storage'), storageNote),
    keepSafeBtn,
  );
  void refreshStorage();
  openSheet(
    'Settings',
    h(
      'div',
      { class: 'settings' },
      row('sound', 'Sound', 'Clicks and chimes'),
      placeSoundRow,
      row('haptics', 'Haptics', 'Vibration where supported'),
      row('music', 'Music', 'Background music while you play'),
      musicTrackRow,
      backgroundRow,
      storageRow,
      ...(installRow ? [installRow] : []),
    ),
    onClose,
  );
}
