import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HAPTIC_PATTERNS,
  haptic,
  initAudio,
  play,
  playPlaceSound,
  resetAudioForTests,
  unlockAudio,
} from '../src/audio/sfx';
import {
  closeDb,
  deleteSave,
  getImage,
  getSave,
  listSaves,
  putSave,
  putSaveWithImage,
  StorageFullError,
} from '../src/storage/db';
import { newId } from '../src/storage/id';
import {
  canRequestPersistence,
  isPersisted,
  requestPersistence,
  storageEstimate,
} from '../src/storage/quota';
import {
  DEFAULT_SETTINGS,
  getSettings,
  PLACE_SOUNDS,
  resetSettingsCache,
  SETTINGS_KEY,
  setSettings,
} from '../src/storage/settings';
import { EMPTY, MAX_COLORS, MIN_COLORS, type PictureSave } from '../src/types';
import { createSave } from '../src/ui/saves';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

function makeSave(overrides: Partial<PictureSave> = {}): PictureSave {
  const target = new Uint8Array(48 * 48).map((_, i) => i % 5);
  const placed = new Uint8Array(48 * 48).fill(EMPTY);
  placed[3] = 2;
  return {
    schemaVersion: 1,
    id: newId(),
    createdAt: 1,
    updatedAt: 1,
    name: 'Test',
    sourceImageId: 'library:lighthouse',
    aspect: '1:1',
    paletteMode: 'lego',
    palette: Array.from({ length: 5 }, (_, i) => ({ hex: '#ff0000', name: `c${i}` })),
    width: 48,
    height: 48,
    target,
    placed,
    panelElapsedMs: new Array(9).fill(0),
    ...overrides,
  };
}

