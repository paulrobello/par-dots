/**
 * Settings bottom sheet: sound, place sound (with preview), haptics, and Install app when
 * the app is not already installed. Changes are stored immediately.
 */

import { playPlaceSound } from '../audio/sfx';
import {
  getSettings,
  PLACE_SOUNDS,
  type PlaceSound,
  type Settings,
  setSettings,
} from '../storage/settings';
import { h, openSheet } from './dom';
import { canOfferInstall, installApp } from './install';

/** Sound / haptics toggles in a bottom sheet. */
export function openSettingsSheet(): void {
  const row = (key: 'sound' | 'haptics', label: string, note: string): HTMLElement => {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
    input.checked = getSettings()[key];
    input.addEventListener('change', () => {
      const patch: Partial<Settings> = { [key]: input.checked };
      setSettings(patch);
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
  openSheet(
    'Settings',
    h(
      'div',
      { class: 'settings' },
      row('sound', 'Sound', 'Clicks and chimes'),
      placeSoundRow,
      row('haptics', 'Haptics', 'Vibration where supported'),
      ...(installRow ? [installRow] : []),
    ),
  );
}
