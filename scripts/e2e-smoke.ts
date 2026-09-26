/**
 * Mobile smoke test against a running preview (default http://localhost:4231):
 * pick the lighthouse, start, open a panel, paint, hint, undo, remove. Screenshots go to
 * .claude/shots/. Run: bun run build && bunx vite preview --port 4231 --strictPort,
 * then bun run scripts/e2e-smoke.ts [baseUrl].
 */
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4231/';
const out = '.claude/shots';

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`shot ${out}/${name}.png`);
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(base);
  await page.getByRole('button', { name: 'New Picture' }).waitFor();
  await shot(page, '01-gallery-empty');

  await page.getByRole('button', { name: 'New Picture' }).click();
  await page.getByRole('button', { name: 'Lighthouse' }).waitFor();
  await shot(page, '02-source');

  await page.getByRole('button', { name: 'Lighthouse' }).click();
  await page.waitForURL(/#\/setup/);
  await page.locator('.preview-box canvas').waitFor();
  await shot(page, '03-setup');

  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForURL(/#\/play\/[^/]+$/);
  await page.locator('.panel-btn').first().waitFor();
  await shot(page, '04-overview');

  await page.getByRole('button', { name: 'Open panel 5 of 12' }).click();
  await page.waitForURL(/#\/play\/[^/]+\/4$/);
  await page.locator('.tray-dot').first().waitFor();
  await shot(page, '05-panel-open');

  const box = await page.locator('.board-canvas').boundingBox();
  if (!box) throw new Error('no board');

  // Two-finger pinch via real touch events must zoom without placing a dot.
  const cdp = await context.newCDPSession(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const pt = (x: number, y: number, id: number) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [pt(cx - 20, cy, 1)],
  });
  await page.waitForTimeout(20);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [pt(cx - 20, cy, 1), pt(cx + 20, cy, 2)],
  });
  for (let k = 1; k <= 6; k++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [pt(cx - 20 - k * 15, cy, 1), pt(cx + 20 + k * 15, cy, 2)],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  await shot(page, '05b-pinch-zoomed');
  const afterPinch = {
    pct: await page.locator('.topbar .pill').first().textContent(),
    undoDisabled: await page.getByRole('button', { name: 'Undo' }).isDisabled(),
  };
  console.log('after pinch:', afterPinch);
  if (afterPinch.pct !== '0%' || !afterPinch.undoDisabled) throw new Error('pinch placed a dot');
  // Single touch tap places one dot.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(cx, cy, 3)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const tapUndo = await page.getByRole('button', { name: 'Undo' }).isEnabled();
  console.log('touch tap created a move:', tapUndo);
  if (!tapUndo) throw new Error('touch tap did not place');
  await page.getByRole('button', { name: 'Undo' }).click();
  // Reset zoom by reopening the panel.
  await page.reload();
  await page.locator('.tray-dot').first().waitFor();
  const cell = Math.min(box.width, box.height) / 16.5;
  const x0 = box.x + (box.width - cell * 16) / 2;
  const y0 = box.y + (box.height - cell * 16) / 2;
  const at = (cx: number, cy: number): [number, number] => [
    x0 + (cx + 0.5) * cell,
    y0 + (cy + 0.5) * cell,
  ];

  // Tap one stud, then drag across a row quickly (few move steps to exercise interpolation).
  await page.mouse.click(...at(0, 0));
  await page.mouse.move(...at(0, 2));
  await page.mouse.down();
  await page.mouse.move(...at(15, 2), { steps: 3 });
  await page.mouse.up();
  const trayBefore = await page.locator('.tray-dot').count();
  // Select another color and paint row 4.
  await page
    .locator('.tray-dot')
    .nth(Math.min(1, trayBefore - 1))
    .click();
  await page.mouse.move(...at(0, 4));
  await page.mouse.down();
  await page.mouse.move(...at(15, 4), { steps: 2 });
  await page.mouse.up();
  const pct = await page.locator('.topbar .pill').first().textContent();
  console.log('after painting, progress', pct);
  await shot(page, '06-painted');

  await page.getByRole('button', { name: 'Hint: show wrong dots' }).click();
  await shot(page, '07-hint');

  const undo = page.getByRole('button', { name: 'Undo' });
  await undo.click();
  await shot(page, '08-undo');
  console.log(
    'redo enabled after undo:',
    await page.getByRole('button', { name: 'Redo' }).isEnabled(),
  );

  await page.getByRole('button', { name: 'Remove tool' }).click();
  await page.mouse.move(...at(0, 2));
  await page.mouse.down();
  await page.mouse.move(...at(7, 2), { steps: 2 });
  await page.mouse.up();
  await shot(page, '09-removed');

  await page.getByRole('button', { name: 'Reference image. Tap to enlarge.' }).click();
  await shot(page, '10-reference');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  await shot(page, '11-settings');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Back to overview' }).click();
  await page.waitForURL(/#\/play\/[^/]+$/);
  await shot(page, '12-overview-progress');

  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await page.locator('.save-card').first().waitFor();
  await shot(page, '13-gallery-saved');

  // Reload persists progress.
  await page.reload();
  await page.locator('.save-card').first().waitFor();
  console.log('gallery after reload:', await page.locator('.save-meta p').first().textContent());

  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('.save-card button.btn.primary').first().click();
  await page.getByRole('button', { name: 'Open panel 5 of 12' }).click();
  await page.locator('.board-canvas').waitFor();
  await shot(page, '14-panel-landscape');

  // Completion: fill every stud correctly except panel 1's first stud, then place it.
  await page.setViewportSize({ width: 390, height: 844 });
  // Leave the panel first: its cleanup persists the in-memory save.
  await page.goto(`${base}#/`);
  await page.locator('.save-card').first().waitFor();
  const saveId = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open('par-dots');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction('saves', 'readwrite');
          const store = t.objectStore('saves');
          const all = store.getAll();
          all.onsuccess = () => {
            const s = all.result[0];
            s.placed = new Uint8Array(s.target);
            s.placed[0] = 255;
            store.put(s);
            t.oncomplete = () => resolve(s.id as string);
          };
        };
      }),
  );
  await page.goto(`${base}#/play/${saveId}/0`);
  await page.reload();
  await page.locator('.tray-dot').first().waitFor();
  console.log('tray colors with one stud left:', await page.locator('.tray-dot').count());
  const box2 = await page.locator('.board-canvas').boundingBox();
  if (!box2) throw new Error('no board');
  const cell2 = Math.min(box2.width, box2.height) / 16.5;
  await page.mouse.click(
    box2.x + (box2.width - cell2 * 16) / 2 + cell2 / 2,
    box2.y + (box2.height - cell2 * 16) / 2 + cell2 / 2,
  );
  await page.waitForTimeout(500);
  await shot(page, '15-panel-complete');
  await page.getByRole('dialog', { name: 'Picture complete' }).waitFor({ timeout: 8000 });
  await shot(page, '16-finale');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('dialog').getByRole('button', { name: 'Export PNG' }).click(),
  ]);
  console.log('exported', download.suggestedFilename());
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open panel 1 of 12' }).click();
  await page.locator('.locked-note').waitFor();
  await shot(page, '17-panel-locked');

  // Landscape shots of the other screens.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`${base}#/`);
  await page.locator('.save-card').first().waitFor();
  await shot(page, '18-gallery-landscape');
  await page.goto(`${base}#/play/${saveId}`);
  await page.locator('.panel-btn').first().waitFor();
  await shot(page, '19-overview-landscape');

  // Upload flow in all aspects.
  await page.goto(`${base}#/new`);
  await page.locator('#upload-input').setInputFiles('images/cheshire-cat.jpg');
  await page.waitForURL(/#\/setup/);
  await page.locator('.preview-box canvas').waitFor();
  await shot(page, '20-setup-landscape-upload');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('radio', { name: 'Square' }).click();
  await page.getByText(/9 panels/).waitFor();
  await page.getByRole('radio', { name: 'Free colors' }).click();
  await page.getByText(/9 panels/).waitFor();
  await page.getByRole('radio', { name: 'Portrait' }).click();
  await page.getByText(/12 panels/).waitFor();
  await shot(page, '21-setup-upload-portrait-free');
  await page.getByRole('radio', { name: 'Square' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForURL(/#\/play\/[^/]+$/);
  await page.locator('.panel-btn').first().waitFor();
  const panels = await page.locator('.panel-btn').count();
  console.log('upload square panels:', panels);
  if (panels !== 9) throw new Error('expected 9 panels');
  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await page.locator('.save-card').nth(1).waitFor();
  const cards = await page.locator('.save-card').count();
  await page
    .locator('.save-card')
    .first()
    .getByRole('button', { name: /^Restart/ })
    .click();
  await shot(page, '22-confirm-restart');
  await page.getByRole('dialog').getByRole('button', { name: 'Restart' }).click();
  await page
    .locator('.save-card')
    .first()
    .getByRole('button', { name: /^Delete/ })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('.save-card').length === n - 1,
    cards,
  );
  console.log('cards before/after delete:', cards, cards - 1);
  // Setup without a source redirects.
  await page.goto(`${base}#/setup`);
  await page.reload();
  await page.waitForURL(/#\/new/);
  console.log('setup without source redirected to #/new');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  console.log('horizontal overflow:', overflow);
  console.log('errors:', errors.length ? errors : 'none');
  // Offline: allow the service worker, let it precache, then play offline.
  const swCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const sw = await swCtx.newPage();
  sw.on('pageerror', (e) => errors.push(`offline: ${String(e)}`));
  await sw.goto(base);
  await sw.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await sw.reload();
  await sw.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await swCtx.setOffline(true);
  await sw.reload();
  await sw.getByRole('button', { name: 'New Picture' }).click();
  await sw.getByRole('button', { name: 'Lighthouse' }).click();
  await sw.locator('.preview-box canvas').waitFor({ timeout: 10000 });
  await sw.screenshot({ path: `${out}/23-offline-setup.png` });
  console.log('offline: setup preview rendered');
  await swCtx.close();

  await browser.close();
  if (errors.length) process.exitCode = 1;
}

await main();
