import { overallProgress, pictureComplete } from '../game';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { deleteSave, listSaves } from '../storage/db';
import { EMPTY, type PictureSave } from '../types';
import { asThumb, confirmDialog, h, icon, toast } from './dom';
import { formatDuration, routeHash } from './pure';
import type { Cleanup, ScreenContext } from './screen';
import { forgetSave, persist } from './state';

function totalMs(save: PictureSave): number {
  return save.panelElapsedMs.reduce((a, b) => a + b, 0);
}

export function mountGallery({ root, navigate }: ScreenContext): Cleanup {
  let alive = true;
  const list = h('div', { class: 'save-grid', 'aria-live': 'polite' });
  const newBtn = h(
    'button',
    { type: 'button', class: 'btn primary big', on: { click: () => navigate('#/new') } },
    icon('plus'),
    'New Picture',
  );
  root.append(
    h(
      'div',
      { class: 'screen gallery' },
      h(
        'header',
        { class: 'hero' },
        h('div', { class: 'logo', 'aria-hidden': 'true' }, dotLogo()),
        h('h1', {}, 'par-dots'),
        h('p', { class: 'tagline' }, 'Rebuild any picture, one dot at a time.'),
      ),
      h('div', { class: 'gallery-actions' }, newBtn),
      h('h2', { class: 'section-title' }, 'Your pictures'),
      list,
    ),
  );

  const render = async (): Promise<void> => {
    let saves: PictureSave[];
    try {
      saves = await listSaves();
    } catch (err) {
      list.replaceChildren(h('p', { class: 'empty' }, `Could not load saves: ${String(err)}`));
      return;
    }
    if (!alive) return;
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
    list.replaceChildren(...saves.map((s) => card(s)));
  };

  const card = (save: PictureSave): HTMLElement => {
    const prog = overallProgress(save);
    const done = pictureComplete(save);
    const cellPx = Math.max(2, Math.round(192 / Math.max(save.width, save.height)));
    const thumb = asThumb(
      renderMosaicToCanvas(save, cellPx * (window.devicePixelRatio > 1 ? 2 : 1), 'dots', {
        cells: save.placed,
      }),
      `${save.name} preview`,
    );
    const open = (): void => navigate(routeHash({ name: 'overview', id: save.id }));
    const restart = async (): Promise<void> => {
      const ok = await confirmDialog(
        'Restart picture?',
        `All placed dots in "${save.name}" will be removed and the timer reset.`,
        'Restart',
      );
      if (!ok) return;
      save.placed.fill(EMPTY);
      save.panelElapsedMs = save.panelElapsedMs.map(() => 0);
      delete save.completedAt;
      try {
        await persist(save);
      } catch (err) {
        toast(String(err));
      }
      void render();
    };
    const del = async (): Promise<void> => {
      const ok = await confirmDialog(
        'Delete picture?',
        `"${save.name}" and its progress will be deleted. This cannot be undone.`,
        'Delete',
      );
      if (!ok) return;
      try {
        await deleteSave(save.id);
        forgetSave(save.id);
      } catch (err) {
        toast(String(err));
      }
      void render();
    };
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
      h(
        'div',
        { class: 'save-meta' },
        h('h3', {}, save.name),
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
          `${done ? 'Complete' : `${Math.floor(prog.percent)}%`} · ${formatDuration(totalMs(save))}`,
        ),
      ),
      h(
        'div',
        { class: 'save-actions' },
        h(
          'button',
          { type: 'button', class: 'btn primary', on: { click: open } },
          icon('play'),
          done ? 'View' : 'Continue',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Restart ${save.name}`,
            title: 'Restart',
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
            title: 'Delete',
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
