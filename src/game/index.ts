/**
 * Public API of the game layer: draw tools and sessions, panel geometry, PanelSession, and
 * progress. The one barrel in src/ (see docs/ARCHITECTURE.md, Conventions).
 */

export {
  type DrawCause,
  type DrawCellChange,
  type DrawEvent,
  type DrawListener,
  DrawSession,
  type DrawTool,
  MAX_DRAW_HISTORY,
  type Symmetry,
} from './drawSession';
export {
  type BrushTip,
  brushCells,
  ellipseCells,
  floodCells,
  type GridCell,
  lineCells,
  polygonCells,
  rectCells,
  SNAP_TOLERANCE_DEG,
  snapLine,
} from './drawTools';
export {
  aspectOf,
  panelCount,
  panelCountOf,
  panelFractions,
  panelGridOf,
  panelIndexOf,
  panelOrigin,
  panelOriginOf,
  studDims,
  studIndex,
} from './geometry';
export {
  type ChangeCause,
  MAX_HISTORY,
  type PanelEvent,
  type PanelListener,
  PanelSession,
  type StrokeMode,
} from './panelSession';
export {
  colorCounts,
  effectiveCells,
  isCorrect,
  nextUnfinishedPanel,
  overallProgress,
  type Progress,
  panelColorCounts,
  panelComplete,
  panelProgress,
  pictureComplete,
  placedCount,
} from './progress';
