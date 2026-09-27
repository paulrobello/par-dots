/** Visual-polish regression checks against a running build, using disposable browser storage. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4231/';
const out = '.claude/shots/polish';

async function seed(page: Page, id: string, finale = false): Promise<void> {
  await page.goto(base);
  await page.getByRole('button', { name: 'New Picture' }).waitFor();
  await page.evaluate(
    ({ id, finale }) =>
      new Promise<void>((resolve, reject) => {
        localStorage.setItem('par-dots:install-prompt-dismissed', '1');
        localStorage.setItem('par-dots:settings', JSON.stringify({ sound: false, music: false }));
        const request = indexedDB.open('par-dots');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const target = new Uint8Array(48 * 48).fill(3);
          target.set([0, 1, 2, 3, 3]);
          const placed = new Uint8Array(target);
          placed.fill(255, 0, 5);
          if (!finale) placed[16] = 255;
          const tx = db.transaction('saves', 'readwrite');
          tx.objectStore('saves').put({
            id,
            schemaVersion: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            name: 'Polish test',
            sourceImageId: 'library:lighthouse',
            aspect: '1:1',
            paletteMode: 'free',
            width: 48,
            height: 48,
            palette: [
              { name: 'Red', hex: '#c91a09' },
              { name: 'Blue', hex: '#0055bf' },
              { name: 'Yellow', hex: '#f2cd37' },
              { name: 'White', hex: '#eeeeee' },
            ],
            target,
            placed,
            panelElapsedMs: new Array(9).fill(0),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { id, finale },
  );
  await page.goto(`${base}#/play/${id}/0`);
  await page.reload();
  await page.getByRole('radio', { name: 'Red, 1 left', exact: true }).waitFor();
}

async function place(page: Page, x: number): Promise<void> {
  const box = await page.locator('.board-canvas').boundingBox();
  assert(box);
  const cell = Math.min(box.width, box.height) / 16.5;
  await page.mouse.click(
    box.x + (box.width - cell * 16) / 2 + cell * (x + 0.5),
    box.y + (box.height - cell * 16) / 2 + cell / 2,
  );
}

async function canvasImage(page: Page): Promise<string> {
  return page.locator('.board-canvas').evaluate((el) => (el as HTMLCanvasElement).toDataURL());
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const errors: string[] = [];
  try {
    for (const reduced of [false, true]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        reducedMotion: reduced ? 'reduce' : 'no-preference',
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await seed(page, `polish-${reduced}`);
      if (!reduced) {
        for (const theme of ['Blue', 'Green', 'Brown', 'Purple', 'Gray']) {
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await page
            .getByRole('radiogroup', { name: 'Background', exact: true })
            .getByRole('radio', { name: theme, exact: true })
            .click();
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          await page.getByRole('dialog').waitFor({ state: 'detached' });
          await page.screenshot({ path: `${out}/theme-${theme.toLowerCase()}.png` });
        }
      }
      const overlay = page.getByRole('button', { name: 'Show reference on the board' });
      const plain = await canvasImage(page);
      await overlay.click();
      await page.waitForTimeout(220);
      const reference = await canvasImage(page);
      assert.notEqual(reference, plain, 'reference overlay must be visible');
      await overlay.click();
      await overlay.click();
      await overlay.click();
      await page.waitForTimeout(220);
      assert.equal(await canvasImage(page), plain, 'rapid toggle must restore the board exactly');

      await page.getByRole('radio', { name: 'Blue, 1 left', exact: true }).click();
      await page.getByRole('radio', { name: 'Yellow, 1 left', exact: true }).click();
      await page.getByRole('radio', { name: 'Red, 1 left', exact: true }).click();
      await place(page, 0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.waitForTimeout(700);
      assert.equal(await page.getByRole('radio', { name: /^Red,/ }).count(), 1);
      assert.equal(await page.locator('.tray-dot').count(), 4, 'undo must not duplicate colors');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await page.waitForTimeout(700);
      assert.equal(await page.getByRole('radio', { name: /^Red,/ }).count(), 0);

      // Exhaust Blue on a wrong stud. Zero supply is not color completion.
      await page.getByRole('radio', { name: /^Blue,/ }).click();
      await place(page, 2);
      const wrongBlue = page.getByRole('radio', { name: /Blue, none left, some misplaced/ });
      await wrongBlue.waitFor();
      await page.waitForTimeout(700);
      assert.equal(await wrongBlue.count(), 1);
      assert.equal(await wrongBlue.locator('.tray-count').textContent(), '0');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.getByRole('radio', { name: /^Blue,/ }).click();
      await place(page, 1);
      await page.getByRole('radio', { name: /^Yellow,/ }).click();
      await place(page, 2);
      await page.getByRole('radio', { name: /^White,/ }).click();
      await place(page, 3);
      await page.waitForTimeout(700);
      for (const size of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
        { width: 1440, height: 960 },
      ]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(250);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        const selected = page.getByRole('radio', { name: 'White, 1 left', exact: true });
        assert.equal(await selected.getAttribute('aria-checked'), 'true');
        const selectedBox = await selected.boundingBox();
        const ringBox = await page.locator('.tray-selection').boundingBox();
        assert(selectedBox && ringBox);
        assert(Math.abs(selectedBox.x - ringBox.x) < 2, 'selection ring follows reflow');
        assert(Math.abs(selectedBox.width - ringBox.width) < 2, 'selection ring matches hitbox');
        await page.screenshot({
          path: `${out}/${reduced ? 'reduced' : 'motion'}-${size.width}.png`,
        });
      }
      await place(page, 4);
      await page.locator('.panel-complete-badge').waitFor();
      assert.equal(await page.locator('.confetti').count(), 0, 'panels must not emit confetti');
      assert.equal(
        await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(),
        true,
      );
      await page.screenshot({ path: `${out}/${reduced ? 'reduced' : 'motion'}-complete.png` });
      await page.getByRole('dialog', { name: 'Panel complete' }).waitFor();
      await page
        .getByRole('dialog', { name: 'Panel complete' })
        .getByRole('button', { name: /^Next panel/ })
        .click();
      await page.waitForURL(/\/1$/);
      assert.equal(await page.locator('.panel-complete-badge').count(), 0);
      await page.getByRole('radio', { name: 'White, 1 left', exact: true }).waitFor();
      await place(page, 0);
      await page.goto(base);
      await page.waitForTimeout(1800);
      assert.equal(
        await page.getByRole('dialog').count(),
        0,
        'navigation must not reopen completion',
      );
      assert.equal(await page.locator('.confetti, .panel-complete-badge').count(), 0);
      await context.close();
      console.log(`polish: ${reduced ? 'reduced motion' : 'normal motion'} passed`);
    }
    assert.deepEqual(errors, [], 'browser errors');
  } finally {
    await browser.close();
  }
}

await main();
