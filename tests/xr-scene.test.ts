import { describe, expect, it, type Mock, vi } from 'vitest';
import {
  configureUpdateHandler,
  markUpdateAvailable,
  registerUpdateFlush,
  requestUpdate,
} from '../src/updateState';
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
  it('releases the studio and ends the session if world creation fails', () => {
    const studio = makeStudio();
    const session = makeSession();
    expect(() =>
      launchVr(
        session,
        {
          onEnd: vi.fn(),
          buildWorld: () => {
            throw new Error('world');
          },
        },
        () => studio,
      ),
    ).toThrow('world');
    expect(studio.dispose).toHaveBeenCalledOnce();
    expect(session.end).toHaveBeenCalledOnce();
  });

  it('cleans up if binding the session throws synchronously', () => {
    const studio = makeStudio();
    const session = makeSession();
    const onEnd = vi.fn();
    vi.mocked(studio.renderer.xr.setSession).mockImplementation(() => {
      throw new Error('bind');
    });
    expect(() => launchVr(session, { onEnd }, () => studio)).toThrow('bind');
    expect(studio.dispose).toHaveBeenCalledOnce();
    expect(session.end).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('forwards already-connected input sources after renderer binding', () => {
    const studio = makeStudio();
    const session = makeSession();
    const source = { handedness: 'right' } as XRInputSource;
    Object.defineProperty(session, 'inputSources', { value: [source] });
    const connected = vi.fn();
    vi.mocked(studio.renderer.xr.setSession).mockImplementation(() => {
      session.addEventListener('inputsourceschange', connected);
    });
    launchVr(session, { onEnd: vi.fn() }, () => studio);
    expect(connected).toHaveBeenCalledOnce();
    const event = connected.mock.calls[0][0] as XRInputSourcesChangeEvent;
    expect(event.added).toEqual([source]);
    expect(event.removed).toEqual([]);
  });

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

  it('ends the immersive session and flushes saved work before an update', async () => {
    const session = makeSession();
    const order: string[] = [];
    session.end.mockImplementation(() => {
      order.push('end');
      session.dispatchEvent(new Event('end'));
      return Promise.resolve();
    });
    const unregister = registerUpdateFlush(async () => {
      order.push('save');
    });
    configureUpdateHandler(async () => {
      order.push('update');
    });
    markUpdateAvailable();
    launchVr(
      session,
      {
        onEnd: () => {
          order.push('cleanup');
        },
      },
      () => makeStudio(),
    );
    await requestUpdate();
    expect(order).toEqual(['end', 'cleanup', 'save', 'update']);
    unregister();
  });
});
