/**
 * VR gallery entry (XR P5): adds the Enter VR chip to the gallery and runs the in-VR library
 * loop — pick a picture, build its next unfinished panel with the full XR toolchain, and
 * continue to another panel or return to the refreshed library when the picture is done.
 * All persistence goes through the same save repository the 2D screens use.
 */

import { nextUnfinishedPanel, overallProgress, PanelSession, pictureComplete } from '../game';
import type { PictureSave } from '../types';
import { h, icon, toast } from './dom';
import { paletteSymbols, userMessage } from './pure';
import { listSaves, loadSave, persistSave, whenSaved } from './saves';
import { setImmersiveActive } from './swUpdate';

type WorldModule = typeof import('../xr/world');
type LibraryModule = typeof import('../xr/library');
type Studio = import('../xr/scene').Studio;

/** Small target-picture preview for the in-world library, generated from the saved mosaic. */
function libraryPreview(save: PictureSave): HTMLCanvasElement | undefined {
  const canvas = document.createElement('canvas');
  const ratio = save.width / save.height;
  canvas.width = Math.max(1, Math.round(48 * Math.min(1, ratio)));
  canvas.height = Math.max(1, Math.round(48 * Math.min(1, 1 / ratio)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  for (let y = 0; y < canvas.height; y++) {
    const sy = Math.floor((y / canvas.height) * save.height);
    for (let x = 0; x < canvas.width; x++) {
      const sx = Math.floor((x / canvas.width) * save.width);
      const color = save.target[sy * save.width + sx];
      ctx.fillStyle = save.palette[color]?.hex ?? '#20282d';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

/** Info shape a library row renders, assembled from a save via the shared progress math. */
export function libraryInfo(save: PictureSave): {
  id: string;
  name: string;
  percent: number;
  preview?: HTMLCanvasElement;
} {
  return {
    id: save.id,
    name: save.name,
    percent: overallProgress(save).percent,
    preview: libraryPreview(save),
  };
}

/** Show projects with the most progress first, then sort ties by name. */
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
    setImmersiveActive(true);
    xrSession.addEventListener('end', () => setImmersiveActive(false), { once: true });
    const [scn, wrld, lib] = await Promise.all([
      import('../xr/scene'),
      import('../xr/world'),
      import('../xr/library'),
    ]).catch((error) => {
      void xrSession.end().catch(() => undefined);
      throw error;
    });
    let xrLaunch: { end(): Promise<void> } | null = null;
    let swapHandle: ReturnType<WorldModule['createSwapWorld']> | null = null;
    let studioRef: Studio | null = null;
    let touched = false;
    let alive = true;

    const openPanel = (save: PictureSave, panel: number): void => {
      if (!alive || !studioRef || !swapHandle) return;
      const session = new PanelSession(save, panel);
      const selected = { color: session.trayColors()[0] ?? -1 };
      let advancing = false;
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
        onComplete: () => {
          if (pictureComplete(save)) save.completedAt ??= Date.now();
        },
        continueLabel: () => (nextUnfinishedPanel(save, panel) === null ? 'Library' : 'Next plate'),
        onContinue: () => {
          if (advancing) return;
          advancing = true;
          touched = true;
          void persistSave(save)
            .then(() => {
              if (!alive) return;
              const next = nextUnfinishedPanel(save, panel);
              if (next !== null && next !== panel) openPanel(save, next);
              else openLibrary();
            })
            .catch((error: unknown) => {
              advancing = false;
              console.error(error);
            });
        },
      });
      swapHandle.swap({
        update: world.update,
        layout: world.layout,
        repaint: world.repaint,
        dispose: () => {
          const layout = world.layout();
          if (layout && mode === 'vr') {
            lay.setLayout(save, panel, layout);
            touched = true;
            void persistSave(save);
          }
          world.dispose();
        },
      });
    };

    const openLibrary = (): void => {
      if (!alive || !studioRef || !swapHandle) return;
      const rowsHolder = { rows: [] as ReturnType<LibraryModule['libraryRows']> };
      const library = wrld.createLibraryWorld(studioRef, xrSession, {
        rows: () => rowsHolder.rows,
        onPick: (id) => void pick(id),
        onExit: () => void xrLaunch?.end(),
      });
      swapHandle.swap(library);
      void listSaves().then((all) => {
        if (!alive) return;
        const infos = all
          .filter((save) => save.origin !== 'drawn' && nextUnfinishedPanel(save, -1) !== null)
          .map(libraryInfo);
        sortInfos(infos);
        rowsHolder.rows = lib.libraryRows(infos);
        library.repaint?.();
      });
    };

    let picking = false;
    const pick = async (id: string): Promise<void> => {
      if (picking) return;
      picking = true;
      try {
        const save = await loadSave(id);
        if (!alive || !save) return;
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
      } finally {
        picking = false;
      }
    };

    xrLaunch = scn.launchVr(xrSession, {
      mode,
      onEnd: () => {
        alive = false;
        xrLaunch = null;
        chip.disabled = false;
        // The gallery mounted before XR ran; reload so its cards show XR-made progress.
        if (touched) void whenSaved().then(() => location.reload());
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
          if (!alive) return;
          const infos = all
            .filter((save) => save.origin !== 'drawn' && nextUnfinishedPanel(save, -1) !== null)
            .map(libraryInfo);
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
