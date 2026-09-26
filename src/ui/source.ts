import type { Aspect, LibraryEntry } from '../types';
import { h, icon, iconButton, toast } from './dom';
import { nameFromFile } from './pure';
import type { Cleanup, ScreenContext } from './screen';
import { decodeImage, loadLibrary, setPendingSource } from './state';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Nearest supported aspect for an image's dimensions. */
function guessAspect(w: number, hgt: number): Aspect {
  const r = w / hgt;
  if (r > 1.15) return '4:3';
  if (r < 0.87) return '3:4';
  return '1:1';
}

export function mountSource({ root, navigate }: ScreenContext): Cleanup {
  let alive = true;
  let busy = false;
  const grid = h('div', { class: 'lib-grid' }, h('p', { class: 'muted' }, 'Loading pictures…'));
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'visually-hidden',
    id: 'upload-input',
    'aria-label': 'Upload a photo',
  });

  const setBusy = (msg: string | null): void => {
    busy = msg !== null;
    status.textContent = msg ?? '';
    root.querySelector('.screen')?.classList.toggle('busy', busy);
  };

  const chooseLibrary = async (e: LibraryEntry): Promise<void> => {
    if (busy) return;
    setBusy(`Opening ${e.title}…`);
    try {
      const res = await fetch(e.src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const image = await decodeImage(await res.blob());
      if (!alive) return;
      setPendingSource({
        kind: 'library',
        name: e.title,
        slug: e.slug,
        aspect: e.aspect,
        crop: e.crop,
        image,
      });
      navigate('#/setup');
    } catch (err) {
      setBusy(null);
      toast(`Could not open picture: ${String(err)}`, 3000);
    }
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || busy) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast('That image is larger than 20 MB. Please pick a smaller one.', 3500);
      return;
    }
    setBusy('Reading photo…');
    try {
      const image = await decodeImage(file);
      if (!alive) return;
      setPendingSource({
        kind: 'upload',
        name: nameFromFile(file.name),
        aspect: guessAspect(image.width, image.height),
        image,
        blob: file,
      });
      navigate('#/setup');
    } catch {
      setBusy(null);
      toast('This image format is not supported on this device.', 3500);
    }
  });

  root.append(
    h(
      'div',
      { class: 'screen source' },
      h(
        'header',
        { class: 'topbar' },
        iconButton('back', 'Back to gallery', () => navigate('#/')),
        h('h1', { class: 'title' }, 'New Picture'),
        h('span', { class: 'spacer' }),
      ),
      h(
        'div',
        { class: 'scroll' },
        h(
          'label',
          { class: 'upload-card', for: 'upload-input' },
          icon('upload'),
          h('span', {}, h('strong', {}, 'Upload a photo'), h('small', {}, 'Stays on your device')),
        ),
        fileInput,
        status,
        h('h2', { class: 'section-title' }, 'Or pick one'),
        grid,
      ),
    ),
  );

  loadLibrary()
    .then((entries) => {
      if (!alive) return;
      grid.replaceChildren(
        ...entries.map((e) =>
          h(
            'button',
            {
              type: 'button',
              class: 'lib-tile',
              'aria-label': e.title,
              'data-slug': e.slug,
              on: { click: () => void chooseLibrary(e) },
            },
            h('img', { src: e.thumb, alt: '', loading: 'lazy', decoding: 'async' }),
            h('span', { class: 'lib-title' }, e.title),
          ),
        ),
      );
    })
    .catch((err: unknown) => {
      if (alive)
        grid.replaceChildren(h('p', { class: 'empty' }, `Library unavailable: ${String(err)}`));
    });

  return () => {
    alive = false;
  };
}