describe('newId', () => {
  it('returns unique uuid-shaped ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falls back when randomUUID is missing', () => {
    const spy = vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({
      getRandomValues: <T extends ArrayBufferView>(a: T) => a,
    } as unknown as Crypto);
    try {
      expect(newId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('db', () => {
  beforeEach(async () => {
    await closeDb();
    globalThis.indexedDB = new IDBFactory();
  });

  it('round-trips saves including Uint8Arrays', async () => {
    const save = makeSave();
    await putSave(save);
    const got = await getSave(save.id);
    expect(got).toBeDefined();
    expect(got?.target).toBeInstanceOf(Uint8Array);
    expect(got?.placed).toBeInstanceOf(Uint8Array);
    expect(Array.from(got?.target ?? [])).toEqual(Array.from(save.target));
    expect(got?.placed[3]).toBe(2);
    expect(got?.placed[0]).toBe(EMPTY);
    expect(await getSave('missing')).toBeUndefined();
  });

  it('lists saves sorted by updatedAt desc', async () => {
    await putSave(makeSave({ id: 'a', updatedAt: 10 }));
    await putSave(makeSave({ id: 'b', updatedAt: 30 }));
    await putSave(makeSave({ id: 'c', updatedAt: 20 }));
    expect((await listSaves()).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('putSave overwrites by id', async () => {
    await putSave(makeSave({ id: 'x', name: 'one' }));
    await putSave(makeSave({ id: 'x', name: 'two' }));
    const all = await listSaves();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('two');
  });

  it('stores a save and its image together', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const save = makeSave({ sourceImageId: 'img-1' });
    await putSaveWithImage(save, blob);
    const got = await getImage('img-1');
    expect(got).toBeDefined();
    expect(got?.size).toBe(3);
    expect((await getSave(save.id))?.sourceImageId).toBe('img-1');
    expect(await getImage('nope')).toBeUndefined();
  });

  it('deleteSave removes an uploaded image but keeps library references', async () => {
    const imgId = 'img-9';
    const uploaded = makeSave({ sourceImageId: imgId });
    const lib = makeSave({ sourceImageId: 'library:lighthouse' });
    await putSaveWithImage(uploaded, new Blob([new Uint8Array([9])]));
    await putSave(lib);

    await deleteSave(uploaded.id);
    expect(await getSave(uploaded.id)).toBeUndefined();
    expect(await getImage(imgId)).toBeUndefined();

    await deleteSave(lib.id);
    expect(await getSave(lib.id)).toBeUndefined();
    await expect(deleteSave('missing')).resolves.toBeUndefined();
  });

  it('loads a record without schemaVersion as version 1', async () => {
    const { schemaVersion: _, ...legacy } = makeSave({ id: 'legacy' });
    await putSave(legacy as PictureSave);
    expect((await getSave('legacy'))?.schemaVersion).toBe(1);
    expect((await listSaves()).map((s) => s.schemaVersion)).toEqual([1]);
  });

  it('skips records that fail validation or come from a newer build', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await putSave(makeSave({ id: 'ok' }));
      await putSave(makeSave({ id: 'short', placed: new Uint8Array(10) }));
      await putSave(makeSave({ id: 'future', schemaVersion: 99 }));
      await putSave(makeSave({ id: 'badcolor', target: new Uint8Array(48 * 48).fill(7) }));
      expect((await listSaves()).map((s) => s.id)).toEqual(['ok']);
      expect(await getSave('short')).toBeUndefined();
      expect(await getSave('future')).toBeUndefined();
      expect(await getSave('badcolor')).toBeUndefined();
      expect(warn).toHaveBeenCalledWith('Skipping invalid save', 'short');
    } finally {
      warn.mockRestore();
    }
  });

  it('pads panelElapsedMs to the panel count', async () => {
    await putSave(makeSave({ id: 'p', panelElapsedMs: [5] }));
    expect((await getSave('p'))?.panelElapsedMs).toEqual([5, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('surfaces QuotaExceededError as StorageFullError', async () => {
    const quota = new DOMException('full', 'QuotaExceededError');
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quota;
    });
    try {
      const err = await putSave(makeSave()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageFullError);
      expect((err as Error).name).toBe('StorageFullError');
      await expect(
        putSaveWithImage(makeSave({ sourceImageId: 'q' }), new Blob([])),
      ).rejects.toBeInstanceOf(StorageFullError);
    } finally {
      spy.mockRestore();
    }
  });

  it('putSaveWithImage leaves no image behind when the save write hits the quota', async () => {
    const realPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: [unknown, IDBValidKey?]
    ) {
      if (this.name === 'saves') throw new DOMException('quota', 'QuotaExceededError');
      return realPut.apply(this, args);
    });
    const save = makeSave({ sourceImageId: 'orphan' });
    try {
      await expect(putSaveWithImage(save, new Blob([new Uint8Array([1])]))).rejects.toBeInstanceOf(
        StorageFullError,
      );
    } finally {
      spy.mockRestore();
    }
    expect(await getImage('orphan')).toBeUndefined();
    expect(await getSave(save.id)).toBeUndefined();
  });
});

describe('quota', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the browser values when navigator.storage is supported', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persist: async () => true,
        persisted: async () => false,
        estimate: async () => ({ usage: 10, quota: 100 }),
      },
    });
    expect(await requestPersistence()).toBe(true);
    expect(await isPersisted()).toBe(false);
    expect(await storageEstimate()).toEqual({ usage: 10, quota: 100 });
    expect(canRequestPersistence()).toBe(true);
  });

  it('falls back when navigator.storage is undefined', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistence()).toBe(false);
    expect(await isPersisted()).toBe(false);
    expect(await storageEstimate()).toBeNull();
    expect(canRequestPersistence()).toBe(false);
  });

  it('falls back when the browser call throws', async () => {
    const fail = async (): Promise<never> => {
      throw new Error('denied');
    };
    vi.stubGlobal('navigator', { storage: { persist: fail, persisted: fail, estimate: fail } });
    expect(await requestPersistence()).toBe(false);
    expect(await isPersisted()).toBe(false);
    expect(await storageEstimate()).toBeNull();
  });
});

