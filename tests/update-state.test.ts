import { describe, expect, it, vi } from 'vitest';

describe('update state', () => {
  it('waits for XR exit and saved work before invoking the update', async () => {
    vi.resetModules();
    const state = await import('../src/updateState');
    const order: string[] = [];
    let finishExit = (): void => {};
    const exit = new Promise<void>((resolve) => {
      finishExit = resolve;
    });
    state.registerImmersiveEnd(async () => {
      order.push('exit');
      await exit;
    });
    state.registerUpdateFlush(async () => {
      order.push('save');
    });
    state.configureUpdateHandler(async () => {
      order.push('update');
    });
    state.markUpdateAvailable();
    const pending = state.requestUpdate();
    expect(state.getUpdateStatus()).toMatchObject({ available: true, busy: true });
    expect(order).toEqual(['exit']);
    finishExit();
    await pending;
    expect(order).toEqual(['exit', 'save', 'update']);
  });
  it('keeps the notice available and reports save failure without applying', async () => {
    vi.resetModules();
    const state = await import('../src/updateState');
    const apply = vi.fn(async () => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.configureUpdateHandler(apply);
    state.registerUpdateFlush(async () => {
      throw new Error('save failed');
    });
    state.markUpdateAvailable();
    await state.requestUpdate();
    expect(apply).not.toHaveBeenCalled();
    expect(state.getUpdateStatus()).toMatchObject({
      available: true,
      busy: false,
      error: 'Could not reload. Try again.',
    });
    vi.restoreAllMocks();
  });
  it('ignores repeated reload requests while an update is in flight', async () => {
    vi.resetModules();
    const state = await import('../src/updateState');
    let finish = (): void => {};
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const apply = vi.fn(async () => wait);
    state.configureUpdateHandler(apply);
    state.markUpdateAvailable();
    const first = state.requestUpdate();
    await state.requestUpdate();
    expect(apply).toHaveBeenCalledOnce();
    finish();
    await first;
  });
});
