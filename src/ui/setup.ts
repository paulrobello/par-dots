import { quantizeInWorker } from '../engine/client';
import { panelCount as aspectPanelCount, studDims } from '../engine/panels';
import { cropAndResample } from '../engine/resample';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { devicePixelRatioSafe } from '../render/motion';
import { putImage, StorageFullError } from '../storage/db';
import { newId } from '../storage/id';
import { getSettings, setSettings } from '../storage/settings';
import {
  type Aspect,
  EMPTY,
  LAYOUT,
  type Mosaic,
  type PaletteMode,
  type PictureSave,
} from '../types';
import { h, icon, iconButton, toast } from './dom';
import {
  aspectRatio,
  type CropState,
  clampCrop,
  cropRectFor,
  defaultCrop,
  routeHash,
} from './pure';
import type { Cleanup, ScreenContext } from './screen';
import { cacheSave, getPendingSource, persist, setPendingSource } from './state';

const ASPECTS: Array<{ value: Aspect; label: string }> = [
  { value: '1:1', label: 'Square' },
  { value: '3:4', label: 'Portrait' },
  { value: '4:3', label: 'Landscape' },
];

export function mountSetup({ root, navigate }: ScreenContext): Cleanup {
  const src = getPendingSource();
  if (!src) {
    queueMicrotask(() => navigate('#/new', { replace: true }));
    return () => undefined;
  }
  const img = src.image;
  let aspect: Aspect = src.aspect;
  let mode: PaletteMode = getSettings().paletteMode;
  let crop: CropState = defaultCrop(img.width, img.height);
  let alive = true;
  let token = 0;
  let latest: Promise<Mosaic> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let starting = false;

  // Source bitmap for drawing the crop stage.
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  srcCanvas.getContext('2d')?.putImageData(img, 0, 0);

  const stage = h('canvas', {
    class: 'crop-canvas',
    'aria-label': 'Crop area. Drag to move, pinch or scroll to zoom.',
    role: 'img',
  });
  const stageWrap = h('div', { class: 'crop-stage' }, stage);
  const preview = h('div', { class: 'preview-box', 'aria-live': 'polite' });
  const previewNote = h('p', { class: 'muted small center' }, 'Preparing preview…');
  const startBtn = h(
    'button',
    { type: 'button', class: 'btn primary big', disabled: true },
    icon('play'),
    'Start',
  );

  const segmented = <T extends string>(
    label: string,
    options: Array<{ value: T; label: string }>,
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement => {
    const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
    const buttons = options.map((o) => {
      const b = h('button', { type: 'button', role: 'radio', 'data-value': o.value }, o.label);
      b.addEventListener('click', () => {
        set(o.value);
        sync();
      });
      return b;
    });
    const sync = (): void => {
      for (const b of buttons) {
        const on = b.dataset.value === get();
        b.setAttribute('aria-checked', String(on));
        b.classList.toggle('on', on);
      }
    };
    sync();
    group.append(...buttons);
    return group;
  };

  const aspectCtl = segmented(
    'Aspect',
    ASPECTS,
    () => aspect,
    (v) => {
      aspect = v;
      crop = clampCrop(img.width, img.height, aspect, crop);
      drawStage();
      schedulePreview();
    },
  );
  const modeCtl = segmented<PaletteMode>(
    'Palette',
    [
      { value: 'lego', label: 'LEGO colors' },
      { value: 'free', label: 'Free colors' },
    ],
    () => mode,
    (v) => {
      mode = v;
      setSettings({ paletteMode: v });
      schedulePreview();
    },
  );

  root.append(
    h(
      'div',
      { class: 'screen setup' },
      h(
        'header',
        { class: 'topbar' },
        iconButton('back', 'Back to picture choice', () => navigate('#/new')),
        h('h1', { class: 'title' }, src.name),
        h('span', { class: 'spacer' }),
      ),
      h(
        'div',
        { class: 'setup-body' },
        h('div', { class: 'setup-crop' }, stageWrap, aspectCtl),
        h('div', { class: 'setup-side' }, modeCtl, preview, previewNote, startBtn),
      ),
    ),
  );

  // ---- crop stage drawing -------------------------------------------------
  let frame = { x: 0, y: 0, w: 0, h: 0 };
  let scale = 1;
  const drawStage = (): void => {
    const rect = stage.getBoundingClientRect();
    const dpr = devicePixelRatioSafe();
    const cw = Math.max(1, Math.round(rect.width * dpr));
    const ch = Math.max(1, Math.round(rect.height * dpr));
    if (stage.width !== cw) stage.width = cw;
    if (stage.height !== ch) stage.height = ch;
    const ctx = stage.getContext('2d');
    if (!ctx) return;
    const pad = 16;
    const r = aspectRatio(aspect);
    let fw = rect.width - pad * 2;
    let fh = fw / r;
    if (fh > rect.height - pad * 2) {
      fh = rect.height - pad * 2;
      fw = fh * r;
    }
    frame = { x: (rect.width - fw) / 2, y: (rect.height - fh) / 2, w: fw, h: fh };
    const c = cropRectFor(img.width, img.height, aspect, crop);
    scale = fw / c.w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      srcCanvas,
      frame.x - c.x * scale,
      frame.y - c.y * scale,
      img.width * scale,
      img.height * scale,
    );
    // Dim outside the frame.
    ctx.fillStyle = 'rgba(8,24,14,0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, rect.width, rect.height);
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
    // Panel grid guides.
    const { cols, rows } = LAYOUT[aspect];
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < cols; i++) {
      const x = frame.x + (frame.w * i) / cols;
      ctx.moveTo(x, frame.y);
      ctx.lineTo(x, frame.y + frame.h);
    }
    for (let i = 1; i < rows; i++) {
      const y = frame.y + (frame.h * i) / rows;
      ctx.moveTo(frame.x, y);
      ctx.lineTo(frame.x + frame.w, y);
    }
    ctx.stroke();
  };

  // ---- gestures -----------------------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  const applyCrop = (next: CropState): void => {
    crop = clampCrop(img.width, img.height, aspect, next);
    drawStage();
    schedulePreview();
  };
  const dist = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinchDist = dist();
  });
  stage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      pointers.set(e.pointerId, cur);
      applyCrop({
        zoom: crop.zoom,
        cx: crop.cx - (cur.x - prev.x) / scale,
        cy: crop.cy - (cur.y - prev.y) / scale,
      });
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const d = dist();
      if (pinchDist > 0 && d > 0) applyCrop({ ...crop, zoom: crop.zoom * (d / pinchDist) });
      pinchDist = d;
    }
  });
  const up = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    pinchDist = pointers.size === 2 ? dist() : 0;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      applyCrop({ ...crop, zoom: crop.zoom * Math.exp(-e.deltaY * 0.0015) });
    },
    { passive: false },
  );

  // ---- preview ------------------------------------------------------------
  const computeMosaic = (): Promise<Mosaic> => {
    const dims = studDims(aspect);
    const rect = cropRectFor(img.width, img.height, aspect, crop);
    const pixels = cropAndResample(img, rect, dims.width, dims.height);
    return quantizeInWorker(pixels, dims.width, dims.height, mode);
  };
  const runPreview = (): void => {
    const my = ++token;
    const p = computeMosaic();
    latest = p;
    startBtn.disabled = true;
    p.then((m) => {
      if (!alive || my !== token) return;
      const dpr = devicePixelRatioSafe();
      const box = preview.getBoundingClientRect();
      const cellCss = Math.max(3, Math.min(box.width / m.width, 280 / m.height));
      const canvas = renderMosaicToCanvas(m, cellCss * dpr, 'dots');
      canvas.style.width = `${Math.round(cellCss * m.width)}px`;
      canvas.style.height = `${Math.round(cellCss * m.height)}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Mosaic preview');
      preview.replaceChildren(canvas);
      previewNote.textContent = `${m.width}×${m.height} studs · ${aspectPanelCount(aspect)} panels · ${m.palette.length} colors`;
      startBtn.disabled = false;
    }).catch((err: unknown) => {
      if (!alive || my !== token) return;
      previewNote.textContent = `Preview failed: ${String(err)}`;
    });
  };
  const schedulePreview = (): void => {
    if (debounce) clearTimeout(debounce);
    startBtn.disabled = true;
    previewNote.textContent = 'Updating preview…';
    debounce = setTimeout(runPreview, 220);
  };

  startBtn.addEventListener('click', async () => {
    if (starting) return;
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
      runPreview();
    }
    const p = latest;
    if (!p) return;
    starting = true;
    startBtn.disabled = true;
    try {
      const m = await p;
      const sourceImageId =
        src.kind === 'library' ? `library:${src.slug}` : src.blob ? await putImage(src.blob) : '';
      const nowMs = Date.now();
      const save: PictureSave = {
        id: newId(),
        createdAt: nowMs,
        updatedAt: nowMs,
        name: src.name,
        sourceImageId,
        aspect,
        paletteMode: mode,
        palette: m.palette,
        width: m.width,
        height: m.height,
        target: m.target,
        placed: new Uint8Array(m.width * m.height).fill(EMPTY),
        panelElapsedMs: new Array<number>(aspectPanelCount(aspect)).fill(0),
      };
      await persist(save);
      cacheSave(save);
      setPendingSource(null);
      navigate(routeHash({ name: 'overview', id: save.id }), { replace: true });
    } catch (err) {
      starting = false;
      startBtn.disabled = false;
      toast(
        err instanceof StorageFullError ? err.message : `Could not start: ${String(err)}`,
        4000,
      );
    }
  });

  const ro = new ResizeObserver(() => drawStage());
  ro.observe(stageWrap);
  drawStage();
  runPreview();

  return () => {
    alive = false;
    ro.disconnect();
    if (debounce) clearTimeout(debounce);
  };
}
