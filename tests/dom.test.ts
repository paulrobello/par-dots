// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUNDS,
  getSettings,
  resetSettingsCache,
  SETTINGS_KEY,
  setSettings,
} from '../src/storage/settings';
import { applyBackground, BACKGROUND_COLORS } from '../src/ui/background';
import { closeAllOverlays, confirmDialog, h, isOverlayOpen, openSheet } from '../src/ui/dom';

afterEach(() => {
  closeAllOverlays();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('h', () => {
  it('sets attributes, class, boolean flags and listeners', () => {
    const onClick = vi.fn();
    const el = h(
      'button',
      {
        class: 'btn primary',
        'aria-label': 'Go',
        'data-n': 3,
        disabled: true,
        hidden: false,
        title: undefined,
        on: { click: onClick },
      },
      'Label',
      null,
      false,
    );
    expect(el.className).toBe('btn primary');
    expect(el.getAttribute('aria-label')).toBe('Go');
    expect(el.getAttribute('data-n')).toBe('3');
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.textContent).toBe('Label');
    el.dispatchEvent(new Event('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('rejects an object value on a non-listener attribute', () => {
    const bad = { style: { color: 'red' } } as unknown as Parameters<typeof h>[1];
    expect(() => h('div', bad)).toThrow(TypeError);
  });
});

describe('openSheet', () => {
  it('removes the same keydown listener it added when closed', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const sheet = openSheet('Title', h('p', {}, 'body'));
    const added = add.mock.calls.find(([type]) => type === 'keydown')?.[1];
    expect(added).toBeTypeOf('function');
    expect(isOverlayOpen()).toBe(true);
    sheet.close();
    expect(remove).toHaveBeenCalledWith('keydown', added);
    expect(isOverlayOpen()).toBe(false);
    expect(document.querySelector('.backdrop')).toBeNull();
  });

  it('runs onClose once and closes on Escape', () => {
    const onClose = vi.fn();
    const sheet = openSheet('Title', h('p', {}), onClose);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    sheet.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('confirmDialog', () => {
  it('resolves false on Cancel', async () => {
    const result = confirmDialog('Delete?', 'Really?', 'Delete');
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    cancel?.click();
    await expect(result).resolves.toBe(false);
    expect(isOverlayOpen()).toBe(false);
  });

  it('resolves true on confirm', async () => {
    const result = confirmDialog('Delete?', 'Really?', 'Delete');
    document.querySelector<HTMLButtonElement>('.btn.danger')?.click();
    await expect(result).resolves.toBe(true);
  });
});

describe('closeAllOverlays', () => {
  it('closes every open sheet', () => {
    openSheet('One', h('p', {}));
    openSheet('Two', h('p', {}));
    expect(document.querySelectorAll('.backdrop')).toHaveLength(2);
    closeAllOverlays();
    expect(isOverlayOpen()).toBe(false);
    expect(document.querySelectorAll('.backdrop')).toHaveLength(0);
  });
});

describe('settings cache across tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSettingsCache();
  });

  it('drops the cache when another tab writes the settings key', () => {
    setSettings({ sound: true });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: false }));
    expect(getSettings().sound).toBe(true);
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(getSettings().sound).toBe(false);
  });
});

describe('applyBackground', () => {
  it('sets the baseplate variables and theme-color for every preset', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    for (const bg of BACKGROUNDS) {
      applyBackground(bg);
      const c = BACKGROUND_COLORS[bg];
      const style = document.documentElement.style;
      expect(style.getPropertyValue('--bg-a')).toBe(c.a);
      expect(style.getPropertyValue('--bg-b')).toBe(c.b);
      expect(style.getPropertyValue('--bg-top')).toBe(c.top);
      expect(style.getPropertyValue('--bg-stud-hi')).toBe(c.studHi);
      expect(meta.getAttribute('content')).toBe(c.a);
    }
    meta.remove();
  });
});
