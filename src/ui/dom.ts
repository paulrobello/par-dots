/** Minimal DOM helpers shared by screens: element builder, toast, confirm dialog, sheets. */

type AttrValue = string | number | boolean | undefined | null;
// The index signature has to admit `on`'s listener map; h() rejects an object on any other key.
type Attrs = { [k: string]: AttrValue | Record<string, EventListener> } & {
  on?: Record<string, EventListener>;
};
type Child = Node | string | null | undefined | false;

/** Create an element. `on*` function props become listeners; booleans toggle attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on' || v === undefined || v === null || v === false) continue;
    if (typeof v === 'object') throw new TypeError(`h(): unsupported attribute value for ${k}`);
    if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  const on = attrs.on;
  if (on) for (const [ev, fn] of Object.entries(on)) el.addEventListener(ev, fn);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

/** Inline SVG icon from a small path set (24x24 viewBox, stroke style). */
const ICONS = {
  back: 'M15 5l-7 7 7 7',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  eraser:
    'M7 21h13M5.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H8.5l-3-3a0 0 0 0 1 0 0z',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  swap: 'M8 3L4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  backup: 'M4 8h16v12H4zM6 4h12l2 4H4zM12 11v6M9 14l3 3 3-3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  restart: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5',
  play: 'M8 5l11 7-11 7z',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16',
  brush:
    'M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z',
  line: 'M5 19L19 5',
  box: 'M5 5h14v14H5z',
  ellipse: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14z',
  polygon: 'M12 3l8 6-3 10H7L4 9z',
  fill: 'M5 11l7-7 7 7-7 7zM18.5 15.5s2 2.3 2 3.7a2 2 0 0 1-4 0c0-1.4 2-3.7 2-3.7z',
  pipette:
    'M20.7 3.3a2.4 2.4 0 0 0-3.4 0L14 6.6l3.4 3.4 3.3-3.3a2.4 2.4 0 0 0 0-3.4zM12.6 8L5 15.6V19h3.4L16 11.4',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

/** Icon button with an accessible label. */
export function iconButton(
  name: IconName,
  label: string,
  onClick: (ev: MouseEvent) => void,
  cls = 'icon-btn',
): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, 'aria-label': label, 'data-tip': label });
  b.append(icon(name));
  b.addEventListener('click', onClick as EventListener);
  return b;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Brief message at the bottom of the screen, announced to screen readers. */
export function toast(message: string, ms = 1800): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el?.classList.remove('show'), ms);
}

/** Close functions of every open overlay (sheets, celebrations), so navigation can dismiss them. */
const openOverlays = new Set<() => void>();

/** Track an open overlay; returns a function that stops tracking it. */
export function registerOverlay(close: () => void): () => void {
  openOverlays.add(close);
  return () => {
    openOverlays.delete(close);
  };
}

/** Close every open overlay, running each one's normal close path. */
export function closeAllOverlays(): void {
  for (const c of [...openOverlays]) c();
}

export function isOverlayOpen(): boolean {
  return openOverlays.size > 0;
}

/** Modal sheet from the bottom. Returns a close function. `onClose` runs once on any close. */
export function openSheet(
  title: string,
  body: Node,
  onClose?: () => void,
): { close: () => void; root: HTMLElement } {
  const prevFocus = document.activeElement as HTMLElement | null;
  const closeBtn = iconButton('close', 'Close', () => close());
  const panel = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), closeBtn),
    body,
  );
  const backdrop = h('div', { class: 'backdrop' }, panel);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    unregister();
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    prevFocus?.focus?.();
    onClose?.();
  }
  const unregister = registerOverlay(close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  closeBtn.focus();
  return { close, root: backdrop };
}

/** Confirmation dialog; resolves true when the destructive action is confirmed. */
export function confirmDialog(
  title: string,
  message: string,
  confirmLabel: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { type: 'button', class: 'btn danger' }, confirmLabel);
    const cancel = h('button', { type: 'button', class: 'btn ghost' }, 'Cancel');
    const s = openSheet(
      title,
      h('div', { class: 'confirm' }, h('p', {}, message), h('div', { class: 'row' }, cancel, ok)),
      () => resolve(result),
    );
    ok.addEventListener('click', () => {
      result = true;
      s.close();
    });
    cancel.addEventListener('click', () => s.close());
  });
}

/** Trigger a download of a blob with a filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Canvas to a sized <img>-like element: returns the canvas itself styled as a thumbnail. */
export function asThumb(canvas: HTMLCanvasElement, label: string): HTMLCanvasElement {
  canvas.classList.add('thumb-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  return canvas;
}
