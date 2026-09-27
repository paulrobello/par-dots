// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAudio {
  static made: FakeAudio[] = [];
  src = '';
  loop = false;
  preload = '';
  volume = 1;
  paused = true;
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  constructor() {
    FakeAudio.made.push(this);
  }
}

describe('music', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeAudio.made = [];
    vi.stubGlobal('Audio', FakeAudio);
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function load() {
    const settings = await import('../src/storage/settings');
    settings.resetSettingsCache();
    const music = await import('../src/audio/music');
    const target = new EventTarget();
    music.initMusic(target);
    return { settings, music, target };
  }

  it('stays silent until the first gesture, then loops the default happy track', async () => {
    const { target } = await load();
    expect(FakeAudio.made).toHaveLength(0);
    target.dispatchEvent(new Event('pointerdown'));
    const a = FakeAudio.made[0];
    expect(a.loop).toBe(true);
    expect(a.src).toMatch(/music\/happy\.mp3$/);
    expect(a.play).toHaveBeenCalledTimes(1);
  });

  it('switches track and pauses when turned off', async () => {
    const { settings, music, target } = await load();
    target.dispatchEvent(new Event('keydown'));
    const a = FakeAudio.made[0];
    settings.setSettings({ musicTrack: 'energy' });
    music.syncMusic();
    expect(a.src).toMatch(/music\/energy\.mp3$/);
    settings.setSettings({ music: false });
    music.syncMusic();
    expect(a.pause).toHaveBeenCalled();
    expect(a.paused).toBe(true);
  });

  it('scales element volume with the music volume and pauses at 0', async () => {
    const { settings, music, target } = await load();
    settings.setSettings({ musicVolume: 50 });
    target.dispatchEvent(new Event('pointerdown'));
    const a = FakeAudio.made[0];
    expect(a.volume).toBeCloseTo(0.3);
    settings.setSettings({ musicVolume: 0 });
    music.syncMusic();
    expect(a.volume).toBe(0);
    expect(a.paused).toBe(true);
    settings.setSettings({ musicVolume: 100 });
    music.syncMusic();
    expect(a.volume).toBeCloseTo(0.6);
    expect(a.paused).toBe(false);
  });

  it('does not play when music is off at the first gesture', async () => {
    const { settings, target } = await load();
    settings.setSettings({ music: false });
    target.dispatchEvent(new Event('pointerdown'));
    expect(FakeAudio.made).toHaveLength(0);
  });
});
