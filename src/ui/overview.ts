/**
 * Overview screen (`#/play/:id`): the whole picture with panel badges, Ghost toggle and
 * stats. Tapping a panel zooms into it; returning from a panel zooms out, and the last
 * panel of a picture triggers the finale with PNG download.
 */

import { haptic, play } from '../audio/sfx';
import { overallProgress, panelCount, pictureComplete } from '../game';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { prefersReducedMotion } from '../render/motion';
import { OverviewRenderer } from '../render/overviewRenderer';
import type { PictureSave } from '../types';
import { celebrate } from './celebrate';
import { h, icon, iconButton, openSheet, toast } from './dom';
import { exportPng } from './exportImage';
import { openPartsSheet } from './partsSheet';
import { formatDuration, formatPercent, panelZoomTransform, routeHash, userMessage } from './pure';
import { loadSave } from './saves';
import type { Cleanup, ScreenContext } from './screen';
import { takeTransitionHint } from './state';

const ZOOM_MS = 320;
const ZOOM_TRANSITION = `transform ${ZOOM_MS}ms cubic-bezier(.3,.7,.2,1), opacity ${ZOOM_MS}ms`;

/**
 * Mounts the overview (route `#/play/:id`) for save `id`. The returned Cleanup cancels a
 * pending zoom-in navigation, disconnects the ResizeObserver, and ignores a save still loading.
 */
export function mountOverview({ root, navigate }: ScreenContext, id: string): Cleanup {
  let alive = true;
  let renderer: OverviewRenderer | null = null;
  let ro: ResizeObserver | null = null;
  let leaving = false;
  let zoomTimer: ReturnType<typeof setTimeout> | null = null;
  const hint = takeTransitionHint();

  const canvas = h('canvas', {
    class: 'overview-canvas',
    role: 'img',
    'aria-label': 'Picture overview',
  });
  const hoverBox = h('div', { class: 'panel-hover', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'overview-stage' }, canvas, hoverBox);
  const title = h('h1', { class: 'title' }, '');
  const stats = h('div', { class: 'stats', 'aria-live': 'polite' });
  const ghostBtn = h(
    'button',
    { type: 'button', class: 'chip', 'aria-pressed': 'false' },
    icon('eye'),
    'Ghost',
  );
  const partsBtn = h('button', { type: 'button', class: 'chip' }, icon('list'), 'Parts');
  const exportBtn = h(
    'button',
    { type: 'button', class: 'btn primary', hidden: true },
    icon('download'),
    'Download PNG',
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
        partsBtn,
        exportBtn,
      ),
    ),
  );

  const openPanel = (save: PictureSave, index: number): void => {
    if (leaving || !renderer) return;
    leaving = true;
    const go = (): void => {
      if (!alive) return;
      navigate(routeHash({ name: 'panel', id: save.id, panel: index }));
    };
    const rect = renderer.panelRect(index);
    if (!rect || prefersReducedMotion()) {
      go();
      return;
    }
    const { s, tx, ty } = panelZoomTransform(rect, stage.clientWidth, stage.clientHeight);
    canvas.style.transformOrigin = '0 0';
    canvas.style.transition = ZOOM_TRANSITION;
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    canvas.style.opacity = '0.4';
    zoomTimer = setTimeout(go, ZOOM_MS);
  };

  const zoomOutFrom = (index: number): void => {
    if (!renderer || prefersReducedMotion()) return;
    const rect = renderer.panelRect(index);
    if (!rect) return;
    const { s, tx, ty } = panelZoomTransform(rect, stage.clientWidth, stage.clientHeight);
    canvas.style.transformOrigin = '0 0';
    canvas.style.transition = 'none';
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    canvas.style.opacity = '0.4';
    void canvas.offsetWidth;
    canvas.style.transition = ZOOM_TRANSITION;
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
      'Download PNG',
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

  void loadSave(id)
    .then((save) => {
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
        h('span', { class: 'stat' }, h('strong', {}, formatPercent(prog.percent)), ' done'),
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

      partsBtn.addEventListener('click', () => openPartsSheet(save));

      canvas.addEventListener('click', (e) => {
        const p = renderer?.hitTestPanel(e.clientX, e.clientY);
        if (p !== null && p !== undefined) openPanel(save, p);
      });

      // Hover highlight: a box over the hovered panel, mirrored on its number button.
      let hovered: number | null = null;
      const setHover = (index: number | null): void => {
        if (index === hovered) return;
        hovered = index;
        const rect = index === null ? null : (renderer?.panelRect(index) ?? null);
        hoverBox.classList.toggle('on', rect !== null);
        if (rect) {
          hoverBox.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
          hoverBox.style.width = `${rect.w}px`;
          hoverBox.style.height = `${rect.h}px`;
        }
        panelList.querySelectorAll('.panel-btn').forEach((b, i) => {
          b.classList.toggle('hover', i === index);
        });
      };
      canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        setHover(renderer?.hitTestPanel(e.clientX, e.clientY) ?? null);
      });
      canvas.addEventListener('pointerleave', () => setHover(null));

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
              on: {
                click: () => openPanel(save, i),
                pointerenter: () => setHover(i),
                pointerleave: () => setHover(null),
                focus: () => setHover(i),
                blur: () => setHover(null),
              },
            },
            String(i + 1),
          ),
        );
      }

      if (hint.fromPanel !== undefined) zoomOutFrom(hint.fromPanel);
      if (hint.justCompleted && complete) void showFinale(save);
    })
    .catch((err: unknown) => {
      console.error(err);
      if (!alive) return;
      toast(`Could not open picture: ${userMessage(err)}`, 4000);
      navigate('#/', { replace: true });
    });

  return () => {
    alive = false;
    if (zoomTimer) clearTimeout(zoomTimer);
    ro?.disconnect();
  };
}
