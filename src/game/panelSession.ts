import { EMPTY, PANEL_SIZE, type PictureSave } from "../types";
import { panelOrigin } from "./geometry";

export type StrokeMode = "paint" | "remove";

/** What caused a board change: a live stroke, or history navigation. */
export type ChangeCause = "stroke" | "undo" | "redo";

export type PanelEvent =
  | {
      type: "placed";
      x: number;
      y: number;
      colorIndex: number;
      correct: boolean;
      cause: ChangeCause;
    }
  | { type: "removed"; x: number; y: number; colorIndex: number; cause: ChangeCause }
  | { type: "colorDone"; colorIndex: number }
  | { type: "colorReturned"; colorIndex: number }
  | { type: "complete" };

export type PanelListener = (event: PanelEvent) => void;

interface CellChange {
  x: number;
  y: number;
  before: number;
  after: number;
}

export const MAX_HISTORY = 10;

/**
 * Game rules for one 16x16 panel of a picture. Mutates `save.placed` in place.
 * A completed panel is locked: strokes and history navigation do nothing.
 */
export class PanelSession {
  readonly save: PictureSave;
  readonly panelIndex: number;
  private readonly ox: number;
  private readonly oy: number;
  /** Per palette index: studs of that target color in this panel not yet correct. */
  private readonly remaining: number[];
  private remainingTotal = 0;
  private undoStack: CellChange[][] = [];
  private redoStack: CellChange[][] = [];
  private stroke: { mode: StrokeMode; color: number; changes: CellChange[] } | null = null;
  private readonly listeners = new Set<PanelListener>();

  constructor(save: PictureSave, panelIndex: number) {
    this.save = save;
    this.panelIndex = panelIndex;
    const o = panelOrigin(save, panelIndex);
    this.ox = o.x;
    this.oy = o.y;
    this.remaining = new Array<number>(save.palette.length).fill(0);
    for (let y = 0; y < PANEL_SIZE; y++) {
      for (let x = 0; x < PANEL_SIZE; x++) {
        const i = this.idx(x, y);
        const t = save.target[i];
        if (save.placed[i] !== t) {
          this.remaining[t]++;
          this.remainingTotal++;
        }
      }
    }
  }

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
    if (mode === "paint") {
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
    if (s.mode === "paint") {
      if (before !== EMPTY) return false;
      after = s.color;
    } else {
      if (before === EMPTY) return false;
      after = EMPTY;
    }
    const change: CellChange = { x: localX, y: localY, before, after };
    s.changes.push(change);
    this.applyChange(change, false, "stroke");
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

  get strokeActive(): boolean {
    return this.stroke !== null;
  }

  get canUndo(): boolean {
    return this.stroke === null && !this.isComplete() && this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.stroke === null && !this.isComplete() && this.redoStack.length > 0;
  }

  undo(): boolean {
    const move = this.canUndo ? this.undoStack.pop() : undefined;
    if (!move) return false;
    for (let k = move.length - 1; k >= 0; k--) this.applyChange(move[k], true, "undo");
    this.redoStack.push(move);
    return true;
  }

  redo(): boolean {
    const move = this.canRedo ? this.redoStack.pop() : undefined;
    if (!move) return false;
    for (const c of move) this.applyChange(c, false, "redo");
    this.undoStack.push(move);
    return true;
  }

  /** Palette indices still needed in this panel, in palette order. */
  trayColors(): number[] {
    const out: number[] = [];
    for (let c = 0; c < this.remaining.length; c++) if (this.remaining[c] > 0) out.push(c);
    return out;
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

  progress(): { correct: number; total: 256 } {
    return { correct: PANEL_SIZE * PANEL_SIZE - this.remainingTotal, total: 256 };
  }

  isComplete(): boolean {
    return this.remainingTotal === 0;
  }

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
    if (to === EMPTY) {
      this.emit({ type: "removed", x: c.x, y: c.y, colorIndex: from, cause });
    } else {
      this.emit({ type: "placed", x: c.x, y: c.y, colorIndex: to, correct: nowCorrect, cause });
    }
    if (wasCorrect && !nowCorrect) {
      const wasDone = this.remaining[t] === 0;
      this.remaining[t]++;
      this.remainingTotal++;
      if (wasDone) this.emit({ type: "colorReturned", colorIndex: t });
    } else if (!wasCorrect && nowCorrect) {
      this.remaining[t]--;
      this.remainingTotal--;
      if (this.remaining[t] === 0) this.emit({ type: "colorDone", colorIndex: t });
      if (this.remainingTotal === 0) this.emit({ type: "complete" });
    }
  }
}
