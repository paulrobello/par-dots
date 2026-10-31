/**
 * XR bridge (XR P1): the only src/xr file that touches game state. It wraps the SAME
 * PanelSession instance the 2D play screen uses, so XR strokes commit through the identical
 * code path — same `placed` mutations, same in-memory undo history, same save points.
 * `persist` and the color selection accessor are injected by panel play, keeping this module
 * free of ui/ imports (layering: xr/ never imports ui/).
 */

import { lineCells } from '../game/drawTools';
import type { PanelEvent, PanelSession, StrokeMode } from '../game/panelSession';

export interface XrBridgeDeps {
  /** The panel session the 2D screen is playing with; XR mutates the same save. */
  session: PanelSession;
  /** Current color selection from the 2D tray until the XR tray exists (P2b). */
  selected(): number;
  /** The 2D screen's saveNow; XR calls it at the same points a 2D stroke would. */
  persist(): void;
}

/** XR's view of the panel rules: strokes, history, undo/redo, tray queries, change events. */
export interface XrBridge {
  beginStroke(mode: StrokeMode, colorIndex?: number): void;
  applyCell(x: number, y: number): boolean;
  /** Paint/erase the line between two studs (sweep sampling fills gaps between frames). */
  applyLine(x0: number, y0: number, x1: number, y1: number): boolean;
  endStroke(): void;
  cancelStroke(): void;
  undo(): boolean;
  redo(): boolean;
  onChange(cb: (event: PanelEvent) => void): () => void;
  selected(): number;
  trayColors(): number[];
  availableFor(c: number): number;
  remainingFor(c: number): number;
  wrongCells(): Array<{ x: number; y: number }>;
  emptyCount(): number;
  cellAt(x: number, y: number): { target: number; placed: number };
  progress(): { correct: number; total: number };
  isComplete(): boolean;
}

export function createBridge(deps: XrBridgeDeps): XrBridge {
  const { session } = deps;
  return {
    beginStroke: (mode, colorIndex) => session.beginStroke(mode, colorIndex),
    applyCell: (x, y) => session.applyAt(x, y),
    applyLine: (x0, y0, x1, y1) => {
      let changed = false;
      for (const c of lineCells(x0, y0, x1, y1)) {
        if (session.applyAt(c.x, c.y)) changed = true;
      }
      return changed;
    },
    endStroke: () => {
      session.endStroke();
      deps.persist();
    },
    cancelStroke: () => session.cancelStroke(),
    undo: () => {
      const changed = session.undo();
      if (changed) deps.persist();
      return changed;
    },
    redo: () => {
      const changed = session.redo();
      if (changed) deps.persist();
      return changed;
    },
    onChange: (cb) => session.onChange(cb),
    selected: () => deps.selected(),
    trayColors: () => session.trayColors(),
    availableFor: (c) => session.availableFor(c),
    remainingFor: (c) => session.remainingFor(c),
    wrongCells: () => session.wrongCells(),
    emptyCount: () => session.emptyCount(),
    cellAt: (x, y) => session.cellAt(x, y),
    progress: () => session.progress(),
    isComplete: () => session.isComplete(),
  };
}
