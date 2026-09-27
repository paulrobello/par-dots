/**
 * Scripted versions of the audit-remediation manual checks (QA-001, QA-011, QA-022, ARC-003,
 * ARC-005) against a running preview. Run: bun run scripts/e2e-manual-checks.ts [baseUrl].
 */
import { chromium, type Page } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4231/';

async function startLighthouse(page: Page): Promise<string> {
  await page.goto(`${base}#/new`);
  await page.getByRole('button', { name: 'Lighthouse' }).click();
  await page.locator('.preview-box canvas').waitFor();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForURL(/#\/play\/[^/]+$/);
  await page.locator('.panel-btn').first().waitFor();
  return page.url().split('/play/')[1] ?? '';
}

function countPlaced(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('par-dots');
        req.onsuccess = () => {
          const all = req.result.transaction('saves').objectStore('saves').getAll();
          all.onsuccess = () =>
            resolve((all.result[0].placed as Uint8Array).filter((v) => v !== 255).length);
        };
      }),
  );
}

function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const id = await startLighthouse(page);

  // ARC-003: gallery Restart empties the board.
  await page.goto(`${base}#/play/${id}/0`);
  await page.locator('.tray-dot').first().waitFor();
  const box = await page.locator('.board-canvas').boundingBox();
  if (!box) throw new Error('no board');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Back to overview' }).click();
  await page.goto(`${base}#/`);
  await page.locator('.save-card').first().waitFor();
  const placedBefore = await countPlaced(page);
  await page
    .locator('.save-card')
    .first()
    .getByRole('button', { name: /^Restart/ })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restart' }).click();
  await page.waitForTimeout(300);
  const placedAfter = await countPlaced(page);
  await page.goto(`${base}#/play/${id}/0`);
  await page.locator('.tray-dot').first().waitFor();
  const pct = await page.locator('.topbar .pill').first().textContent();
  check(
    placedBefore > 0 && placedAfter === 0 && pct === '0%',
    `ARC-003 Restart empties the board (placed ${placedBefore} -> ${placedAfter}, pill=${pct})`,
  );

  // QA-022: Escape with Settings open closes only the sheet; a second Escape goes back.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const afterFirst = page.url();
  const dialogs = await page.getByRole('dialog').count();
  await page.keyboard.press('Escape');
  await page.waitForURL(/#\/play\/[^/]+$/);
  check(
    /\/0$/.test(afterFirst) && dialogs === 0,
    'QA-022 Escape closes the sheet first, then goes back',
  );

  // ARC-005: Settings open in play, browser Back, then Escape on the overview.
  await page.goto(`${base}#/play/${id}/0`);
  await page.locator('.tray-dot').first().waitFor();
  const errBefore = errors.length;
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').waitFor();
  await page.goBack();
  await page.waitForURL(/#\/play\/[^/]+$/);
  await page.locator('.panel-btn').first().waitFor();
  const urlBeforeEsc = page.url();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(
    errors.length === errBefore &&
      page.url() === urlBeforeEsc &&
      (await page.getByRole('dialog').count()) === 0,
    'ARC-005 Settings -> Back -> Escape: no errors, no navigation',
  );

  // QA-011: tap a panel, then Back within 320 ms stays on the gallery.
  await page.goto(`${base}#/`);
  await page.locator('.save-card').first().waitFor();
  await page.locator('.save-card button.btn.primary').first().click();
  await page.locator('.panel-btn').first().waitFor();
  await page.getByRole('button', { name: 'Open panel 1 of 12' }).click();
  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await page.waitForTimeout(800);
  check(/#\/$/.test(page.url()), `QA-011 Back within 320 ms stays on gallery (${page.url()})`);

  // QA-001: IndexedDB failure toasts and returns to the gallery.
  const broken = await context.newPage();
  await broken.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    (indexedDB as unknown as { open: unknown }).open = (name: string, v?: number) => {
      const req = open(name, v);
      req.addEventListener('success', () => {
        const db = req.result;
        db.transaction = () => {
          throw new DOMException('simulated failure', 'UnknownError');
        };
      });
      return req;
    };
  });
  await broken.goto(`${base}#/play/${id}`);
  const toast = broken.locator('.toast');
  await toast.first().waitFor({ timeout: 5000 });
  const toastText = await toast.first().textContent();
  await broken.waitForURL(/#\/$/, { timeout: 5000 });
  check(true, `QA-001 failure toasts ("${toastText}") and returns to gallery`);

  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
}

await main();
