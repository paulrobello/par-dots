/**
 * Public API of the game layer: panel geometry, PanelSession, and progress. The one barrel
 * in src/ (see docs/ARCHITECTURE.md, Conventions).
 */

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
  isCorrect,
  overallProgress,
  type Progress,
  panelComplete,
  panelProgress,
  pictureComplete,
} from './progress';
