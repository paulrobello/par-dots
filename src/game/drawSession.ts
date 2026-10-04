/**
 * DrawSession: the draw mode's state machine over a drawn PictureSave, the counterpart of
 * PanelSession. Owns tool state, applies tool output to save.placed in place, edits the
 * palette, keeps undo/redo history (depth MAX_DRAW_HISTORY) and per-color usage counts, and
 * emits change events the UI persists through. DOM-free. Draw operations (strokes, shapes,
 * flood, clear-all) mirror through `symmetry`; history navigation does not. Removing a color
 * shifts palette indices, so it drops earlier history; the removal itself is undoable.
 * addColor is append-only and not undoable. The LEGO-only color constraint lives in the UI
 * (ui/pure.ts paletteEntryFor); the session accepts any PaletteColor.
 */

import { EMPTY, MAX_COLORS, type PaletteColor, type PictureSave } from '../types';
import {
  type BrushTip,
  brushCells,
  ellipseCells,
  floodCells,
  type GridCell,
  lineCells,
  polygonCells,
  rectCells,
  snapLine,
} from './drawTools';

/** Undo/redo depth for draw moves. */
export const MAX_DRAW_HISTORY = 50;

/** Draw tools. The eraser is a stroke mode, not a tool. */
export type DrawTool = 'brush' | 'line' | 'rect' | 'ellipse' | 'poly' | 'fill' | 'pick';

/** Mirror axis: across the horizontal center line (flips y) or the vertical one (flips x). */
export type Symmetry = 'none' | 'horizontal' | 'vertical';

/** What caused a board or palette change: a draw operation, or history navigation. */
export type DrawCause = 'draw' | 'undo' | 'redo';

/** One stud's before/after values in a move or event. */
export interface DrawCellChange {
  x: number;
  y: number;
  before: number;
  after: number;
}

/** Change events. `cells` fires per applied batch; `palette` on any palette edit. */
export type DrawEvent =
  | { type: 'cells'; changes: DrawCellChange[]; usage: number[]; cause: DrawCause }
  | { type: 'palette'; usage: number[] };

/** Callback registered with DrawSession.onChange. */
export type DrawListener = (event: DrawEvent) => void;

type DrawMove =
  | { kind: 'cells'; changes: DrawCellChange[] }
  | { kind: 'recolor'; index: number; before: PaletteColor; after: PaletteColor }
  | {
      kind: 'removeColor';
      index: number;
      entry: PaletteColor;
      primaryBefore: number;
      secondaryBefore: number;
      primaryAfter: number;
      secondaryAfter: number;
    };

interface OpenShape {
  kind: 'line' | 'rect' | 'ellipse' | 'poly';
  start: GridCell;
  points: GridCell[];
  current: GridCell;
}

/**
 * Tool state and board mutations for one drawn picture. Mutates `save.placed` and
 * `save.palette` in place; the UI persists `save` on this session's events.
 */
export class DrawSession {
  /** The drawn picture; `placed` and `palette` are mutated in place. */
  readonly save: PictureSave;
  private tool: DrawTool = 'brush';
  private _brushSize = 1;
  private _brushTip: BrushTip = 'round';
  private _filled = true;
  private _primary = 0;
  private _secondary: number;
  private _symmetry: Symmetry = 'none';
  /** Per palette index: placed dots of that color. */
  private usage: number[];
  private undoStack: DrawMove[] = [];
  private redoStack: DrawMove[] = [];
  private stroke: { value: number; changes: DrawCellChange[] } | null = null;
  private lastApplied: DrawCellChange[] = [];
  private shape: OpenShape | null = null;
  private readonly listeners = new Set<DrawListener>();

  constructor(save: PictureSave) {
    this.save = save;
    this._secondary = save.palette.length > 1 ? 1 : 0;
    this.usage = new Array<number>(save.palette.length).fill(0);
    for (const v of save.placed) if (v !== EMPTY) this.usage[v]++;
  }

  // ---- tool state ---------------------------------------------------------

  setTool(tool: DrawTool): void {
    this.tool = tool;
  }

  get currentTool(): DrawTool {
    return this.tool;
  }

  setBrushSize(size: number): void {
    this._brushSize = Math.max(1, Math.min(9, Math.round(size)));
  }

  get brushSize(): number {
    return this._brushSize;
  }

  setBrushTip(tip: BrushTip): void {
    this._brushTip = tip;
  }

  get brushTip(): BrushTip {
    return this._brushTip;
  }

