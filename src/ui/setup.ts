/**
 * Setup screen (`#/setup`): crop editor, aspect, palette mode, max colors and dither, a debounced
 * worker-computed mosaic preview, and Start, which creates the save. Needs a pending source
 * from the source screen; without one it redirects to `#/new`.
 */

import { quantizeInWorker } from '../engine/client';
import { hexToRgb } from '../engine/color';
import { cropAndResample } from '../engine/resample';
import { panelCountOf, panelGridOf, studDims } from '../game';
import { renderMosaicToCanvas } from '../render/mosaicImage';
import { devicePixelRatioSafe } from '../render/motion';
import { newId } from '../storage/id';
import { getSettings, setSettings } from '../storage/settings';
import {
  type Aspect,
  EMPTY,
  MAX_COLORS,
  MIN_COLORS,
  type Mosaic,
  type PaletteMode,
  type PictureSave,
  SAVE_SCHEMA_VERSION,
  SIZE_OPTIONS,
} from '../types';
import { h, icon, iconButton, toast } from './dom';
import {
  aspectRatio,
  type CropState,
  clampCrop,
  cropRectFor,
  defaultCrop,
  flattenAlpha,
  hasTransparency,
  routeHash,
  userMessage,
} from './pure';
import { createSave } from './saves';
import type { Cleanup, ScreenContext } from './screen';
import { settingsButton } from './settingsSheet';
import { getPendingSource, setPendingSource } from './state';

const ASPECTS: Array<{ value: Aspect; label: string }> = [
  { value: '1:1', label: 'Square' },
  { value: '3:4', label: 'Portrait' },
  { value: '4:3', label: 'Landscape' },
];

/** Quick background swatches shown when the source has transparency; the color input allows any color. */
const BG_SWATCHES: Array<{ hex: string; label: string }> = [
  { hex: '#000000', label: 'Black' },
  { hex: '#ffffff', label: 'White' },
];

/**
 * Mounts the setup screen (route `#/setup`) for the pending source. The returned Cleanup stops
 * the crop-stage ResizeObserver, cancels a pending preview, and ignores in-flight previews.
 */
