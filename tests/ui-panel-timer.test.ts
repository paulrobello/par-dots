import { describe, expect, it } from 'vitest';
import { createPanelTimer } from '../src/ui/panelTimer';

function clock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number): void => {
      t += ms;
    },
  };
}

describe('createPanelTimer', () => {
  it('accrues visible time on top of the recorded total', () => {
    const c = clock();
    const timer = createPanelTimer({ now: c.now, initialMs: 500, visible: true, locked: false });
    c.tick(200);
    expect(timer.elapsed(false)).toBe(700);
    expect(timer.flush()).toBe(700);
    c.tick(50);
    expect(timer.flush()).toBe(750);
  });

  it('does not accrue while paused, and resumes when unpaused', () => {
    const c = clock();
    const timer = createPanelTimer({ now: c.now, initialMs: 0, visible: true, locked: false });
    c.tick(100);
    timer.setPaused(true);
    c.tick(10_000);
    expect(timer.elapsed(false)).toBe(100);
    timer.setPaused(false);
    c.tick(50);
    expect(timer.flush()).toBe(150);
  });

  it('stays stopped when unhidden while paused, and when unpaused while hidden', () => {
    const c = clock();
    const timer = createPanelTimer({ now: c.now, initialMs: 0, visible: true, locked: false });
    timer.setPaused(true);
    timer.setVisible(false);
    timer.setVisible(true);
    c.tick(1000);
    expect(timer.elapsed(false)).toBe(0);
    timer.setVisible(false);
    timer.setPaused(false);
    c.tick(1000);
    expect(timer.elapsed(false)).toBe(0);
    timer.setVisible(true);
    c.tick(30);
    expect(timer.flush()).toBe(30);
  });

  it('pauses while hidden and resumes when visible', () => {
    const c = clock();
    const timer = createPanelTimer({ now: c.now, initialMs: 0, visible: true, locked: false });
    c.tick(100);
    timer.setVisible(false);
    c.tick(10_000);
    expect(timer.elapsed(false)).toBe(100);
    timer.setVisible(true);
    c.tick(40);
    expect(timer.elapsed(false)).toBe(140);
  });

  it('starts paused when mounted hidden', () => {
    const c = clock();
    const timer = createPanelTimer({ now: c.now, initialMs: 10, visible: false, locked: false });
    c.tick(1000);
    expect(timer.flush()).toBe(10);
  });

  it('never accrues for a panel locked at open', () => {
    const c = clock();
    const timer = createPanelTimer({ now: c.now, initialMs: 900, visible: true, locked: true });
    c.tick(1000);
    expect(timer.elapsed(false)).toBe(900);
    expect(timer.flush()).toBe(900);
    timer.setVisible(false);
    timer.setVisible(true);
    c.tick(1000);
    expect(timer.stop()).toBe(900);
  });

  it('elapsed excludes in-flight time once finished', () => {
    const c = clock();
    const timer = createPanelTimer({ now: c.now, initialMs: 0, visible: true, locked: false });
    c.tick(300);
    expect(timer.elapsed(true)).toBe(0);
    expect(timer.elapsed(false)).toBe(300);
  });

  it('stop flushes and freezes the total', () => {
    const c = clock();
    const timer = createPanelTimer({ now: c.now, initialMs: 0, visible: true, locked: false });
    c.tick(250);
    expect(timer.stop()).toBe(250);
    c.tick(1000);
    expect(timer.elapsed(false)).toBe(250);
    expect(timer.flush()).toBe(250);
  });
});