  setFilled(filled: boolean): void {
    this._filled = filled;
  }

  get filled(): boolean {
    return this._filled;
  }

  /** Sets the primary color; out-of-range indices are ignored. */
  setPrimary(index: number): void {
    if (Number.isInteger(index) && index >= 0 && index < this.save.palette.length) {
      this._primary = index;
    }
  }

  get primary(): number {
    return this._primary;
  }

  setSecondary(index: number): void {
    if (Number.isInteger(index) && index >= 0 && index < this.save.palette.length) {
      this._secondary = index;
    }
  }

  get secondary(): number {
    return this._secondary;
  }

  setSymmetry(symmetry: Symmetry): void {
    this._symmetry = symmetry;
  }

  get symmetry(): Symmetry {
    return this._symmetry;
  }

  /** Value the eraser paints: the background color's palette index, or EMPTY without one. */
  eraseValue(): number {
    const bg = this.save.drawBackground;
    if (bg) {
      const i = this.save.palette.findIndex((c) => c.hex === bg);
      if (i >= 0) return i;
    }
    return EMPTY;
  }

  // ---- strokes ------------------------------------------------------------

  /** Start a stroke. An open stroke is ended first. */
  beginStroke(mode: 'paint' | 'erase'): void {
    if (this.stroke) this.endStroke();
    this.stroke = { value: mode === 'paint' ? this._primary : this.eraseValue(), changes: [] };
  }

  /** Stamp the brush at a whole-grid stud. Returns true when a cell changed. */
  strokeAt(x: number, y: number): boolean {
    const s = this.stroke;
    if (!s) return false;
    const mark = s.changes.length;
    const changed = this.applyCells(
      brushCells(x, y, this._brushSize, this._brushTip),
      s.value,
      s.changes,
    );
    this.lastApplied = changed ? s.changes.slice(mark) : [];
    return changed;
  }

  /** Cells the most recent strokeAt call applied (empty when it changed nothing). */
  get lastStrokeChanges(): readonly DrawCellChange[] {
    return this.lastApplied;
  }

