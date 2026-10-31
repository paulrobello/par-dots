/**
 * Gallery screen (`#/`): the New Picture button, Back up all and Restore (`.pardots` files),
 * and per-save cards split by origin — photo saves show progress and time; drawn saves show
 * a dot count and Continue, Download PNG, Back up, Restart and Delete.
 */

import { overallProgress, pictureComplete, placedCount } from '../game';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import type { PictureSave } from '../types';
import { asThumb, confirmDialog, downloadBlob, h, icon, toast } from './dom';
import { exportPng } from './exportImage';
import { formatDuration, formatPercent, routeHash, safeFileStem, userMessage } from './pure';
import {
  backupSaves,
  listSaves,
  MAX_BACKUP_FILE_BYTES,
  removeSave,
  restartDrawnSave,
  restartSave,
  restoreBackup,
} from './saves';
import type { Cleanup, ScreenContext } from './screen';
import { settingsButton } from './settingsSheet';
import { addGalleryXrButton } from './xrGallery';

function totalMs(save: PictureSave): number {
  return save.panelElapsedMs.reduce((a, b) => a + b, 0);
}

/** Local calendar date as YYYY-MM-DD. */
function isoDate(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Download saves as a `.pardots` backup file. */
async function downloadBackup(saves: PictureSave[], filename: string): Promise<void> {
  try {
    downloadBlob(await backupSaves(saves), filename);
  } catch (err) {
    console.error(err);
    toast(`Could not back up: ${userMessage(err)}`, 3000);
  }
}

/**
 * Mounts the gallery screen (route `#/`) into ctx.root. The returned Cleanup marks the screen
 * dead so a save list still loading is not rendered; the router removes the DOM.
 */
export function mountGallery({ root, navigate }: ScreenContext): Cleanup {
  let alive = true;
  const list = h('div', { class: 'save-grid', 'aria-live': 'polite' });
  const newBtn = h(
    'button',
    { type: 'button', class: 'btn primary big', on: { click: () => navigate('#/new') } },
    icon('plus'),
    'New Picture',
  );
  const restoreInput = h('input', {
    type: 'file',
    accept: '.pardots,application/json',
    class: 'visually-hidden',
    id: 'restore-input',
    'aria-label': 'Restore from a backup file',
  });
  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files?.[0];
    restoreInput.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      toast('That backup is larger than 200 MB.', 3500);
      return;
    }
    try {
      const n = await restoreBackup(await file.text());
      toast(`Restored ${n} picture${n === 1 ? '' : 's'}`, 2500);
    } catch (err) {
      console.error(err);
      toast(`Could not restore: ${userMessage(err)}`, 3500);
    }
    if (alive) void render();
  });
  const backupAll = async (): Promise<void> => {
    let saves: PictureSave[];
    try {
      saves = await listSaves();
    } catch (err) {
      toast(`Could not back up: ${userMessage(err)}`, 3000);
      return;
    }
    if (saves.length === 0) {
      toast('No pictures to back up yet.');
      return;
    }
    await downloadBackup(saves, `par-dots-backup-${isoDate()}.pardots`);
  };
  root.append(
    h(
      'div',
      { class: 'screen gallery' },
      h(
        'header',
        { class: 'hero' },
        h('div', { class: 'hero-settings' }, settingsButton()),
        h('div', { class: 'logo', 'aria-hidden': 'true' }, dotLogo()),
        h('h1', {}, 'par-dots'),
        h('p', { class: 'tagline' }, 'Rebuild any picture, one dot at a time.'),
      ),
      h('div', { class: 'gallery-actions' }, newBtn),
      (() => {
        const xrRow = h('div', { class: 'backup-actions' });
        addGalleryXrButton(xrRow);
        return xrRow;
      })(),
      h('h2', { class: 'section-title' }, 'Your pictures'),
      h(
        'div',
        { class: 'backup-actions' },
        h(
          'button',
          { type: 'button', class: 'chip', on: { click: () => void backupAll() } },
          icon('download'),
          'Back up all',
        ),
        h(
          'button',
          { type: 'button', class: 'chip', on: { click: () => restoreInput.click() } },
          icon('upload'),
          'Restore',
        ),
        restoreInput,
      ),
      list,
    ),
  );

  const render = async (): Promise<void> => {
    let saves: PictureSave[];
    try {
      saves = await listSaves();
    } catch (err) {
      list.replaceChildren(h('p', { class: 'empty' }, `Could not load saves: ${userMessage(err)}`));
      return;
    }
    if (!alive) return;
    const photos = saves.filter((s) => s.origin !== 'drawn');
    const drawn = saves.filter((s) => s.origin === 'drawn');
    if (saves.length === 0) {
      list.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-dots', 'aria-hidden': 'true' }, dotLogo()),
          h('p', {}, 'No pictures yet.'),
          h('p', { class: 'muted' }, 'Tap New Picture to pick a photo and start building.'),
        ),
      );
      return;
    }
    list.replaceChildren(
      h('div', { class: 'save-grid-inner' }, ...photos.map((s) => saveCard(s))),
      ...(photos.length === 0 ? [h('p', { class: 'muted' }, 'No pictures yet.')] : []),
      h('h2', { class: 'section-title' }, 'My drawings'),
      ...(drawn.length === 0
        ? [h('p', { class: 'muted' }, 'No drawings yet. Tap Make my own to start one.')]
        : [h('div', { class: 'save-grid-inner' }, ...drawn.map((s) => saveCard(s)))]),
    );
  };

  /** Ask for confirmation, run the action, surface failures, then refresh the gallery. */
  const confirmAction = async (
    title: string,
    body: string,
    confirmLabel: string,
    action: () => Promise<void>,
    failure: string,
  ): Promise<void> => {
    const ok = await confirmDialog(title, body, confirmLabel);
    if (!ok) return;
    try {
      await action();
    } catch (err) {
      console.error(err);
      toast(`${failure}: ${userMessage(err)}`);
    }
    void render();
  };

  /**
   * One card builder for both origins: drawn saves show a dot count and always offer
   * Download PNG; photo saves show progress, a done badge, and Download only when complete.
   */
  const saveCard = (save: PictureSave): HTMLElement => {
    const drawn = save.origin === 'drawn';
    const done = !drawn && pictureComplete(save);
    const cellPx = Math.max(2, Math.round(192 / Math.max(save.width, save.height)));
    const thumb = asThumb(
      renderMosaicToCanvas(save, cellPx * (window.devicePixelRatio > 1 ? 2 : 1), 'dots', {
        cells: save.placed,
      }),
      `${save.name} preview`,
    );
    const openHash = drawn
      ? routeHash({ name: 'drawEditor', id: save.id })
      : routeHash({ name: 'overview', id: save.id });
    const open = (): void => navigate(openHash);
    const restart = (): Promise<void> =>
      confirmAction(
        drawn ? 'Restart drawing?' : 'Restart picture?',
        drawn
          ? `Everything drawn in "${save.name}" will be removed.`
          : `All placed dots in "${save.name}" will be removed and the timer reset.`,
        'Restart',
        () => (drawn ? restartDrawnSave(save) : restartSave(save)),
        'Could not restart',
      );
    const del = (): Promise<void> =>
      confirmAction(
        drawn ? 'Delete drawing?' : 'Delete picture?',
        drawn
          ? `"${save.name}" will be deleted. This cannot be undone.`
          : `"${save.name}" and its progress will be deleted. This cannot be undone.`,
        'Delete',
        () => removeSave(save.id),
        'Could not delete',
      );
    const meta = h('div', { class: 'save-meta' }, h('h3', {}, save.name));
    if (drawn) {
      meta.append(h('p', { class: 'muted small' }, `${placedCount(save)} dots`));
    } else {
      const prog = overallProgress(save);
      meta.append(
        h(
          'div',
          {
            class: 'progress-bar',
            role: 'progressbar',
            'aria-valuenow': prog.percent,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          },
          h('span', { style: `width:${prog.percent}%` }),
        ),
        h(
          'p',
          { class: 'muted small' },
          `${done ? 'Complete' : formatPercent(prog.percent)} · ${formatDuration(totalMs(save))}`,
        ),
      );
    }
    return h(
      'article',
      { class: 'save-card' },
      h(
        'button',
        {
          type: 'button',
          class: 'save-thumb',
          'aria-label': `Continue ${save.name}`,
          on: { click: open },
        },
        thumb,
        done ? h('span', { class: 'done-badge' }, icon('check')) : null,
      ),
      meta,
      h(
        'div',
        { class: 'save-actions' },
        h(
          'button',
          { type: 'button', class: 'btn primary', on: { click: open } },
          icon('play'),
          done ? 'View' : 'Continue',
        ),
        drawn || done
          ? h(
              'button',
              {
                type: 'button',
                class: 'icon-btn',
                'aria-label': `Download ${save.name} as PNG`,
                'data-tip': 'Download PNG',
                on: { click: () => exportPng(save) },
              },
              icon('download'),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Back up ${save.name}`,
            'data-tip': 'Back up',
            on: {
              click: () => void downloadBackup([save], `${safeFileStem(save.name)}.pardots`),
            },
          },
          icon('backup'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Restart ${save.name}`,
            'data-tip': 'Restart',
            on: { click: () => void restart() },
          },
          icon('restart'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Delete ${save.name}`,
            'data-tip': 'Delete',
            on: { click: () => void del() },
          },
          icon('trash'),
        ),
      ),
    );
  };

  void render();
  return () => {
    alive = false;
  };
}

/** Decorative cluster of glossy dots built from CSS. */
export function dotLogo(): HTMLElement {
  const colors = ['#c91a09', '#f2cd37', '#0055bf', '#4b9f4a', '#fe8a18', '#ffffff'];
  return h(
    'span',
    { class: 'dot-cluster' },
    ...colors.map((c) => h('span', { class: 'css-dot', style: `--c:${c}` })),
  );
}
