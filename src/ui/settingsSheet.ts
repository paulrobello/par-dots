import { getSettings, type Settings, setSettings } from '../storage/settings';
import { h, openSheet } from './dom';

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
  openSheet(
    'Settings',
    h(
      'div',
      { class: 'settings' },
      row('sound', 'Sound', 'Clicks and chimes'),
      row('haptics', 'Haptics', 'Vibration where supported'),
    ),
  );
}
