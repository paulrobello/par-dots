/**
 * Parts sheet: how many dots of each color the picture, or one panel, needs, with how many
 * are already placed correctly and a tab-separated copy of the list.
 */

import { colorCounts, panelColorCounts, panelCount, panelOrigin } from '../game';
import { PANEL_SIZE, type PictureSave } from '../types';
import { h, openSheet, toast } from './dom';
import { paletteLabels } from './pure';

/** Correctly placed dots per palette index, over the whole picture or one panel. */
function doneCounts(save: PictureSave, panelIndex: number | null): number[] {
  const done = new Array<number>(save.palette.length).fill(0);
  const count = (i: number): void => {
    const t = save.target[i];
    if (save.placed[i] === t) done[t]++;
  };
  if (panelIndex === null) {
    for (let i = 0; i < save.width * save.height; i++) count(i);
    return done;
  }
  const o = panelOrigin(save, panelIndex);
  for (let y = 0; y < PANEL_SIZE; y++) {
    for (let x = 0; x < PANEL_SIZE; x++) count((o.y + y) * save.width + o.x + x);
  }
  return done;
}

/** Open the Parts sheet for a picture. */
export function openPartsSheet(save: PictureSave): void {
  const labels = paletteLabels(save.palette);
  const scope = h(
    'select',
    { class: 'parts-scope', 'aria-label': 'Count dots for' },
    h('option', { value: '' }, 'Whole picture'),
    ...Array.from({ length: panelCount(save) }, (_, i) =>
      h('option', { value: String(i) }, `Panel ${i + 1}`),
    ),
  );
  const tbody = h('tbody', {});
  const totalEl = h('strong', { class: 'parts-total' }, '');
  const colorsEl = h('strong', { class: 'parts-colors' }, '');
  let rows: Array<{ label: string; count: number }> = [];

  const render = (): void => {
    const panel = scope.value === '' ? null : Number(scope.value);
    const counts = panel === null ? colorCounts(save) : panelColorCounts(save, panel);
    const done = doneCounts(save, panel);
    const order = counts
      .map((count, c) => ({ c, count }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || a.c - b.c);
    rows = order.map(({ c, count }) => ({ label: labels[c], count }));
    tbody.replaceChildren(
      ...order.map(({ c, count }) =>
        h(
          'tr',
          {},
          h('td', {}, h('span', { class: 'css-dot', style: `--c:${save.palette[c].hex}` })),
          h('td', { class: 'parts-label' }, labels[c]),
          h('td', { class: 'parts-count' }, String(count)),
          h('td', { class: 'parts-done muted' }, `${done[c]} done`),
        ),
      ),
    );
    totalEl.textContent = String(counts.reduce((a, b) => a + b, 0));
    colorsEl.textContent = String(order.length);
  };
  scope.addEventListener('change', render);

  const copyBtn = h('button', { type: 'button', class: 'btn ghost' }, 'Copy list');
  copyBtn.addEventListener('click', () => {
    const text = rows.map((r) => `${r.label}\t${r.count}`).join('\n');
    if (!navigator.clipboard) {
      toast('Copy not available');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => toast('List copied'),
      () => toast('Copy not available'),
    );
  });

  render();
  openSheet(
    'Parts',
    h(
      'div',
      { class: 'parts' },
      scope,
      h(
        'table',
        { class: 'parts-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Color')),
            h('th', { scope: 'col' }, 'Name'),
            h('th', { scope: 'col', class: 'parts-count' }, 'Dots'),
            h('th', { scope: 'col', class: 'parts-done' }, 'Placed'),
          ),
        ),
        tbody,
      ),
      h('p', { class: 'parts-foot' }, totalEl, ' dots · ', colorsEl, ' colors'),
      copyBtn,
    ),
  );
}
