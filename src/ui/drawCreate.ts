/**
 * Draw-create screen (`#/draw/new`): name, aspect, palette mode and background for a new
 * drawing, then creates the drawn save and opens the editor. No source image involved.
 */

import { panelGridOf } from '../game';
import { getSettings, setSettings } from '../storage/settings';
import {
  type Aspect,
  PANEL_GRID_MAX,
  PANEL_GRID_MIN,
  PANEL_SIZE,
  type PaletteMode,
  SIZE_OPTIONS,
} from '../types';
import { h, icon, iconButton, toast } from './dom';
import { buildDrawnSave, routeHash, userMessage } from './pure';
import { createSave } from './saves';
import type { Cleanup, ScreenContext } from './screen';
import { settingsButton } from './settingsSheet';

const ASPECTS: Array<{ value: Aspect; label: string }> = [
  { value: '1:1', label: 'Square' },
  { value: '3:4', label: 'Portrait' },
  { value: '4:3', label: 'Landscape' },
];

/** Mounts the draw-create screen (route `#/draw/new`). */
export function mountDrawCreate({ root, navigate }: ScreenContext): Cleanup {
  let aspect: Aspect = '1:1';
  let scale = 1;
  let custom: { cols: number; rows: number } | null = null;
  let mode: PaletteMode = getSettings().paletteMode;
  let background: string | null = null;
  let creating = false;
  let alive = true;

  const nameInput = h('input', {
    type: 'text',
    class: 'name-input',
    value: 'My drawing',
    maxlength: '60',
    'aria-label': 'Drawing name',
    autocomplete: 'off',
  });

  const segmented = <T extends string>(
    label: string,
    options: Array<{ value: T; label: string }>,
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement => {
    const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
    const buttons = options.map((o) => {
      const b = h('button', { type: 'button', role: 'radio', 'data-value': o.value }, o.label);
      b.addEventListener('click', () => {
        set(o.value);
        sync();
      });
      return b;
    });
    const sync = (): void => {
      for (const b of buttons) {
        const on = b.dataset.value === get();
        b.setAttribute('aria-checked', String(on));
        b.classList.toggle('on', on);
      }
    };
    sync();
    group.append(...buttons);
    return group;
  };

  const aspectCtl = segmented(
    'Aspect',
    ASPECTS,
    () => aspect,
    (v) => {
      aspect = v;
      syncSizeHint();
    },
  );
  const sizeHint = h('p', { class: 'muted small' }, '');
  const activeGrid = (): { cols: number; rows: number } => custom ?? panelGridOf(aspect, scale);
  const syncSizeHint = (): void => {
    const g = activeGrid();
    sizeHint.textContent = `${g.cols * g.rows} panels · ${g.cols * PANEL_SIZE}×${g.rows * PANEL_SIZE} studs`;
  };
  const clampPanel = (v: string): number =>
    Math.max(PANEL_GRID_MIN, Math.min(PANEL_GRID_MAX, Math.round(Number(v) || 1)));
  const colInput = h('input', {
    type: 'number',
    min: String(PANEL_GRID_MIN),
    max: String(PANEL_GRID_MAX),
    step: '1',
    value: '4',
    'aria-label': 'Columns',
  });
  const rowInput = h('input', {
    type: 'number',
    min: String(PANEL_GRID_MIN),
    max: String(PANEL_GRID_MAX),
    step: '1',
    value: '4',
    'aria-label': 'Rows',
  });
  const customCtl = h(
    'div',
    { class: 'custom-grid', hidden: true },
    colInput,
    h('span', {}, '×'),
    rowInput,
  );
  const syncCustom = (): void => {
    customCtl.toggleAttribute('hidden', custom === null);
    aspectCtl.toggleAttribute('hidden', custom !== null);
  };
  const onCustomInput = (): void => {
    if (!custom) return;
    const cols = clampPanel(colInput.value);
    const rows = clampPanel(rowInput.value);
    custom = { cols, rows };
    if (colInput.value !== String(cols)) colInput.value = String(cols);
    if (rowInput.value !== String(rows)) rowInput.value = String(rows);
    syncSizeHint();
  };
  colInput.addEventListener('input', onCustomInput);
  rowInput.addEventListener('input', onCustomInput);
  const sizeCtl = segmented<'1' | '2' | '3' | 'c'>(
    'Size',
    [
      ...SIZE_OPTIONS.map((o) => ({ value: `${o.scale}` as '1' | '2' | '3', label: o.label })),
      { value: 'c' as const, label: 'Custom' },
    ],
    () => (custom ? 'c' : `${scale}`) as '1' | '2' | '3' | 'c',
    (v) => {
      custom = v === 'c' ? (custom ?? { cols: 4, rows: 4 }) : null;
      if (v !== 'c') scale = Number(v);
      syncCustom();
      syncSizeHint();
    },
  );
  syncSizeHint();
  const modeCtl = segmented<PaletteMode>(
    'Palette',
    [
      { value: 'lego', label: 'LEGO colors' },
      { value: 'free', label: 'Free colors' },
    ],
    () => mode,
    (v) => {
      mode = v;
      // A custom background may not be a LEGO color; switching modes only keeps swatch picks.
      const keep = ['#ffffff', v === 'lego' ? '#05131d' : '#000000'];
      if (background !== null && !keep.includes(background)) background = null;
      setSettings({ paletteMode: v });
      syncBackground();
    },
  );

  // Background: None/Black/White swatches plus a custom color input in Free mode only, so
  // every LEGO-mode background is a LEGO color and the parts exports stay valid.
  const bgWrap = h('div', { class: 'setting-row column' });
  const syncBackground = (): void => {
    const choices: Array<{ hex: string | null; label: string }> = [
      { hex: null, label: 'None' },
      { hex: mode === 'lego' ? '#05131d' : '#000000', label: 'Black' },
      { hex: '#ffffff', label: 'White' },
    ];
    const swatches = h('div', {
      class: 'swatches',
      role: 'radiogroup',
      'aria-label': 'Background',
    });
    for (const { hex, label } of choices) {
      const b = h('button', {
        type: 'button',
        role: 'radio',
        class: background === hex ? 'swatch on' : 'swatch',
        'aria-checked': String(background === hex),
        'aria-label': label,
        'data-tip': label,
      });
      if (hex) b.style.background = hex;
      b.addEventListener('click', () => {
        background = hex;
        syncBackground();
      });
      swatches.append(b);
    }
    if (mode === 'free') {
      const input = h('input', {
        type: 'color',
        value: background ?? '#808080',
        'aria-label': 'Custom background color',
      });
      input.addEventListener('input', () => {
        background = input.value;
        syncBackground();
      });
      swatches.append(input);
    }
    bgWrap.replaceChildren(
      h('span', {}, h('strong', {}, 'Background'), h('small', {}, 'Painted across the empty grid')),
      swatches,
    );
  };
  syncBackground();

  const createBtn = h(
    'button',
    { type: 'button', class: 'btn primary big' },
    icon('brush'),
    'Create',
  );
  createBtn.addEventListener('click', async () => {
    if (creating) return;
    creating = true;
    createBtn.disabled = true;
    try {
      const save = buildDrawnSave({
        name: nameInput.value.trim() || 'My drawing',
        grid: activeGrid(),
        mode,
        background,
      });
      await createSave(save);
      if (!alive) return;

      navigate(routeHash({ name: 'drawEditor', id: save.id }), { replace: true });
    } catch (err) {
      creating = false;
      createBtn.disabled = false;
      console.error(err);
      toast(`Could not create: ${userMessage(err)}`, 4000);
    }
  });

  root.append(
    h(
      'div',
      { class: 'screen draw-create' },
      h(
        'header',
        { class: 'topbar' },
        iconButton('back', 'Back to gallery', () => navigate('#/')),
        h('h1', { class: 'title' }, 'New drawing'),
        h('span', { class: 'spacer' }),
        settingsButton(),
      ),
      h(
        'div',
        { class: 'scroll' },
        h('div', { class: 'field' }, h('span', {}, 'Name'), nameInput),
        aspectCtl,
        sizeCtl,
        customCtl,
        sizeHint,
        modeCtl,
        h(
          'p',
          { class: 'muted small' },
          'Parts lists for buying bricks (BrickLink, Rebrickable) are only available in LEGO colors.',
        ),
        bgWrap,
        createBtn,
      ),
    ),
  );
  return () => {
    alive = false;
  };
}
