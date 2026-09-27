import { describe, expect, it, vi } from 'vitest';

let finishPut: () => void = () => {};
vi.mock('../src/storage/db', () => ({
  putSave: () =>
    new Promise<void>((r) => {
      finishPut = r;
    }),
}));

const { persistSave, whenSaved } = await import('../src/ui/saves');

describe('whenSaved', () => {
  it('resolves immediately with nothing in flight', async () => {
    await expect(whenSaved()).resolves.toBeUndefined();
  });

  it('waits for an in-flight persistSave', async () => {
    const save = { id: 's1', updatedAt: 0 } as unknown as Parameters<typeof persistSave>[0];
    const write = persistSave(save);
    let settled = false;
    const wait = whenSaved().then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    finishPut();
    await wait;
    await write;
    expect(settled).toBe(true);
  });
});
