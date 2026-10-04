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

describe('restartDrawnSave', () => {
  it('refills placed with the background index and persists', async () => {
    const { restartDrawnSave } = await import('../src/ui/saves');
    const save = {
      id: 'd1',
      aspect: '1:1',
      origin: 'drawn',
      drawBackground: '#ffffff',
      palette: [
        { hex: '#05131d', name: 'Black' },
        { hex: '#ffffff', name: 'White' },
      ],
      width: 48,
      height: 48,
      placed: new Uint8Array(48 * 48).fill(0),
    } as unknown as Parameters<typeof restartDrawnSave>[0];
    save.placed[7] = 1;
    const write = restartDrawnSave(save);
    finishPut(); // the shared db mock's putSave promise resolves only via finishPut
    await write;
    expect(save.placed.every((v: number) => v === 1)).toBe(true); // white background index
  });

  it('clears to EMPTY when there is no background', async () => {
    const { restartDrawnSave } = await import('../src/ui/saves');
    const save = {
      id: 'd2',
      aspect: '1:1',
      origin: 'drawn',
      palette: [
        { hex: '#05131d', name: 'Black' },
        { hex: '#ffffff', name: 'White' },
      ],
      width: 48,
      height: 48,
      placed: new Uint8Array(48 * 48).fill(0),
    } as unknown as Parameters<typeof restartDrawnSave>[0];
    const write = restartDrawnSave(save);
    finishPut(); // the shared db mock's putSave promise resolves only via finishPut
    await write;
    expect(save.placed.every((v: number) => v === 255)).toBe(true);
  });
});
