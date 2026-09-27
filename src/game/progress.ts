/**
 * Progress over a whole PictureSave: correct studs per panel and per picture, and
 * completion checks. A stud is correct when its placed dot matches its target color.
 */

import { EMPTY, PANEL_SIZE, type PictureSave } from '../types';
import { panelCount, panelOrigin } from './geometry';

export interface Progress {
  correct: number;
  total: number;
  percent: number;
}

/** A stud is correct when it holds a dot matching its target color. */
export function isCorrect(save: PictureSave, i: number): boolean {
  const p = save.placed[i];
  return p !== EMPTY && p === save.target[i];
}

function pct(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
}

/** Correct studs over all studs of the picture. percent is rounded to one decimal. */
export function overallProgress(save: PictureSave): Progress {
  const total = save.width * save.height;
  let correct = 0;
  for (let i = 0; i < total; i++) if (isCorrect(save, i)) correct++;
  return { correct, total, percent: pct(correct, total) };
}

/** Correct studs over the 256 studs of one panel. */
export function panelProgress(save: PictureSave, panelIndex: number): Progress {
  const o = panelOrigin(save, panelIndex);
  let correct = 0;
  for (let y = 0; y < PANEL_SIZE; y++) {
    const row = (o.y + y) * save.width + o.x;
    for (let x = 0; x < PANEL_SIZE; x++) if (isCorrect(save, row + x)) correct++;
  }
  const total = PANEL_SIZE * PANEL_SIZE;
  return { correct, total, percent: pct(correct, total) };
}

/** Target dot count per palette index for the whole picture (length = palette.length). */
export function colorCounts(save: PictureSave): number[] {
  const counts = new Array<number>(save.palette.length).fill(0);
  for (let i = 0; i < save.width * save.height; i++) counts[save.target[i]]++;
  return counts;
}

/** Target dot count per palette index within one panel (length = palette.length). */
export function panelColorCounts(save: PictureSave, panelIndex: number): number[] {
  const counts = new Array<number>(save.palette.length).fill(0);
  const o = panelOrigin(save, panelIndex);
  for (let y = 0; y < PANEL_SIZE; y++) {
    const row = (o.y + y) * save.width + o.x;
    for (let x = 0; x < PANEL_SIZE; x++) counts[save.target[row + x]]++;
  }
  return counts;
}

export function panelComplete(save: PictureSave, panelIndex: number): boolean {
  const p = panelProgress(save, panelIndex);
  return p.correct === p.total;
}

export function pictureComplete(save: PictureSave): boolean {
  for (let i = 0; i < panelCount(save); i++) if (!panelComplete(save, i)) return false;
  return true;
}

/** Next incomplete panel after `from` in row-major order, wrapping; null when every panel is complete. */
export function nextUnfinishedPanel(save: PictureSave, from: number): number | null {
  const n = panelCount(save);
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!panelComplete(save, i)) return i;
  }
  return null;
}
