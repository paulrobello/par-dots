/**
 * PanelSession: the game rules for one 16x16 panel (strokes, tray colors, undo/redo,
 * completion) as an event-emitting state machine over a PictureSave. DOM-free.
 */

import { EMPTY, PANEL_SIZE, type PictureSave } from '../types';
import { panelOrigin } from './geometry';

/** What a stroke does to the studs it crosses. */
export type StrokeMode = 'paint' | 'remove';

/** What caused a board change: a live stroke, or history navigation. */
export type ChangeCause = 'stroke' | 'undo' | 'redo';

/**
 * Board change events. `placed`/`removed` fire per stud; `colorDone` when the last stud of a
 * target color becomes correct, `colorReturned` when one of them stops being correct, and
 * `complete` when every stud is correct.
 */
export type PanelEvent =
  | {
      type: 'placed';
      x: number;
      y: number;
      colorIndex: number;
      correct: boolean;
      cause: ChangeCause;
    }
  | { type: 'removed'; x: number; y: number; colorIndex: number; cause: ChangeCause }
  | { type: 'colorDone'; colorIndex: number }
  | { type: 'colorReturned'; colorIndex: number }
  | { type: 'complete' };

/** Callback registered with PanelSession.onChange. */
export type PanelListener = (event: PanelEvent) => void;

interface CellChange {
  x: number;
  y: number;
  before: number;
  after: number;
}

/** Undoable moves kept per panel; older moves are dropped. */
export const MAX_HISTORY = 10;

/**
 * Game rules for one 16x16 panel of a picture. Mutates `save.placed` in place.
 * A completed panel is locked: strokes and history navigation do nothing.
 */
export class PanelSession {
  /** The picture being played; `placed` is mutated in place. */
  readonly save: PictureSave;
  /** Row-major panel number within the picture. */
  readonly panelIndex: number;
  private readonly ox: number;
  private readonly oy: number;
  /** Per palette index: studs of that target color in this panel not yet correct. */
  private readonly remaining: number[];
  private remainingTotal = 0;
  /** Per palette index: studs in this panel whose target is that color. */
  private readonly needed: number[];
  /** Per palette index: dots of that color placed in this panel, right or wrong. */
  private readonly used: number[];
  /** Studs in this panel with no dot placed. */
  private empty = 0;
  private undoStack: CellChange[][] = [];
  private redoStack: CellChange[][] = [];
  private stroke: { mode: StrokeMode; color: number; changes: CellChange[] } | null = null;
  private readonly listeners = new Set<PanelListener>();

  /** Counts the panel's empty and not-yet-correct studs. Throws RangeError for a bad index. */
  constructor(save: PictureSave, panelIndex: number) {
    this.save = save;
    this.panelIndex = panelIndex;
    const o = panelOrigin(save, panelIndex);
    this.ox = o.x;
    this.oy = o.y;
    this.remaining = new Array<number>(save.palette.length).fill(0);
    this.needed = new Array<number>(save.palette.length).fill(0);
    this.used = new Array<number>(save.palette.length).fill(0);
    for (let y = 0; y < PANEL_SIZE; y++) {
      for (let x = 0; x < PANEL_SIZE; x++) {
        const i = this.idx(x, y);
        const t = save.target[i];
        this.needed[t]++;
        if (save.placed[i] === EMPTY) this.empty++;
        else this.used[save.placed[i]]++;
        if (save.placed[i] !== t) {
          this.remaining[t]++;
          this.remainingTotal++;
        }
      }
    }
  }

