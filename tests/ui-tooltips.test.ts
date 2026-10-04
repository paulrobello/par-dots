// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, iconButton } from '../src/ui/dom';
import { initTooltips } from '../src/ui/tooltips';

let stop: () => void;
let btn: HTMLElement;

const fire = (el: Element, type: string): void => {
  el.dispatchEvent(new Event(type, { bubbles: true }));
};
const shown = (): Element | null => document.querySelector('.tooltip.show');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  btn = h('button', { 'data-tip': 'Hello' }, 'x');
  document.body.append(btn);
  stop = initTooltips();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('tooltips', () => {
  it('shows the chip after 120 ms and hides 60 ms after leaving', () => {
    fire(btn, 'pointerover');
    vi.advanceTimersByTime(119);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown()?.textContent).toBe('Hello');
    fire(btn, 'pointerout');
    vi.advanceTimersByTime(60);
    expect(shown()).toBeNull();
  });

  it('pointerdown cancels a pending show', () => {
    fire(btn, 'pointerover');
    fire(btn, 'pointerdown');
    vi.advanceTimersByTime(500);
    expect(shown()).toBeNull();
  });

  it('shows on keyboard focus', () => {
    fire(btn, 'focusin');
    vi.advanceTimersByTime(120);
    expect(shown()).not.toBeNull();
  });

  it('is idempotent and fully removable', () => {
    expect(initTooltips()).toBe(stop);
    expect(document.querySelectorAll('.tooltip')).toHaveLength(1);
    stop();
    expect(document.querySelector('.tooltip')).toBeNull();
    fire(btn, 'pointerover');
    vi.advanceTimersByTime(200);
    expect(document.querySelector('.tooltip')).toBeNull();
    stop = initTooltips();
  });

  it('iconButton uses data-tip, not a native title', () => {
    const b = iconButton('undo', 'Undo', () => {});
    expect(b.getAttribute('data-tip')).toBe('Undo');
    expect(b.hasAttribute('title')).toBe(false);
    expect(b.getAttribute('aria-label')).toBe('Undo');
  });
});
