import { describe, expect, it, type Mock, vi } from 'vitest';
import { disposeTree, launchVr, type Studio } from '../src/xr/scene';

/** An XRSession stub backed by a real EventTarget, with `end` spied. */
const makeSession = (): XRSession & { end: ReturnType<typeof vi.fn> } => {
  const target = new EventTarget();
  const end = vi.fn(() => Promise.resolve());
  const session = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    end,
  };
  return session as unknown as XRSession & { end: ReturnType<typeof vi.fn> };
};

/** A Studio stub whose renderer methods and dispose are all spies. */
const makeStudio = (): Studio =>
  ({
    renderer: {
      xr: { setSession: vi.fn(() => Promise.resolve(true)) },
      setAnimationLoop: vi.fn(),
    },
    scene: { add: vi.fn(), children: [] },
    render: vi.fn(),
    dispose: vi.fn(),
  }) as unknown as Studio;

const loopMock = (studio: Studio): Mock => vi.mocked(studio.renderer.setAnimationLoop);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('disposeTree', () => {
  it('disposes geometry, materials, maps, and nested children', () => {
    const geo = vi.fn();
    const mat = vi.fn();
    const map = vi.fn();
    const childGeo = vi.fn();
    disposeTree({
      geometry: { dispose: geo },
      material: { dispose: mat, map: { dispose: map } },
      children: [{ geometry: { dispose: childGeo } }],
    });
    expect(geo).toHaveBeenCalledTimes(1);
    expect(mat).toHaveBeenCalledTimes(1);
    expect(map).toHaveBeenCalledTimes(1);
    expect(childGeo).toHaveBeenCalledTimes(1);
  });

  it('disposes material arrays', () => {
    const m1 = vi.fn();
    const m2 = vi.fn();
    disposeTree({ material: [{ dispose: m1 }, { dispose: m2 }] });
    expect(m1).toHaveBeenCalledTimes(1);
    expect(m2).toHaveBeenCalledTimes(1);
  });
});

describe('launchVr', () => {
  it('binds the session and starts the render loop', async () => {
    const studio = makeStudio();
    const session = makeSession();
    launchVr(session, { onEnd: vi.fn() }, () => studio);
    expect(studio.renderer.xr.setSession).toHaveBeenCalledWith(session);
    await flush();
    expect(loopMock(studio)).toHaveBeenCalledTimes(1);
    const loop = loopMock(studio).mock.calls[0][0] as (t: number) => void;
    loop(0);
    expect(vi.mocked(studio.render)).toHaveBeenCalledTimes(1);
  });

  it('on session end stops the loop, disposes, and fires onEnd exactly once', () => {
    const onEnd = vi.fn();
    const studio = makeStudio();
    const session = makeSession();
    launchVr(session, { onEnd }, () => studio);
    session.dispatchEvent(new Event('end'));
    session.dispatchEvent(new Event('end'));
    expect(loopMock(studio).mock.calls.at(-1)).toEqual([null]);
    expect(vi.mocked(studio.dispose)).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('end() ends the session', async () => {
    const session = makeSession();
    const launch = launchVr(session, { onEnd: vi.fn() }, () => makeStudio());
    await launch.end();
    expect(session.end).toHaveBeenCalled();
  });

  it('stops cleanly when setSession rejects', async () => {
    const onEnd = vi.fn();
    const studio = makeStudio();
    const session = makeSession();
    vi.mocked(studio.renderer.xr.setSession).mockReturnValue(Promise.reject(new Error('no xr')));
    launchVr(session, { onEnd }, () => studio);
    await flush();
    expect(session.end).toHaveBeenCalled();
    expect(vi.mocked(studio.dispose)).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends the dangling session when studio creation throws', () => {
    const session = makeSession();
    expect(() =>
      launchVr(session, { onEnd: vi.fn() }, () => {
        throw new Error('no WebGL');
      }),
    ).toThrow('no WebGL');
    expect(session.end).toHaveBeenCalled();
  });
});
