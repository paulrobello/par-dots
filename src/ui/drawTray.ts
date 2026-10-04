/**
 * Draw tray: primary/secondary color slots with swap, palette swatches with usage counts
 * and per-color edit affordances, and the add/edit color sheet (LEGO grid or Free input).
 */

import { LEGO_COLORS } from '../engine/legoPalette';
import type { DrawSession } from '../game';
import { MAX_COLORS, type PaletteColor, type PaletteMode } from '../types';
import { h, iconButton, openSheet, toast } from './dom';
import { paletteEntryFor, userMessage } from './pure';

/** What the editor drives: refresh after session events, dispose on unmount. */
export interface DrawTrayHandle {
  refresh(): void;
  dispose(): void;
}

/** Mounts the draw tray into `tray`. `onPick` fires with the clicked palette index. */
export function createDrawTray(
  tray: HTMLElement,
  session: DrawSession,
  mode: PaletteMode,
  onPick: (c: number) => void,
): DrawTrayHandle {
  let disposed = false;

  function slot(index: number, label: string, primary: boolean): HTMLElement {
    const hex = session.save.palette[index]?.hex ?? '#888888';
    const b = h('button', {
      type: 'button',
      class: primary ? 'slot primary' : 'slot',
      'aria-label': `${label} color`,
      title: `${label} color`,
      style: `--c:${hex};background:${hex}`,
    });
    b.addEventListener('click', () => onPick(index));
    return b;
  }

  function swap(): void {
    const p = session.primary;
    session.setPrimary(session.secondary);
    session.setSecondary(p);
    build();
  }

  function build(): void {
    if (disposed) return;
    const usage = session.usageCounts();
    const row = h('div', {
      class: 'draw-swatches',
      role: 'radiogroup',
      'aria-label': 'Drawing colors',
    });
    session.save.palette.forEach((entry, i) => {
      const pick = h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(i === session.primary),
          class: i === session.primary ? 'swatch on' : 'swatch',
          'aria-label': `${entry.name}, ${usage[i]} dots`,
          title: `${entry.name} (${usage[i]})`,
          style: `--c:${entry.hex};background:${entry.hex};--count-ink:${
            isLight(entry.hex) ? '#1b1b1b' : '#fff'
          }`,
        },
        h('span', { class: 'count' }, String(usage[i])),
      );
      pick.addEventListener('click', () => onPick(i));
      const edit = iconButton(
        'gear',
        `Edit ${entry.name}`,
        () => openColorSheet(i),
        'icon-btn edit-btn',
      );
      row.append(h('span', { class: 'draw-swatch' }, pick, edit));
    });
    row.append(
      iconButton('plus', 'Add color', () => {
        if (session.save.palette.length >= MAX_COLORS) {
          toast(`Palette is full (${MAX_COLORS} colors max)`);
          return;
        }
        openColorSheet(null);
      }),
    );
    tray.replaceChildren(
      slot(session.primary, 'Primary', true),
      iconButton('move', 'Swap colors', swap, 'icon-btn swap'),
      slot(session.secondary, 'Secondary', false),
      row,
    );
  }

  function openColorSheet(index: number | null): void {
    const recolor = index !== null;
    const usage = session.usageCounts();
    const body = h(
      'div',
      { class: 'confirm' },
      h(
        'p',
        { class: 'muted small' },
        recolor
          ? 'Pick a new color for this slot. Dots already placed with it change color too.'
          : 'Add a color to the palette.',
      ),
    );
    const apply = (entry: PaletteColor): void => {
      try {
        if (recolor) session.recolor(index, entry);
        else session.addColor(entry);
      } catch (err) {
        toast(userMessage(err), 3000);
        return;
      }
      sheet.close();
      build();
    };
    let picker: HTMLElement;
    if (mode === 'lego') {
      picker = h('div', { class: 'lego-grid', role: 'listbox', 'aria-label': 'LEGO colors' });
      for (const c of LEGO_COLORS) {
        const b = h('button', {
          type: 'button',
          class: 'swatch',
          'aria-label': c.name,
          title: c.name,
          style: `--c:${c.hex};background:${c.hex}`,
        });
        b.addEventListener('click', () => apply(paletteEntryFor('lego', c.hex)));
        picker.append(b);
      }
    } else {
      const input = h('input', {
        type: 'color',
        value: recolor ? session.save.palette[index].hex : '#808080',
        'aria-label': 'Color',
      });
      const ok = h('button', { type: 'button', class: 'btn primary' }, recolor ? 'Apply' : 'Add');
      ok.addEventListener('click', () => {
        try {
          apply(paletteEntryFor('free', input.value));
        } catch (err) {
          toast(userMessage(err), 3000);
        }
      });
      picker = h('div', { class: 'guide-row' }, input, ok);
    }
    body.append(picker);
    if (recolor) {
      const remove = h('button', { type: 'button', class: 'btn ghost' }, 'Remove color');
      remove.disabled = usage[index] > 0;
      remove.title = remove.disabled ? 'Erase this color’s dots first' : '';
      remove.addEventListener('click', () => {
        try {
          session.removeColor(index);
        } catch (err) {
          toast(userMessage(err), 3000);
          return;
        }
        sheet.close();
        build();
      });
      body.append(remove);
    }
    const sheet = openSheet(recolor ? 'Edit color' : 'Add color', body);
  }

  build();
  return {
    refresh: build,
    dispose: () => {
      disposed = true;
    },
  };
}

function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45;
}
