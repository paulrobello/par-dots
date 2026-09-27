/** Verify legacy palette labels in the tray, parts, and guide without altering saved colors. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { PaletteColor, PaletteMode, PictureSave } from '../src/types';

type ObservedWindow = typeof window & { drawnColorLabels: string[] };
const base = process.argv[2] ?? 'http://localhost:4231/';
const out = '.claude/shots/color-names';
const palettes: Record<PaletteMode, PaletteColor[]> = {
  free: [
    { hex: '#080608', name: 'Black' },
    { hex: '#381921', name: 'Black' },
    { hex: '#703322', name: 'Reddish Brown' },
    { hex: '#963f26', name: 'Dark Red' },
    { hex: '#efac6c', name: 'Nougat' },
  ],
  lego: [
    { hex: '#05131d', name: 'Black' },
    { hex: '#720e0f', name: 'Dark Red' },
    { hex: '#582a12', name: 'Reddish Brown' },
    { hex: '#a95500', name: 'Dark Orange' },
    { hex: '#d09168', name: 'Nougat' },
  ],
};

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
try {
  for (const mode of ['free', 'lego'] as const) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript(() => {
      const observed = window as ObservedWindow;
      observed.drawnColorLabels = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
        observed.drawnColorLabels.push(text);
        if (maxWidth === undefined) fillText.call(this, text, x, y);
        else fillText.call(this, text, x, y, maxWidth);
      };
    });
    await page.goto(base);
    await page.getByRole('button', { name: 'New Picture' }).waitFor();
    await page.evaluate(
      ({ mode, palette }) =>
        new Promise<void>((resolve, reject) => {
          localStorage.setItem('par-dots:install-prompt-dismissed', '1');
          localStorage.setItem('par-dots:settings', JSON.stringify({ sound: false, music: false }));
          const request = indexedDB.open('par-dots');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const target = Uint8Array.from({ length: 48 * 48 }, (_, i) => i % palette.length);
            const placed = new Uint8Array(target.length).fill(255);
            placed[0] = target[0];
            const save: PictureSave = {
              id: 'legacy-colors',
              schemaVersion: 1,
              name: 'Saved color labels',
              width: 48,
              height: 48,
              aspect: '1:1',
              paletteMode: mode,
              sourceImageId: 'library:lighthouse',
              createdAt: 1,
              updatedAt: 2,
              palette,
              target,
              placed,
              panelElapsedMs: new Array(9).fill(0),
            };
            const tx = db.transaction('saves', 'readwrite');
            tx.objectStore('saves').put(save);
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        }),
      { mode, palette: palettes[mode] },
    );
    const snapshot = () =>
      page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open('par-dots');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const read = db.transaction('saves').objectStore('saves').get('legacy-colors');
              read.onerror = () => reject(read.error);
              read.onsuccess = () => {
                const save = read.result as PictureSave;
                resolve({
                  palette: save.palette,
                  target: Array.from(save.target),
                  placed: Array.from(save.placed),
                });
                db.close();
              };
            };
          }),
      );
    const before = await snapshot();
    const expected =
      mode === 'free'
        ? ['Black', 'Burgundy', 'Brown', 'Rust', 'Peach']
        : palettes.lego.map((c) => c.name);
    await page.goto(`${base}#/play/legacy-colors/0`);
    await page.reload();
    await page.locator('.tray-label').nth(4).waitFor();
    assert.deepEqual(await page.locator('.tray-label').allTextContents(), expected);
    await page.getByRole('radio', { name: new RegExp(`^${expected[3]},`) }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/${mode}-tray.png` });
    await page.locator('.tray-wrap').screenshot({ path: `${out}/${mode}-tray-detail.png` });
    await page.getByRole('button', { name: 'Back to overview' }).click();
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    const parts = page.getByRole('dialog', { name: 'Parts', exact: true });
    await parts.waitFor();
    assert.deepEqual(
      (await parts.locator('.parts-label').allTextContents()).sort(),
      [...expected].sort(),
    );
    await page.screenshot({ path: `${out}/${mode}-parts.png` });
    await page.evaluate(() => {
      (window as ObservedWindow).drawnColorLabels = [];
    });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      parts.getByRole('button', { name: 'Panel sheet', exact: true }).click(),
    ]);
    const drawn = await page.evaluate(() => (window as ObservedWindow).drawnColorLabels);
    for (const label of expected) assert(drawn.includes(label), `guide missing ${label}`);
    await download.saveAs(`${out}/${mode}-guide.png`);
    assert.deepEqual(
      await snapshot(),
      before,
      'label display must not rewrite palette, target, or progress',
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`color names: ${mode} tray, parts, guide, and saved state passed`);
  }
} finally {
  await browser.close();
}
