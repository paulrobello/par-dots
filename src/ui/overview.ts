import { haptic, play } from '../audio/sfx';
import { overallProgress, panelCount, pictureComplete } from '../game';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { prefersReducedMotion } from '../render/motion';
import { OverviewRenderer } from '../render/overviewRenderer';
import type { PictureSave } from '../types';
import { celebrate } from './celebrate';
import { downloadBlob, h, icon, iconButton, openSheet, toast } from './dom';
import { formatDuration, routeHash } from './pure';
import type { Cleanup, ScreenContext } from './screen';
import { loadSave, takeTransitionHint } from './state';

const ZOOM_MS = 320;

export function mountOverview({ root, navigate }: ScreenContext, id: string): Cleanup {
  let alive = true;
  let renderer: OverviewRenderer | null = null;
  let ro: ResizeObserver | null = null;
  let leaving = false;
  const hint = takeTransitionHint();

  const canvas = h('canvas', {
    class: 'overview-canvas',
    role: 'img',
    'aria-label': 'Picture overview',
  });
  const stage = h('div', { class: 'overview-stage' }, canvas);
  const title = h('h1', { class: 'title' }, '');
  const stats = h('div', { class: 'stats', 'aria-live': 'polite' });
  const ghostBtn = h(
    'button',
    { type: 'button', class: 'chip', 'aria-pressed': 'false' },
    icon('eye'),
    'Ghost',
  );
  const exportBtn = h(
    'button',
    { type: 'button', class: 'btn primary', hidden: true },
    icon('download'),
    'Export PNG',
  );
  const panelList = h('div', { class: 'visually-hidden' });

  root.append(
    h(
      'div',
      { class: 'screen overview' },
      h(
        'header',
        { class: 'topbar' },
        iconButton('back', 'Back to gallery', () => navigate('#/')),
        title,
        h('span', { class: 'spacer' }),
      ),
      stats,
      stage,
      panelList,
      h(
        'div',
        { class: 'overview-foot' },
        h('p', { class: 'muted small' }, 'Tap a panel to build it'),
        ghostBtn,
        exportBtn,
      ),
    ),
  );

  const exportPng = (save: PictureSave): void => {
    const canvasOut = renderMosaicToCanvas(save, 24, 'dots', { cells: save.placed });
    canvasOut.toBlob((blob) => {
      if (!blob) {
        toast('Export failed');
        return;
      }
      const safe = save.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'mosaic';
      downloadBlob(blob, `${safe}-dots.png`);
    }, 'image/png');
  };

  const openPanel = (save: PictureSave, index: number): void => {
    if (leaving || !renderer) return;
    leaving = true;
    const go = (): void => navigate(routeHash({ name: 'panel', id: save.id, panel: index }));
    const rect = renderer.panelRect(index);
    if (!rect || prefersReducedMotion()) {
      go();
      return;
    }
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const s = Math.min(sw / rect.w, sh / rect.h) * 0.92;
    const tx = sw / 2 - (rect.x + rect.w / 2) * s;
    const ty = sh / 2 - (rect.y + rect.h / 2) * s;
    canvas.style.transformOrigin = '0 0';
    canvas.style.transition = `transform ${ZOOM_MS}ms cubic-bezier(.3,.7,.2,1), opacity ${ZOOM_MS}ms`;
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    canvas.style.opacity = '0.4';
    setTimeout(go, ZOOM_MS);
  };

  const zoomOutFrom = (index: number): void => {
    if (!renderer || prefersReducedMotion()) return;
    const rect = renderer.panelRect(index);
    if (!rect) return;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const s = Math.min(sw / rect.w, sh / rect.h) * 0.92;
    const tx = sw / 2 - (rect.x + rect.w / 2) * s;
    const ty = sh / 2 - (rect.y + rect.h / 2) * s;
    canvas.style.transformOrigin = '0 0';
    canvas.style.transition = 'none';
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    canvas.style.opacity = '0.4';
    void canvas.offsetWidth;
    canvas.style.transition = `transform ${ZOOM_MS}ms cubic-bezier(.3,.7,.2,1), opacity ${ZOOM_MS}ms`;
    canvas.style.transform = '';
    canvas.style.opacity = '1';
  };

  const showFinale = async (save: PictureSave): Promise<void> => {
    play('pictureComplete');
    haptic('pictureComplete');
    await celebrate(save.palette, 'Picture complete!', 2200);
    if (!alive) return;
    const total = save.panelElapsedMs.reduce((a, b) => a + b, 0);
    const preview = renderMosaicToCanvas(save, 8, 'dots', { cells: save.placed });
    preview.classList.add('finale-img');
    const dl = h(
      'button',
      { type: 'button', class: 'btn primary big' },
      icon('download'),
      'Export PNG',
    );
    dl.addEventListener('click', () => exportPng(save));
    openSheet(
      'Picture complete',
      h(
        'div',
        { class: 'finale' },
        preview,
        h(
          'p',
          { class: 'finale-stats' },
          `${panelCount(save)} panels · ${save.width * save.height} dots · ${formatDuration(total)}`,
        ),
        dl,
      ),
    );
  };

  void loadSave(id).then((save) => {
    if (!alive) return;
    if (!save) {
      toast('Picture not found');
      navigate('#/', { replace: true });
      return;
    }
    title.textContent = save.name;
    const prog = overallProgress(save);
    const total = save.panelElapsedMs.reduce((a, b) => a + b, 0);
    const complete = pictureComplete(save);
    stats.replaceChildren(
      h('span', { class: 'stat' }, h('strong', {}, `${Math.floor(prog.percent)}%`), ' done'),
      h('span', { class: 'stat' }, h('strong', {}, formatDuration(total)), ' time'),
      h('span', { class: 'stat' }, h('strong', {}, String(panelCount(save))), ' panels'),
    );
    exportBtn.hidden = !complete;
    exportBtn.addEventListener('click', () => exportPng(save));

    renderer = new OverviewRenderer(canvas);
    renderer.setData(save, save.placed);
    renderer.resize();
    ro = new ResizeObserver(() => renderer?.resize());
    ro.observe(stage);

    ghostBtn.addEventListener('click', () => {
      if (!renderer) return;
      const on = !renderer.ghostEnabled;
      renderer.setGhost(on);
      renderer.draw();
      ghostBtn.setAttribute('aria-pressed', String(on));
      ghostBtn.classList.toggle('on', on);
    });

    canvas.addEventListener('click', (e) => {
      const p = renderer?.hitTestPanel(e.clientX, e.clientY);
      if (p !== null && p !== undefined) openPanel(save, p);
    });

    // Keyboard / screen reader access to panels.
    panelList.classList.remove('visually-hidden');
    panelList.className = 'panel-buttons';
    for (let i = 0; i < panelCount(save); i++) {
      panelList.append(
        h(
          'button',
          {
            type: 'button',
            class: 'panel-btn',
            'aria-label': `Open panel ${i + 1} of ${panelCount(save)}`,
            on: { click: () => openPanel(save, i) },
          },
          String(i + 1),
        ),
      );
    }

    if (hint.fromPanel !== undefined) zoomOutFrom(hint.fromPanel);
    if (hint.justCompleted && complete) void showFinale(save);
  });

  return () => {
    alive = false;
    ro?.disconnect();
  };
}