  /** Subscribe to board events. Returns a function that unsubscribes. */
  onChange(cb: PanelListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(event: PanelEvent): void {
    for (const cb of [...this.listeners]) cb(event);
  }

  /** Start a stroke. Paint mode requires a valid palette index. An open stroke is ended first. */
  beginStroke(mode: StrokeMode, colorIndex?: number): void {
    if (this.stroke) this.endStroke();
    let color = EMPTY;
    if (mode === 'paint') {
      if (
        colorIndex === undefined ||
        !Number.isInteger(colorIndex) ||
        colorIndex < 0 ||
        colorIndex >= this.save.palette.length
      ) {
        throw new RangeError(`invalid paint color ${colorIndex}`);
      }
      color = colorIndex;
    }
    this.stroke = { mode, color, changes: [] };
  }

  /** Apply the open stroke at a panel-local stud. Returns true if the board changed. */
  applyAt(localX: number, localY: number): boolean {
    const s = this.stroke;
    if (!s || this.isComplete() || !this.inBounds(localX, localY)) return false;
    const before = this.save.placed[this.idx(localX, localY)];
    let after: number;
    if (s.mode === 'paint') {
      if (before !== EMPTY || this.availableFor(s.color) <= 0) return false;
      after = s.color;
    } else {
      if (before === EMPTY) return false;
      after = EMPTY;
    }
    const change: CellChange = { x: localX, y: localY, before, after };
    s.changes.push(change);
    this.applyChange(change, false, 'stroke');
    return true;
  }

  /** Close the open stroke. A stroke that changed anything becomes one undoable move. */
  endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.changes.length === 0) return;
    this.undoStack.push(s.changes);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Abandon the open stroke: revert its changes (emitting their events with cause 'undo')
   * without recording an undoable move.
   */
  cancelStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    for (let k = s.changes.length - 1; k >= 0; k--) this.applyChange(s.changes[k], true, 'undo');
  }

  /** True between beginStroke and endStroke/cancelStroke. */
  get strokeActive(): boolean {
    return this.stroke !== null;
  }

  /** A move can be undone: no open stroke, panel not complete, and history not empty. */
  get canUndo(): boolean {
    return this.stroke === null && !this.isComplete() && this.undoStack.length > 0;
  }

  /** A move can be redone: no stroke is open, the panel is not complete, and a move was undone. */
  get canRedo(): boolean {
    return this.stroke === null && !this.isComplete() && this.redoStack.length > 0;
  }

  /**
   * Revert the last move, emitting its events with cause 'undo'. Returns true when something
   * changed, false when there was nothing to undo.
   */
  undo(): boolean {
    const move = this.canUndo ? this.undoStack.pop() : undefined;
    if (!move) return false;
    for (let k = move.length - 1; k >= 0; k--) this.applyChange(move[k], true, 'undo');
    this.redoStack.push(move);
    return true;
  }

  /**
   * Reapply the last undone move, emitting its events with cause 'redo'. Returns true when
   * something changed, false when there was nothing to redo.
   */
  redo(): boolean {
    const move = this.canRedo ? this.redoStack.pop() : undefined;
    if (!move) return false;
    for (const c of move) this.applyChange(c, false, 'redo');
    this.undoStack.push(move);
    return true;
  }

  /** Palette indices still needed in this panel, in palette order. */
  trayColors(): number[] {
    const out: number[] = [];
    for (let c = 0; c < this.remaining.length; c++) if (this.remaining[c] > 0) out.push(c);
    return out;
  }

  /** Studs of target color `c` in this panel not yet correctly placed. */
  remainingFor(c: number): number {
    return this.remaining[c] ?? 0;
  }

  /**
   * Dots of color `c` still in hand: the panel's studs of that color minus the dots of it already
   * placed, right or wrong. A paint stroke cannot place a color at 0.
   */
  availableFor(c: number): number {
    return (this.needed[c] ?? 0) - (this.used[c] ?? 0);
  }

  /** Studs in this panel with no dot placed. */
  emptyCount(): number {
    return this.empty;
  }

  /** Panel-local coordinates of dots whose color differs from the target. */
  wrongCells(): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < PANEL_SIZE; y++) {
      for (let x = 0; x < PANEL_SIZE; x++) {
        const i = this.idx(x, y);
        const p = this.save.placed[i];
        if (p !== EMPTY && p !== this.save.target[i]) out.push({ x, y });
      }
    }
    return out;
  }

  /** Correct studs and total studs (256) in this panel. */
  progress(): { correct: number; total: number } {
    return {
      correct: PANEL_SIZE * PANEL_SIZE - this.remainingTotal,
      total: PANEL_SIZE * PANEL_SIZE,
    };
  }

  /** Every stud holds its target color. A complete panel ignores strokes and history. */
  isComplete(): boolean {
    return this.remainingTotal === 0;
  }

  /** Target and placed value of a panel-local stud. Throws RangeError outside the panel. */
  cellAt(x: number, y: number): { target: number; placed: number } {
    if (!this.inBounds(x, y)) throw new RangeError(`cell (${x}, ${y}) out of panel`);
    const i = this.idx(x, y);
    return { target: this.save.target[i], placed: this.save.placed[i] };
  }

  private inBounds(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < PANEL_SIZE &&
      y < PANEL_SIZE
    );
  }

  private idx(x: number, y: number): number {
    return (this.oy + y) * this.save.width + (this.ox + x);
  }

  private applyChange(c: CellChange, reverse: boolean, cause: ChangeCause): void {
    const from = reverse ? c.after : c.before;
    const to = reverse ? c.before : c.after;
    const i = this.idx(c.x, c.y);
    const t = this.save.target[i];
    const wasCorrect = from === t;
    const nowCorrect = to === t;
    this.save.placed[i] = to;
    if (from === EMPTY) this.empty--;
    else this.used[from]--;
    if (to === EMPTY) this.empty++;
    else this.used[to]++;
    if (to === EMPTY) {
      this.emit({ type: 'removed', x: c.x, y: c.y, colorIndex: from, cause });
    } else {
      this.emit({ type: 'placed', x: c.x, y: c.y, colorIndex: to, correct: nowCorrect, cause });
    }
    if (wasCorrect && !nowCorrect) {
      const wasDone = this.remaining[t] === 0;
      this.remaining[t]++;
      this.remainingTotal++;
      if (wasDone) this.emit({ type: 'colorReturned', colorIndex: t });
    } else if (!wasCorrect && nowCorrect) {
      this.remaining[t]--;
      this.remainingTotal--;
      if (this.remaining[t] === 0) this.emit({ type: 'colorDone', colorIndex: t });
      if (this.remainingTotal === 0) this.emit({ type: 'complete' });
    }
  }
}
