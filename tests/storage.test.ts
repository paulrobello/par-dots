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
  putImage,
  putSave,
  StorageFullError,
} from '../src/storage/db';
import { newId } from '../src/storage/id';
import {
  DEFAULT_SETTINGS,
  getSettings,
  PLACE_SOUNDS,
  SETTINGS_KEY,
  setSettings,
} from '../src/storage/settings';
import { EMPTY, type PictureSave } from '../src/types';

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
    id: newId(),
    createdAt: 1,
    updatedAt: 1,
    name: 'Test',
    sourceImageId: 'library:lighthouse',
    aspect: '1:1',
    paletteMode: 'lego',
    palette: [{ hex: '#ff0000', name: 'Red' }],
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

  it('stores and retrieves images', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const id = await putImage(blob);
    const got = await getImage(id);
    expect(got).toBeDefined();
    expect(got?.size).toBe(3);
    expect(await getImage('nope')).toBeUndefined();
  });

  it('deleteSave removes an uploaded image but keeps library references', async () => {
    const imgId = await putImage(new Blob([new Uint8Array([9])]));
    const uploaded = makeSave({ sourceImageId: imgId });
    const lib = makeSave({ sourceImageId: 'library:lighthouse' });
    await putSave(uploaded);
    await putSave(lib);

    await deleteSave(uploaded.id);
    expect(await getSave(uploaded.id)).toBeUndefined();
    expect(await getImage(imgId)).toBeUndefined();

    await deleteSave(lib.id);
    expect(await getSave(lib.id)).toBeUndefined();
    await expect(deleteSave('missing')).resolves.toBeUndefined();
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
      await expect(putImage(new Blob([]))).rejects.toBeInstanceOf(StorageFullError);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('settings', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
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
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ sound: 'no', paletteMode: 'x', haptics: false }),
    );
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, haptics: false });
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
    expect(DEFAULT_SETTINGS.placeSound).toBe('click');
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