  /** Close the open stroke. A stroke that changed anything becomes one undoable move. */
  endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.changes.length === 0) return;
    this.pushMove({ kind: 'cells', changes: s.changes });
    this.emitCells(s.changes, 'draw');
  }

  /** Abandon the open stroke, reverting its changes, without recording a move. */
  cancelStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    for (let k = s.changes.length - 1; k >= 0; k--) {
      this.setCell(s.changes[k], true);
    }
    this.emitCells(s.changes, 'undo');
  }

  get strokeActive(): boolean {
    return this.stroke !== null;
  }

  // ---- shapes -------------------------------------------------------------

  /** Start a rubber-band shape; for `poly`, (x, y) is the first vertex. */
  beginShape(kind: 'line' | 'rect' | 'ellipse' | 'poly', x: number, y: number): void {
    if (this.stroke) this.endStroke();
    this.shape = { kind, start: { x, y }, points: [{ x, y }], current: { x, y } };
  }

  /** Append a vertex to an open polygon. */
  addPolyPoint(x: number, y: number): void {
    if (this.shape?.kind === 'poly') this.shape.points.push({ x, y });
  }

  /** Track the shape's far end and return its preview cells. Never mutates `placed`. */
  updateShape(x: number, y: number): GridCell[] {
    if (!this.shape) return [];
    this.shape.current = { x, y };
    return this.previewCells();
  }

  /** Cells of the open shape as it stands. */
  shapePreview(): GridCell[] {
    return this.previewCells();
  }

  /** Rasterize and apply the open shape as one undoable move. False when nothing changed. */
  commitShape(): boolean {
    const s = this.shape;
    if (!s) return false;
    const cells = this.previewCells();
    this.shape = null;
    const changes: DrawCellChange[] = [];
    if (!this.applyCells(cells, this._primary, changes)) return false;
    this.pushMove({ kind: 'cells', changes });
    this.emitCells(changes, 'draw');
    return true;
  }

  /** Drop the open shape. Placed was never touched, so there is nothing to revert. */
  cancelShape(): void {
    this.shape = null;
  }

  get shapeActive(): boolean {
    return this.shape !== null;
  }

  /** Vertex count of an open polygon, else 0. */
  get shapePointCount(): number {
    return this.shape?.kind === 'poly' ? this.shape.points.length : 0;
  }

  // ---- flood, pick, clear -------------------------------------------------

  /** Fill the equal-value region at (x, y) with the primary color. One undoable move. */
  flood(x: number, y: number): boolean {
    const { width, height } = this.save;
    const region = floodCells(this.save.placed, width, height, x, y);
    if (region.length === 0) return false;
    const changes: DrawCellChange[] = [];
    if (!this.applyCells(region, this._primary, changes)) return false;
    this.pushMove({ kind: 'cells', changes });
    this.emitCells(changes, 'draw');
    return true;
  }

  /** Palette index at (x, y), or null for EMPTY and out of bounds. */
  pick(x: number, y: number): number | null {
    const { width, height } = this.save;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const v = this.save.placed[y * width + x];
    return v === EMPTY ? null : v;
  }

  /** Paint every stud with the erase value. One undoable move. */
  clearAll(): boolean {
    this.cancelShape();
    const { width, height } = this.save;
    const cells: GridCell[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) cells.push({ x, y });
    }
    const changes: DrawCellChange[] = [];
    if (!this.applyCells(cells, this.eraseValue(), changes)) return false;
    this.pushMove({ kind: 'cells', changes });
    this.emitCells(changes, 'draw');
    return true;
  }

  // ---- palette ------------------------------------------------------------

  /** Append a color and return its index. Throws RangeError at the MAX_COLORS cap. */
  addColor(entry: PaletteColor): number {
    if (this.save.palette.length >= MAX_COLORS) {
      throw new RangeError(`palette is full (${MAX_COLORS} colors max)`);
    }
    this.save.palette.push({ ...entry });
    this.usage.push(0);
    this.emitPalette();
    return this.save.palette.length - 1;
  }

  /**
   * Remove an unused color, remapping palette indices above it. Throws RangeError when the
   * index is out of range, the color has placed dots, or it is the last one. Earlier history
   * is dropped: cell moves would replay stale indices. The removal is one undoable move.
   */
  removeColor(index: number): void {
    if (index < 0 || index >= this.save.palette.length) {
      throw new RangeError(`bad palette index ${index}`);
    }
    if (this.save.palette.length <= 1) {
      throw new RangeError('the palette needs at least one color');
    }
    if ((this.usage[index] ?? 0) > 0) {
      throw new RangeError('color has placed dots; erase them first');
    }
    const entry = { ...this.save.palette[index] };
    const primaryBefore = this._primary;
    const secondaryBefore = this._secondary;
    this.save.palette.splice(index, 1);
    this.usage.splice(index, 1);
    this.remapColors(index, false);
    this.undoStack = [];
    this.redoStack = [];
    this.undoStack.push({
      kind: 'removeColor',
      index,
      entry,
      primaryBefore,
      secondaryBefore,
      primaryAfter: this._primary,
      secondaryAfter: this._secondary,
    });
    this.emitPalette();
  }

  /**
   * Rewrite a palette slot's entry. Cells store indices, so every dot placed with it
   * recolors with it; the operation is one undoable move and moves no dots.
   */
  recolor(index: number, entry: PaletteColor): void {
    if (index < 0 || index >= this.save.palette.length) {
      throw new RangeError(`bad palette index ${index}`);
    }
    const move: DrawMove = {
      kind: 'recolor',
      index,
      before: { ...this.save.palette[index] },
      after: { ...entry },
    };
    this.save.palette[index] = { ...entry };
    this.pushMove(move);
    this.emitPalette();
  }

  // ---- history ------------------------------------------------------------

  get canUndo(): boolean {
    return this.stroke === null && this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.stroke === null && this.redoStack.length > 0;
  }

  /** Revert the last move. Returns true when something changed. */
  undo(): boolean {
    const move = this.canUndo ? this.undoStack.pop() : undefined;
    if (!move) return false;
    this.replay(move, true);
    this.redoStack.push(move);
    return true;
  }

  /** Reapply the last undone move. Returns true when something changed. */
  redo(): boolean {
    const move = this.canRedo ? this.redoStack.pop() : undefined;
    if (!move) return false;
    this.replay(move, false);
    this.undoStack.push(move);
    return true;
  }

  // ---- events and helpers -------------------------------------------------

  /** Placed dots per palette index (skips EMPTY). */
  usageCounts(): number[] {
    return [...this.usage];
  }

  /** Subscribe to change events. Returns a function that unsubscribes. */
  onChange(cb: DrawListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(event: DrawEvent): void {
    for (const cb of [...this.listeners]) cb(event);
  }

  private emitCells(changes: DrawCellChange[], cause: DrawCause): void {
    this.emit({ type: 'cells', changes: [...changes], usage: this.usageCounts(), cause });
  }

  private emitPalette(): void {
    this.emit({ type: 'palette', usage: this.usageCounts() });
  }

  private pushMove(move: DrawMove): void {
    this.undoStack.push(move);
    if (this.undoStack.length > MAX_DRAW_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Apply `value` to `cells`, mirrored per symmetry. Returns true when any cell changed. */
  private applyCells(cells: GridCell[], value: number, changes: DrawCellChange[]): boolean {
    let changed = false;
    for (const c of cells) {
      if (this.applyValue(c.x, c.y, value, changes)) changed = true;
      if (this._symmetry !== 'none') {
        const m = this.mirrored(c);
        if (this.applyValue(m.x, m.y, value, changes)) changed = true;
      }
    }
    return changed;
  }

  private applyValue(x: number, y: number, value: number, changes: DrawCellChange[]): boolean {
    const { width, height } = this.save;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = y * width + x;
    const before = this.save.placed[i];
    if (before === value) return false;
    if (before !== EMPTY) this.usage[before]--;
    if (value !== EMPTY) this.usage[value]++;
    this.save.placed[i] = value;
    changes.push({ x, y, before, after: value });
    return true;
  }

  private setCell(c: DrawCellChange, reverse: boolean): void {
    const from = reverse ? c.after : c.before;
    const to = reverse ? c.before : c.after;
    const i = c.y * this.save.width + c.x;
    if (from !== EMPTY) this.usage[from]--;
    if (to !== EMPTY) this.usage[to]++;
    this.save.placed[i] = to;
  }

  private mirrored(c: GridCell): GridCell {
    if (this._symmetry === 'horizontal') return { x: c.x, y: this.save.height - 1 - c.y };
    if (this._symmetry === 'vertical') return { x: this.save.width - 1 - c.x, y: c.y };
    return c;
  }

  /** Shift palette indices above `index` by one, in `placed` and the color selections. */
  private remapColors(index: number, up: boolean): void {
    const placed = this.save.placed;
    for (let i = 0; i < placed.length; i++) {
      const v = placed[i];
      if (v === EMPTY) continue;
      if (up ? v >= index : v > index) placed[i] = up ? v + 1 : v - 1;
    }
    const bump = (c: number): number => {
      if (up) return c >= index ? c + 1 : c;
      if (c === index) return 0;
      return c > index ? c - 1 : c;
    };
    this._primary = bump(this._primary);
    this._secondary = bump(this._secondary);
  }

  private replay(move: DrawMove, reverse: boolean): void {
    switch (move.kind) {
      case 'cells': {
        const list = reverse ? [...move.changes].reverse() : move.changes;
        for (const c of list) this.setCell(c, reverse);
        this.emitCells(move.changes, reverse ? 'undo' : 'redo');
        break;
      }
      case 'recolor': {
        this.save.palette[move.index] = { ...(reverse ? move.before : move.after) };
        this.emitPalette();
        break;
      }
      case 'removeColor': {
        if (reverse) {
          this.save.palette.splice(move.index, 0, { ...move.entry });
          this.usage.splice(move.index, 0, 0);
          this.remapColors(move.index, true);
          this._primary = move.primaryBefore;
          this._secondary = move.secondaryBefore;
        } else {
          this.save.palette.splice(move.index, 1);
          this.usage.splice(move.index, 1);
          this.remapColors(move.index, false);
          this._primary = move.primaryAfter;
          this._secondary = move.secondaryAfter;
        }
        this.emitPalette();
        break;
      }
    }
  }

  private previewCells(): GridCell[] {
    const s = this.shape;
    if (!s) return [];
    if (s.kind === 'poly') {
      if (s.points.length >= 3) return polygonCells(s.points, this._filled);
      if (s.points.length === 2) {
        return lineCells(s.points[0].x, s.points[0].y, s.points[1].x, s.points[1].y);
      }
      return [...s.points];
    }
    const end =
      s.kind === 'line' ? snapLine(s.start.x, s.start.y, s.current.x, s.current.y) : s.current;
    if (s.kind === 'line') return lineCells(s.start.x, s.start.y, end.x, end.y);
    if (s.kind === 'rect') return rectCells(s.start.x, s.start.y, end.x, end.y, this._filled);
    return ellipseCells(s.start.x, s.start.y, end.x, end.y, this._filled);
  }
}
