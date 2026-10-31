/**
 * VR gallery entry (XR P5): adds the Enter VR chip to the gallery and runs the in-VR library
 * loop — pick a picture, build its next unfinished panel with the full XR toolchain, and
 * auto-advance on completion or return to the refreshed library when the picture is done.
 * All persistence goes through the same save repository the 2D screens use.
 */

import { nextUnfinishedPanel, overallProgress, PanelSession } from '../game';
import type { PictureSave } from '../types';
import { h, icon, toast } from './dom';
import { paletteSymbols, userMessage } from './pure';
import { listSaves, loadSave, persistSave } from './saves';

type WorldModule = typeof import('../xr/world');
type LibraryModule = typeof import('../xr/library');
type Studio = import('../xr/scene').Studio;

/** Info shape a library row renders, assembled from a save via the shared progress math. */
export function libraryInfo(save: PictureSave): { id: string; name: string; percent: number } {
  return { id: save.id, name: save.name, percent: overallProgress(save).percent };
}

/** Newest-first is the gallery's order; progress descends within it for building. */
function sortInfos(infos: Array<{ id: string; name: string; percent: number }>): void {
  infos.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
}

/** Add the Enter VR chip to a container; a no-op without WebXR support. */
export function addGalleryXrButton(container: HTMLElement): void {
  void import('../xr/session')
    .then(async ({ xrSupport }) => {
      const { vr, ar } = await xrSupport(navigator.xr);
      if (!vr && !ar) return;
      const chip = h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-label': vr ? 'Enter VR' : 'Enter MR',
        },
        icon('box'),
        h('span', {}, vr ? 'Enter VR' : 'Enter MR'),
      );
      chip.addEventListener('click', () => void enterLibraryXr(vr ? 'vr' : 'ar', chip));
      container.append(chip);
    })
    .catch(() => undefined);
}

/** Launch VR into the library picker; panel worlds swap in as pictures are picked. */
async function enterLibraryXr(mode: 'vr' | 'ar', chip: HTMLButtonElement): Promise<void> {
  const xr = navigator.xr;
  if (!xr) return;
  chip.disabled = true;
  try {
    // Session request before the heavy chunk loads (transient user activation).
    const [srn, lay] = await Promise.all([import('../xr/session'), import('../xr/layout')]);
    const xrSession = await (mode === 'vr' ? srn.requestVrSession(xr) : srn.requestArSession(xr));
    const [scn, wrld, lib] = await Promise.all([
      import('../xr/scene'),
      import('../xr/world'),
      import('../xr/library'),
    ]);
    let xrLaunch: { end(): Promise<void> } | null = null;
    let swapHandle: ReturnType<WorldModule['createSwapWorld']> | null = null;
    let studioRef: Studio | null = null;
    let touched = false;

    const openPanel = (save: PictureSave, panel: number): void => {
      if (!studioRef || !swapHandle) return;
      const session = new PanelSession(save, panel);
      const selected = { color: session.trayColors()[0] ?? -1 };
      const world = wrld.createPanelWorld(studioRef, xrSession, {
        panel: session,
        palette: save.palette,
        symbols: paletteSymbols(save.palette.length),
        mode,
        layout: lay.getLayout(save, panel),
        selected: () => selected.color,
        onSelect: (c) => {
          selected.color = c;
        },
        persist: () => {
          touched = true;
          void persistSave(save);
        },
        onExit: () => void xrLaunch?.end(),
      });
      // Completion auto-advances to the next unfinished panel, or returns to the library
      // when the picture is done. The subscription dies with the world it belongs to.
      const off = session.onChange((event) => {
        if (event.type !== 'complete') return;
        touched = true;
        void persistSave(save).then(() => {
          const next = nextUnfinishedPanel(save, panel);
          if (next !== null && next !== panel) openPanel(save, next);
          else openLibrary();
        });
      });
      swapHandle.swap({
        update: world.update,
        layout: world.layout,
        repaint: world.repaint,
        dispose: () => {
          off();
          world.dispose();
        },
      });
    };

    const openLibrary = (): void => {
      if (!studioRef || !swapHandle) return;
      const rowsHolder = { rows: [] as ReturnType<LibraryModule['libraryRows']> };
      const library = wrld.createLibraryWorld(studioRef, xrSession, {
        rows: () => rowsHolder.rows,
        onPick: (id) => void pick(id),
        onExit: () => void xrLaunch?.end(),
      });
      swapHandle.swap(library);
      void listSaves().then((all) => {
        const infos = all.map(libraryInfo);
        sortInfos(infos);
        rowsHolder.rows = lib.libraryRows(infos);
        library.repaint?.();
      });
    };

    const pick = async (id: string): Promise<void> => {
      const save = await loadSave(id);
      if (!save) return;
      if (save.origin === 'drawn') {
        toast('Drawings open in the 2D editor', 2500);
        return;
      }
      const panel = nextUnfinishedPanel(save, -1);
      if (panel === null) {
        toast('That picture is already complete', 2500);
        return;
      }
      touched = true;
      openPanel(save, panel);
    };

    xrLaunch = scn.launchVr(xrSession, {
      mode,
      onEnd: () => {
        xrLaunch = null;
        chip.disabled = false;
        // The gallery mounted before XR ran; reload so its cards show XR-made progress.
        if (touched) location.reload();
      },
      buildWorld: (studio) => {
        studioRef = studio;
        const initialRows: { rows: ReturnType<LibraryModule['libraryRows']> } = { rows: [] };
        const initial = wrld.createSwapWorld(
          wrld.createLibraryWorld(studio, xrSession, {
            rows: () => initialRows.rows,
            onPick: (id) => void pick(id),
            onExit: () => void xrLaunch?.end(),
          }),
        );
        swapHandle = initial;
        void listSaves().then((all) => {
          const infos = all.map(libraryInfo);
          sortInfos(infos);
          initialRows.rows = lib.libraryRows(infos);
          initial.repaint();
        });
        return initial;
      },
    });
  } catch (err) {
    console.error(err);
    toast(`Could not enter XR: ${userMessage(err)}`, 4000);
    chip.disabled = false;
  }
}
