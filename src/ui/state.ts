/** Navigation handoff state: the pending picture source and the Overview/Panel transition hint. */

import type { LibraryEntry, NormalizedCrop } from '../types';

/** Source chosen on the New Picture screen, consumed by Setup. */
export interface PendingSource {
  kind: 'library' | 'upload';
  name: string;
  /** Library slug, or undefined for uploads. */
  slug?: string;
  /** Default aspect (library) or best guess from dimensions (upload). */
  aspect: LibraryEntry['aspect'];
  /** Default framing (library); uploads start centered. */
  crop?: NormalizedCrop;
  /** Decoded, downscaled pixels. */
  image: ImageData;
  /** Original upload blob, stored at Start. */
  blob?: Blob;
}

let pending: PendingSource | null = null;

export function setPendingSource(s: PendingSource | null): void {
  pending = s;
}

export function getPendingSource(): PendingSource | null {
  return pending;
}

/** Transition hints passed between Overview and Panel play. */
export interface TransitionHint {
  /** Panel the player just left (Overview animates a zoom-out from it). */
  fromPanel?: number;
  /** The panel was just completed (Overview may show the finale). */
  justCompleted?: boolean;
}

let hint: TransitionHint = {};

export function setTransitionHint(t: TransitionHint): void {
  hint = t;
}

/** Read and clear the transition hint. */
export function takeTransitionHint(): TransitionHint {
  const t = hint;
  hint = {};
  return t;
}
