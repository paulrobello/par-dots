/**
 * New Picture screen (`#/new`): bundled library, photo upload and https image links.
 * Uploads and links are capped at 20 MB (links also time out after 30 s) and decoded with
 * the 40 MP guard before handing off to setup.
 */

import type { Aspect, LibraryEntry } from '../types';
import { h, icon, iconButton, toast } from './dom';
import { decodeImage, ImageTooLargeError } from './image';
import { loadLibrary } from './library';
import { nameFromFile, nameFromUrl, parseImageUrl, userMessage } from './pure';
import type { Cleanup, ScreenContext } from './screen';
import { settingsButton } from './settingsSheet';
import { setPendingSource } from './state';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const URL_FETCH_TIMEOUT_MS = 30_000;

class TooLargeError extends Error {}

/** Read a response body, aborting as soon as it passes max bytes. */
async function readCapped(res: Response, max: number, ctrl: AbortController): Promise<Blob> {
  const type = res.headers.get('content-type') ?? '';
  if (!res.body) {
    const blob = await res.blob();
    if (blob.size > max) throw new TooLargeError();
    return blob;
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      ctrl.abort();
      throw new TooLargeError();
    }
    chunks.push(value);
  }
  return new Blob(chunks, { type });
}

/** Nearest supported aspect for an image's dimensions. */
function guessAspect(w: number, hgt: number): Aspect {
  const r = w / hgt;
  if (r > 1.15) return '4:3';
  if (r < 0.87) return '3:4';
  return '1:1';
}

/**
 * Mounts the New Picture screen (route `#/new`). The returned Cleanup marks the screen dead so
 * an in-flight library load, download or decode does not navigate to setup afterward.
 */
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
      console.warn('Library image failed', err);
      setBusy(null);
      toast(`Could not open picture: ${userMessage(err)}`, 3000);
    }
  };

  const useBlob = async (blob: Blob, name: string, readingMsg: string): Promise<void> => {
    setBusy(readingMsg);
    try {
      const image = await decodeImage(blob);
      if (!alive) return;
      setPendingSource({
        kind: 'upload',
        name,
        aspect: guessAspect(image.width, image.height),
        image,
        blob,
      });
      navigate('#/setup');
    } catch (err) {
      console.warn('Image decode failed', err);
      setBusy(null);
      toast(
        err instanceof ImageTooLargeError
          ? userMessage(err)
          : 'This image format is not supported on this device.',
        3500,
      );
    }
  };

  const urlInput = h('input', {
    type: 'url',
    class: 'url-input',
    placeholder: 'https://example.com/photo.jpg',
    inputmode: 'url',
    autocomplete: 'off',
    'aria-label': 'Image URL',
  });
  const urlForm = h(
    'form',
    { class: 'url-form' },
    urlInput,
    h('button', { type: 'submit', class: 'chip' }, 'Open'),
  );
  urlForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const parsed = parseImageUrl(urlInput.value);
    if (!parsed) {
      toast('Enter a full https link to an image.', 3000);
      return;
    }
    setBusy('Downloading image…');
    let blob: Blob;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), URL_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(parsed.href, {
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const declared = Number(res.headers.get('content-length'));
      if (declared > MAX_UPLOAD_BYTES) throw new TooLargeError();
      blob = await readCapped(res, MAX_UPLOAD_BYTES, ctrl);
    } catch (err) {
      console.warn('URL import failed', err);
      setBusy(null);
      if (err instanceof TooLargeError) {
        toast('That image is larger than 20 MB. Please pick a smaller one.', 3500);
      } else {
        toast(
          'Could not download that image. The site may block other apps from loading it; try saving it and uploading instead.',
          4500,
        );
      }
      return;
    } finally {
      clearTimeout(timer);
    }
    if (!alive) return;
    await useBlob(blob, nameFromUrl(parsed), 'Reading image…');
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || busy) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast('That image is larger than 20 MB. Please pick a smaller one.', 3500);
      return;
    }
    await useBlob(file, nameFromFile(file.name), 'Reading photo…');
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
        settingsButton(),
      ),
      h(
        'div',
        { class: 'scroll' },
        h(
          'button',
          { type: 'button', class: 'upload-card', on: { click: () => navigate('#/draw/new') } },
          icon('brush'),
          h('span', {}, h('strong', {}, 'Make my own'), h('small', {}, 'Draw a mosaic freehand')),
        ),
        h(
          'label',
          { class: 'upload-card', for: 'upload-input' },
          icon('upload'),
          h('span', {}, h('strong', {}, 'Upload a photo'), h('small', {}, 'Stays on your device')),
        ),
        fileInput,
        urlForm,
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
      console.warn('Library failed to load', err);
      if (alive)
        grid.replaceChildren(
          h('p', { class: 'empty' }, `Library unavailable: ${userMessage(err)}`),
        );
    });

  return () => {
    alive = false;
  };
}
