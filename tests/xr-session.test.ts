import { describe, expect, it, vi } from 'vitest';
import { requestVrSession, xrSupport } from '../src/xr/session';

/** An XRSystem stub whose isSessionSupported resolves or rejects per mode. */
const mockXr = (vr: boolean | Error, ar: boolean | Error): XRSystem =>
  ({
    isSessionSupported: (mode: string): Promise<boolean> => {
      if (mode === 'immersive-vr') {
        if (vr instanceof Error) return Promise.reject(vr);
        return Promise.resolve(vr);
      }
      if (ar instanceof Error) return Promise.reject(ar);
      return Promise.resolve(ar);
    },
  }) as unknown as XRSystem;

describe('xrSupport', () => {
  it('reports no support when navigator.xr is undefined', async () => {
    await expect(xrSupport(undefined)).resolves.toEqual({ vr: false, ar: false });
  });

  it('detects VR-only support (desktop emulation, phone AR)', async () => {
    await expect(xrSupport(mockXr(true, false))).resolves.toEqual({ vr: true, ar: false });
    await expect(xrSupport(mockXr(false, true))).resolves.toEqual({ vr: false, ar: true });
  });

  it('detects both modes', async () => {
    await expect(xrSupport(mockXr(true, true))).resolves.toEqual({ vr: true, ar: true });
  });

  it('treats a rejecting isSessionSupported as unsupported', async () => {
    const boom = new Error('unknown mode');
    await expect(xrSupport(mockXr(boom, boom))).resolves.toEqual({ vr: false, ar: false });
  });
});

describe('requestVrSession', () => {
  it('requests immersive-vr with a floor-level reference space', async () => {
    const session = new EventTarget() as unknown as XRSession;
    const xr = {
      requestSession: vi.fn(() => Promise.resolve(session)),
    } as unknown as XRSystem;
    await expect(requestVrSession(xr)).resolves.toBe(session);
    expect(xr.requestSession).toHaveBeenCalledWith('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
  });
});