describe('createSave persistence request', () => {
  beforeEach(async () => {
    await closeDb();
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks for persistent storage exactly once after a successful create', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persist } });
    const save = makeSave();
    await createSave(save);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await getSave(save.id)).toBeDefined();
  });

  it('does not ask when the create fails', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persist } });
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      await expect(createSave(makeSave())).rejects.toBeInstanceOf(StorageFullError);
    } finally {
      spy.mockRestore();
    }
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('settings', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    resetSettingsCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns defaults when empty', () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists partial updates', () => {
    setSettings({ sound: false });
    setSettings({ paletteMode: 'free' });
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, sound: false, paletteMode: 'free' });
    expect(JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}').sound).toBe(false);
  });

  it('ignores corrupt or invalid values', () => {
    storage.setItem(SETTINGS_KEY, '{not json');
    resetSettingsCache();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ sound: 'no', paletteMode: 'x', haptics: false }),
    );
    resetSettingsCache();
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, haptics: false });
  });

  it('keeps a boolean dither and falls back to false otherwise', () => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ dither: 'yes' }));
    resetSettingsCache();
    expect(getSettings().dither).toBe(false);
    storage.setItem(SETTINGS_KEY, JSON.stringify({ dither: true }));
    resetSettingsCache();
    expect(getSettings().dither).toBe(true);
    expect(setSettings({ dither: false }).dither).toBe(false);
  });

  it('clamps maxColors to the slider range', () => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ maxColors: 2 }));
    resetSettingsCache();
    expect(getSettings().maxColors).toBe(MIN_COLORS);
    storage.setItem(SETTINGS_KEY, JSON.stringify({ maxColors: 99 }));
    resetSettingsCache();
    expect(getSettings().maxColors).toBe(MAX_COLORS);
  });

  it('keeps a known background and falls back to gray for an unknown one', () => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ background: 'blue' }));
    resetSettingsCache();
    expect(getSettings().background).toBe('blue');
    storage.setItem(SETTINGS_KEY, JSON.stringify({ background: 'neon' }));
    resetSettingsCache();
    expect(getSettings().background).toBe('gray');
    expect(setSettings({ background: 'purple' }).background).toBe('purple');
  });

  it('survives a throwing localStorage', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    });
    expect(setSettings({ haptics: false }).haptics).toBe(false);
    expect(getSettings().haptics).toBe(false);
  });

  it('serves reads from memory and returns copies', () => {
    const spy = vi.spyOn(storage, 'getItem');
    getSettings();
    getSettings();
    expect(spy).toHaveBeenCalledTimes(1);
    const a = getSettings();
    a.sound = false;
    expect(getSettings().sound).toBe(true);
  });
});

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}
class FakeNode {
  connect = vi.fn();
}
class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  start = vi.fn();
}
class FakeFilter extends FakeNode {
  type = 'bandpass';
  frequency = { value: 0 };
  Q = { value: 0 };
}
const oscs: FakeOsc[] = [];
const sources: FakeSource[] = [];
let ctxCount = 0;
class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  constructor() {
    ctxCount++;
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  createOscillator(): FakeOsc {
    const o = new FakeOsc();
    oscs.push(o);
    return o;
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
  sampleRate = 48000;
  createBuffer(_ch: number, len: number): { getChannelData: () => Float32Array } {
    const data = new Float32Array(len);
    return { getChannelData: () => data };
  }
  createBufferSource(): FakeSource {
    const src = new FakeSource();
    sources.push(src);
    return src;
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }
}

describe('audio + haptics', () => {
  let vibrate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resetAudioForTests();
    oscs.length = 0;
    sources.length = 0;
    ctxCount = 0;
    vibrate = vi.fn();
    vi.stubGlobal('localStorage', new MemoryStorage());
    resetSettingsCache();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('navigator', { vibrate });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates the context lazily on first gesture, once', () => {
    const target = new EventTarget();
    initAudio(target);
    expect(ctxCount).toBe(0);
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('pointerdown'));
    expect(ctxCount).toBe(1);
  });

  it('keeps listening until the context actually runs', async () => {
    const target = new EventTarget();
    const spy = vi.spyOn(target, 'removeEventListener');
    const ac = unlockAudio() as unknown as FakeAudioContext;
    ac.state = 'suspended';
    ac.resume.mockImplementation(async () => undefined);
    initAudio(target);
    target.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    ac.resume.mockImplementation(async () => {
      ac.state = 'running';
    });
    target.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalled();
  });

  it('plays every sound when enabled', () => {
    unlockAudio();
    for (const name of [
      'place',
      'remove',
      'colorDone',
      'panelComplete',
      'pictureComplete',
      'error',
    ] as const) {
      const before = oscs.length + sources.length;
      play(name);
      expect(oscs.length + sources.length).toBeGreaterThan(before);
    }
    expect(oscs[0].start).toHaveBeenCalled();
  });

  it('plays every place-sound variant and uses the setting', () => {
    unlockAudio();
    for (const kind of PLACE_SOUNDS) {
      const before = oscs.length + sources.length;
      playPlaceSound(kind);
      expect(oscs.length + sources.length).toBeGreaterThan(before);
    }
    expect(DEFAULT_SETTINGS.placeSound).toBe('snap');
  });

  it('is silent when sound is disabled', () => {
    setSettings({ sound: false });
    play('place');
    expect(oscs).toHaveLength(0);
  });

  it('does nothing without Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(unlockAudio()).toBeNull();
    expect(() => play('place')).not.toThrow();
  });

  it('vibrates with named and explicit patterns when enabled', () => {
    haptic('colorDone');
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.colorDone);
    haptic([1, 2]);
    expect(vibrate).toHaveBeenLastCalledWith([1, 2]);
  });

  it('skips haptics when disabled or unsupported', () => {
    setSettings({ haptics: false });
    haptic('place');
    expect(vibrate).not.toHaveBeenCalled();
    setSettings({ haptics: true });
    vi.stubGlobal('navigator', {});
    expect(() => haptic('place')).not.toThrow();
  });
});
