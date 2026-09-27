/** Play-screen feedback: redraws, sounds and haptics driven by `PanelSession` events. */

import { haptic, play } from '../audio/sfx';
import type { PanelSession } from '../game';
import type { BoardRenderer } from '../render/boardRenderer';

const SOUND_GAP_MS = 45;

export interface PlayFeedback {
  /** Re-derive the "completing" latch after a cancelled stroke. */
  resyncCompleting(): void;
  /**
   * Every stud filled but some dots wrong: buzz on the transition into that state and
   * return whether the board is in it.
   */
  checkFullButWrong(): boolean;
  dispose(): void;
}

export function bindPlayFeedback(session: PanelSession, board: BoardRenderer): PlayFeedback {
  let lastSound = 0;
  // Once the last dot lands, the panel-complete fanfare replaces per-color chimes.
  let completing = false;
  let fullButWrong = false;
  const sfx = (name: 'place' | 'remove'): void => {
    const t = performance.now();
    if (t - lastSound < SOUND_GAP_MS) return;
    lastSound = t;
    play(name);
    haptic(name);
  };
  const off = session.onChange((ev) => {
    if (ev.type === 'placed' && ev.cause === 'stroke') {
      board.pressAnim(ev.x, ev.y);
      sfx('place');
    } else if (ev.type === 'placed' || ev.type === 'removed') {
      board.drawCells([{ x: ev.x, y: ev.y }]);
      if (ev.type === 'removed' && ev.cause === 'stroke') sfx('remove');
    } else if (ev.type === 'colorDone' && !completing) {
      play('colorDone');
      haptic('colorDone');
    } else if (ev.type === 'complete') {
      completing = true;
    }
  });
  return {
    resyncCompleting() {
      completing = session.isComplete();
    },
    checkFullButWrong() {
      const now = session.emptyCount() === 0 && !session.isComplete();
      if (now && !fullButWrong) {
        play('error');
        haptic('error');
      }
      fullButWrong = now;
      return now;
    },
    dispose: off,
  };
}