export function mountSetup({ root, navigate }: ScreenContext): Cleanup {
  const src = getPendingSource();
  if (!src) {
    queueMicrotask(() => navigate('#/new', { replace: true }));
    return () => undefined;
  }
  const img = src.image;
  const hasAlpha = hasTransparency(img.data);
  let bgHex = '#000000';
  let aspect: Aspect = src.aspect;
  let sizeScale = 1;
  let mode: PaletteMode = getSettings().paletteMode;
  let maxColors = getSettings().maxColors;
  let dither = getSettings().dither;
  let crop: CropState = clampCrop(
    img.width,
    img.height,
    aspect,
    defaultCrop(img.width, img.height, src.crop),
  );
  let alive = true;
  let token = 0;
  let latest: Promise<Mosaic> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let starting = false;

  // Source bitmap for drawing the crop stage.
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const sctx = srcCanvas.getContext('2d');
  if (!sctx) {
    // Mounted synchronously by the router, which does not catch throws.
    toast('This device could not prepare the picture. Please try again.', 4000);
    queueMicrotask(() => navigate('#/new', { replace: true }));
    return () => undefined;
  }
  // Re-composites the background behind transparent pixels; putImageData restores the original
  // alpha on every call, so repainting stays idempotent.
  const paintSource = (): void => {
    sctx.putImageData(img, 0, 0);
    sctx.globalCompositeOperation = 'destination-over';
    sctx.fillStyle = bgHex;
    sctx.fillRect(0, 0, img.width, img.height);
    sctx.globalCompositeOperation = 'source-over';
  };
  paintSource();

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
  const sizeCtl = segmented<'1' | '2' | '3'>(
    'Size',
    SIZE_OPTIONS.map((o) => ({ value: `${o.scale}` as '1' | '2' | '3', label: o.label })),
    () => `${sizeScale}` as '1' | '2' | '3',
    (v) => {
      sizeScale = Number(v);
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

  const colorsValue = h('output', { class: 'colors-value' }, String(maxColors));
  const colorsInput = h('input', {
    type: 'range',
    min: String(MIN_COLORS),
    max: String(MAX_COLORS),
    step: '1',
    value: String(maxColors),
    class: 'colors-range',
    'aria-label': 'Maximum colors',
  });
  colorsInput.addEventListener('input', () => {
    maxColors = Number(colorsInput.value);
    colorsValue.textContent = String(maxColors);
    setSettings({ maxColors });
    schedulePreview();
  });
  const colorsCtl = h(
    'label',
    { class: 'colors-ctl' },
    h('span', {}, 'Max colors'),
    colorsInput,
    colorsValue,
  );

  const ditherInput = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
  ditherInput.checked = dither;
  ditherInput.addEventListener('change', () => {
    dither = ditherInput.checked;
    setSettings({ dither });
    schedulePreview();
  });
  const ditherCtl = h(
    'label',
    { class: 'setting-row' },
    h('span', {}, h('strong', {}, 'Dither'), h('small', {}, 'Smoother gradients')),
    ditherInput,
  );

  const bgSwatches = h('div', {
    class: 'swatches',
    role: 'radiogroup',
    'aria-label': 'Background',
  });
  const bgInput = h('input', {
    type: 'color',
    value: bgHex,
    'aria-label': 'Custom background color',
  });
  const setBg = (hex: string): void => {
    bgHex = hex;
    bgInput.value = hex;
    for (const el of bgSwatches.children) {
      const on = el instanceof HTMLButtonElement && el.dataset.hex === hex;
      el.setAttribute('aria-checked', String(on));
      el.classList.toggle('on', on);
    }
    paintSource();
    drawStage();
    schedulePreview();
  };
  for (const { hex, label } of BG_SWATCHES) {
    const b = h('button', {
      type: 'button',
      role: 'radio',
      class: hex === bgHex ? 'swatch on' : 'swatch',
      'aria-checked': String(hex === bgHex),
      'aria-label': label,
      'data-tip': label,
    });
    b.style.background = hex;
    b.dataset.hex = hex;
    b.addEventListener('click', () => setBg(hex));
    bgSwatches.append(b);
  }
  bgInput.addEventListener('input', () => setBg(bgInput.value));
  bgSwatches.append(bgInput);
  const bgCtl = h(
    'div',
    { class: 'setting-row column' },
    h('span', {}, h('strong', {}, 'Background'), h('small', {}, 'Behind transparent areas')),
    bgSwatches,
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
        settingsButton(),
      ),
      h(
        'div',
        { class: 'setup-body' },
        h('div', { class: 'setup-crop' }, stageWrap, aspectCtl, sizeCtl),
        h(
          'div',
          { class: 'setup-side' },
          modeCtl,
          h(
            'p',
            { class: 'muted small' },
            'Parts lists for buying bricks (BrickLink, Rebrickable) are only available in LEGO colors.',
          ),
          colorsCtl,
          ditherCtl,
          ...(hasAlpha ? [bgCtl] : []),
          preview,
          previewNote,
          startBtn,
        ),
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
    const { cols, rows } = panelGridOf(aspect, sizeScale);
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
    const dims = studDims(aspect, sizeScale);
    const rect = cropRectFor(img.width, img.height, aspect, crop);
    const pixels = cropAndResample(img, rect, dims.width, dims.height);
    if (hasAlpha) flattenAlpha(pixels, hexToRgb(bgHex));
    return quantizeInWorker(pixels, dims.width, dims.height, mode, maxColors, dither);
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
      previewNote.textContent = `${m.width}×${m.height} studs · ${panelCountOf(aspect, sizeScale)} panels · ${m.palette.length} colors`;
      startBtn.disabled = false;
    }).catch((err: unknown) => {
      if (!alive || my !== token) return;
      previewNote.textContent = `Preview failed: ${userMessage(err)}`;
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
      const nowMs = Date.now();
      const save: PictureSave = {
        schemaVersion: SAVE_SCHEMA_VERSION,
        id: newId(),
        createdAt: nowMs,
        updatedAt: nowMs,
        name: src.name,
        sourceImageId: src.kind === 'library' ? `library:${src.slug}` : '',
        aspect,
        paletteMode: mode,
        origin: 'photo',
        palette: m.palette,
        width: m.width,
        height: m.height,
        target: m.target,
        placed: new Uint8Array(m.width * m.height).fill(EMPTY),
        panelElapsedMs: new Array<number>(panelCountOf(aspect, sizeScale)).fill(0),
      };
      await createSave(save, src.kind === 'upload' ? src.blob : undefined);
      setPendingSource(null);
      navigate(routeHash({ name: 'overview', id: save.id }), { replace: true });
    } catch (err) {
      starting = false;
      startBtn.disabled = false;
      console.error(err);
      toast(`Could not start: ${userMessage(err)}`, 4000);
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
