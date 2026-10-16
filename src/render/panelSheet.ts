/**
 * Printable building sheets: one numbered 16x16 grid page per panel (the target for photo
 * saves, the placed dots for drawn ones), each cell carrying its palette symbol, empty
 * cells left blank, with a legend mapping symbol to color name and count. The full guide
 * export also composes an overview page (the whole picture with panel seams and numbers),
 * a frame page (the raised frame built layer by layer with the exact pieces per side) and
 * an assembly page (rows with connectors, joining rows, the raised frame, hanging hooks).
 */

import { assemblyPlanOfGrid, effectiveCells, gridOfDims, panelCount, panelOrigin } from '../game';
import { EMPTY, PANEL_SIZE, type PictureSave } from '../types';
import { luminance } from './color';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const INK = '#1b1b1b';

/** Symbol ink that reads on a cell of this color. */
function symbolInk(hex: string): string {
  return luminance(hex) > 0.45 ? INK : '#fff';
}

/**
 * Render the building sheet for one panel. `labels`, `symbols` and `counts` are indexed by
 * palette index; `counts` is the panel's per-color dot count (panelColorCounts).
 */
export function renderPanelSheet(
  save: PictureSave,
  panelIndex: number,
  labels: string[],
  symbols: string[],
  counts: number[],
  cellPx = 40,
): HTMLCanvasElement {
  const c = Math.max(8, Math.round(cellPx));
  const margin = Math.round(c * 0.5);
  const gutter = c;
  const grid = c * PANEL_SIZE;
  const titleSize = Math.round(c * 0.6);
  const subSize = Math.round(c * 0.4);
  const header = titleSize + subSize + Math.round(c * 0.5);
  const legendRow = Math.round(c * 0.8);
  const swatch = Math.round(c * 0.6);
  const gap = Math.round(c * 0.25);
  const labelFont = `${Math.round(c * 0.36)}px ${FONT}`;
  const countFont = `bold ${Math.round(c * 0.36)}px ${FONT}`;

  const used = counts
    .map((count, i) => ({ i, count }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.i - b.i);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  // Size the legend columns from the widest label and count before sizing the canvas.
  ctx.font = labelFont;
  const labelW = Math.max(0, ...used.map((e) => ctx.measureText(labels[e.i]).width));
  ctx.font = countFont;
  const countW = Math.max(0, ...used.map((e) => ctx.measureText(String(e.count)).width));
  const contentW = gutter + grid;
  const colW = Math.ceil(swatch + gap + labelW + gap * 2 + countW + gap * 2);
  const cols = Math.max(1, Math.min(used.length, Math.floor(contentW / colW)));
  const legendRows = Math.ceil(used.length / cols);
  const legendTop = margin + header + gutter + grid + margin;

  canvas.width = margin * 2 + contentW;
  canvas.height = legendTop + legendRows * legendRow + margin;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';

  // Header.
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.font = `bold ${titleSize}px ${FONT}`;
  ctx.fillText(save.name, margin, margin + titleSize / 2);
  ctx.font = `${subSize}px ${FONT}`;
  ctx.fillStyle = '#555';
  ctx.fillText(
    `Panel ${panelIndex + 1} of ${panelCount(save)}`,
    margin,
    margin + titleSize + gap + subSize / 2,
  );

  const gx = margin + gutter;
  const gy = margin + header + gutter;

  // Column and row numbers.
  ctx.fillStyle = '#555';
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(c * 0.36)}px ${FONT}`;
  for (let k = 0; k < PANEL_SIZE; k++) {
    ctx.fillText(String(k + 1), gx + k * c + c / 2, gy - gutter / 2);
    ctx.fillText(String(k + 1), margin + gutter / 2, gy + k * c + c / 2);
  }

  // Cells with symbols.
  const o = panelOrigin(save, panelIndex);
  const cells = effectiveCells(save);
  ctx.font = `bold ${Math.round(c * 0.45)}px ${FONT}`;
  for (let y = 0; y < PANEL_SIZE; y++) {
    for (let x = 0; x < PANEL_SIZE; x++) {
      const idx = cells[(o.y + y) * save.width + o.x + x];
      if (idx === EMPTY) continue;
      const hex = save.palette[idx].hex;
      ctx.fillStyle = hex;
      ctx.fillRect(gx + x * c, gy + y * c, c, c);
      ctx.fillStyle = symbolInk(hex);
      ctx.fillText(symbols[idx], gx + x * c + c / 2, gy + y * c + c / 2);
    }
  }

  // Grid lines, heavier every 4 cells for counting.
  for (let k = 0; k <= PANEL_SIZE; k++) {
    const heavy = k % 4 === 0;
    ctx.strokeStyle = heavy ? INK : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = heavy ? 2 : 1;
    const p = k * c + (heavy ? 0 : 0.5);
    ctx.beginPath();
    ctx.moveTo(gx + p, gy);
    ctx.lineTo(gx + p, gy + grid);
    ctx.moveTo(gx, gy + p);
    ctx.lineTo(gx + grid, gy + p);
    ctx.stroke();
  }

  // Legend: swatch with symbol, name, count; filled column by column.
  used.forEach((e, n) => {
    const lx = margin + Math.floor(n / legendRows) * colW;
    const cy = legendTop + (n % legendRows) * legendRow + legendRow / 2;
    const hex = save.palette[e.i].hex;
    ctx.fillStyle = hex;
    ctx.fillRect(lx, cy - swatch / 2, swatch, swatch);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx + 0.5, cy - swatch / 2 + 0.5, swatch - 1, swatch - 1);
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(c * 0.36)}px ${FONT}`;
    ctx.fillStyle = symbolInk(hex);
    ctx.fillText(symbols[e.i], lx + swatch / 2, cy);
    ctx.textAlign = 'left';
    ctx.font = labelFont;
    ctx.fillStyle = INK;
    ctx.fillText(labels[e.i], lx + swatch + gap, cy);
    ctx.textAlign = 'right';
    ctx.font = countFont;
    ctx.fillText(String(e.count), lx + colW - gap * 2, cy);
  });

  return canvas;
}

/**
 * Guide overview page: the whole picture at a glance with the panel seams drawn in and
 * every panel region carrying the number of its building sheet, so the builder can map
 * sheets to positions before building.
 */
export function renderGuideOverview(save: PictureSave, cellPx = 8): HTMLCanvasElement {
  const cell = Math.max(2, Math.round(cellPx));
  const margin = Math.round(cell * 2);
  const gutter = cell * 2;
  const titleSize = Math.round(cell * 4.5);
  const subSize = Math.round(cell * 2.6);
  const header = titleSize + subSize + Math.round(cell * 2);
  const { cols, rows } = gridOfDims(save.width, save.height);
  const studsW = save.width;
  const studsH = save.height;
  const picW = studsW * cell;
  const picH = studsH * cell;
  const gx = margin + gutter;
  const gy = margin + header;
  const labelSize = Math.round(cell * 3.2);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  canvas.width = margin * 2 + gutter * 2 + picW;
  canvas.height = gy + picH + Math.round(cell * 6);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.font = `bold ${titleSize}px ${FONT}`;
  ctx.fillText(save.name, margin, margin + titleSize / 2);
  ctx.font = `${subSize}px ${FONT}`;
  ctx.fillStyle = '#555';
  ctx.fillText('Overview', margin, margin + titleSize + subSize / 2);

  // The picture as flat cells (crisp at print size); EMPTY stays the white page.
  const cells = effectiveCells(save);
  for (let y = 0; y < studsH; y++) {
    for (let x = 0; x < studsW; x++) {
      const idx = cells[y * save.width + x];
      if (idx === EMPTY) continue;
      ctx.fillStyle = save.palette[idx].hex;
      ctx.fillRect(gx + x * cell, gy + y * cell, cell, cell);
    }
  }

  // Border box, then seams only between panels.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(gx, gy, picW, picH);
  ctx.lineWidth = 1.5;
  for (let k = 1; k < cols; k++) {
    const x = gx + k * PANEL_SIZE * cell;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x, gy + picH);
    ctx.stroke();
  }
  for (let k = 1; k < rows; k++) {
    const y = gy + k * PANEL_SIZE * cell;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx + picW, y);
    ctx.stroke();
  }

  // Panel-number badges at each panel center; 1x1 grids get exactly one badge and no
  // internal seams (the seam loops above simply do not run).
  for (let p = 0; p < cols * rows; p++) {
    const o = panelOrigin(save, p);
    const cx = gx + (o.x + PANEL_SIZE / 2) * cell;
    const cy = gy + (o.y + PANEL_SIZE / 2) * cell;
    const half = labelSize * 0.75;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.font = `bold ${labelSize}px ${FONT}`;
    ctx.fillText(String(p + 1), cx, cy);
  }

  return canvas;
}

/** Greedy word wrap against measured width at the given font. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  font: string,
  text: string,
  maxW: number,
): string[] {
  ctx.font = font;
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(next).width <= maxW) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Plan view of the backing: the per-panel 16x16 plates on a shaded border ring. */
function drawBacking(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  u: number,
  t: number,
  cols: number,
  rows: number,
): void {
  const w = (16 * cols + 2) * u;
  const d = (16 * rows + 2) * u;
  ctx.fillStyle = '#d9d9d9';
  ctx.fillRect(x, y, w, d);
  for (let py = 0; py < rows; py++) {
    for (let px = 0; px < cols; px++) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + t + 16 * px * u, y + t + 16 * py * u, 16 * u, 16 * u);
      ctx.strokeRect(x + t + 16 * px * u + 0.5, y + t + 16 * py * u + 0.5, 16 * u - 1, 16 * u - 1);
    }
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, d - 1);
}

/** Plan view of one ring layer: each side strip segmented by its piece lengths. */
function drawRingSides(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  u: number,
  t: number,
  sides: number[][],
  width: number,
  depth: number,
): void {
  const w = width * u;
  const d = depth * u;
  const strip = (sx: number, sy: number, pieces: number[], horiz: boolean): void => {
    let p = horiz ? sx : sy;
    pieces.forEach((len, i) => {
      ctx.fillStyle = i % 2 ? '#c9c9c9' : '#9a9a9a';
      if (horiz) ctx.fillRect(p, sy, len * u, t);
      else ctx.fillRect(sx, p, t, len * u);
      p += len * u;
    });
  };
  strip(x, y, sides[0], true);
  strip(x, y + d - t, sides[1], true);
  strip(x, y + t, sides[2], false);
  strip(x + w - t, y + t, sides[3], false);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, d - 1);
}

/** Plan view of the finished frame: ring, inset tile band, four studded 2x2 corners. */
function drawCap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  u: number,
  t: number,
  width: number,
  depth: number,
): void {
  const w = width * u;
  const d = depth * u;
  ctx.fillStyle = '#d9d9d9';
  ctx.fillRect(x, y, w, d);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + t, y + t, w - 2 * t, d - 2 * t);
  // Tile band on the ring top, inset 2 studs per end.
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(x + 2 * u, y, (width - 4) * u, t);
  ctx.fillRect(x + 2 * u, y + d - t, (width - 4) * u, t);
  ctx.fillRect(x, y + 2 * u, t, (depth - 4) * u);
  ctx.fillRect(x + w - t, y + 2 * u, t, (depth - 4) * u);
  // Studded corner caps over the four 2x2 corners.
  const cap = Math.max(4, 2 * u);
  ctx.fillStyle = INK;
  for (const [kx, ky] of [
    [x, y],
    [x + w - cap, y],
    [x, y + d - cap],
    [x + w - cap, y + d - cap],
  ]) {
    ctx.fillRect(kx, ky, cap, cap);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, d - 1);
}

/**
 * Frame page: builds the raised frame from the pieces the Buy parts export lists, layer
 * by layer with the exact pieces per side. The ring piece runs come in via `ring` (the
 * frameRingPieces output) because render/ must not import ui/.
 */
export function renderFrameSheet(
  save: PictureSave,
  ring: number[][][],
  cellPx = 40,
): HTMLCanvasElement {
  const c = Math.max(8, Math.round(cellPx));
  const margin = Math.round(c * 0.5);
  const titleSize = Math.round(c * 0.6);
  const subSize = Math.round(c * 0.4);
  const stepFont = `bold ${Math.round(c * 0.42)}px ${FONT}`;
  const textFont = `${Math.round(c * 0.4)}px ${FONT}`;
  const lineStep = c * 0.45;
  const bodyW = c * 16;

  const { cols, rows } = gridOfDims(save.width, save.height);
  const width = 16 * cols + 2;
  const depth = 16 * rows + 2;
  const [border, bricks, plates, cap] = ring;

  /** "3 x brick 1x16 + 1 x brick 1x2" from one run's piece lengths. */
  const listPieces = (pieces: number[], kind: string, join = ' + '): string => {
    const tally = new Map<number, number>();
    for (const p of pieces) tally.set(p, (tally.get(p) ?? 0) + 1);
    return [...tally]
      .sort((a, b) => b[0] - a[0])
      .map(([len, n]) => `${n} x ${kind} 1x${len}`)
      .join(join);
  };

  const borderTotals = listPieces(border.flat(), 'plate', ', ');
  const capLong = listPieces(cap[0], 'tile');
  const capShort = listPieces(cap[2], 'tile');
  const capRuns =
    width - 4 === depth - 4
      ? `per side ${capLong}`
      : `top and bottom ${capLong} each, sides ${capShort} each`;

  const steps: Array<{ title: string; body: string; diagram: 'backing' | 'ring' | 'cap' | null }> =
    [
      {
        title: 'Lay the backing',
        body: `One 16x16 plate per panel (${cols * rows} here), butted into a ${width} x ${depth}-stud square, plus a 1-stud border ring of plates - ${borderTotals}.`,
        diagram: 'backing',
      },
      {
        title: 'Raise the brick ring',
        body: `On the border ring lay one layer of bricks, longest piece first: long runs top and bottom (${width} studs, ${listPieces(bricks[0], 'brick')} each), short runs left and right (${depth - 2} studs, ${listPieces(bricks[2], 'brick')} each). Lay the two long runs first, then the short runs between them.`,
        diagram: 'ring',
      },
      {
        title: 'Add the plate layer',
        body: `The same plates as the border ring, laid over the bricks: long runs ${listPieces(plates[0], 'plate')} each, short runs ${listPieces(plates[2], 'plate')} each.`,
        diagram: null,
      },
      {
        title: 'Cap with tiles',
        body: `A smooth tile ring one plate above the dots, inset 2 studs per end - ${capRuns}. The four 2x2 corners stay studded: a plate 2x2 on each corner bonds the ring and holds the hangers.`,
        diagram: 'cap',
      },
    ];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  // Size the page from the wrapped bodies and diagram, then draw (resizing resets state).
  // u is the schematic's studs-per-pixel scale; t thickens the 1-stud ring strips so they
  // read at print size, overdrawn inward — the diagrams are schematics, not blueprints.
  const u = Math.min((c * 11) / width, (c * 7) / depth);
  const t = Math.max(u, Math.round(c * 0.15));
  const diagramH = depth * u;
  ctx.font = textFont;
  const intro = wrapLines(
    ctx,
    textFont,
    'All frame pieces come in your frame color; counts match the Buy parts list.',
    bodyW,
  );
  const bodies = steps.map((s) => wrapLines(ctx, textFont, s.body, bodyW));

  let h = margin + titleSize + subSize + c; // header
  h += intro.length * lineStep + c * 0.45;
  steps.forEach((s, i) => {
    h += c * 0.9; // step title
    h += bodies[i].length * lineStep;
    h += s.diagram ? diagramH + c * 0.35 : c * 0.2;
  });
  h += c * 0.9; // footer
  h += margin;

  canvas.width = margin * 2 + c * 16;
  canvas.height = Math.ceil(h);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  ctx.fillStyle = INK;
  ctx.font = `bold ${titleSize}px ${FONT}`;
  ctx.fillText(save.name, margin, margin + titleSize / 2);
  ctx.font = `${subSize}px ${FONT}`;
  ctx.fillStyle = '#555';
  ctx.fillText('Frame', margin, margin + titleSize + subSize / 2);

  let y = margin + titleSize + subSize + c;
  for (const line of intro) {
    ctx.fillText(line, margin, y);
    y += lineStep;
  }
  y += c * 0.45;

  steps.forEach((s, i) => {
    ctx.fillStyle = INK;
    ctx.font = stepFont;
    ctx.fillText(`${i + 1}. ${s.title}`, margin, y);
    y += c * 0.9;
    ctx.fillStyle = '#555';
    ctx.font = textFont;
    for (const line of bodies[i]) {
      ctx.fillText(line, margin, y);
      y += lineStep;
    }
    if (s.diagram === 'backing') drawBacking(ctx, margin, y, u, t, cols, rows);
    else if (s.diagram === 'ring') drawRingSides(ctx, margin, y, u, t, bricks, width, depth);
    else if (s.diagram === 'cap') drawCap(ctx, margin, y, u, t, width, depth);
    y += s.diagram ? diagramH + c * 0.35 : c * 0.2;
  });

  ctx.fillStyle = '#555';
  ctx.font = textFont;
  ctx.fillText('Next: Assembly - join the panels and set them on this frame.', margin, y);

  return canvas;
}

/**
 * Assembly page: how the built panels become a hangable picture — build rows of panels
 * joined with black connectors, join the rows the same way, set them on a raised frame
 * (backing plate, brick ring, plate layer, tile cap), then attach the hanging hooks.
 * Counts come from assemblyPlanOf; connector bars are drawn on the schematics.
 */
export function renderAssemblySheet(save: PictureSave, cellPx = 40): HTMLCanvasElement {
  const c = Math.max(8, Math.round(cellPx));
  const margin = Math.round(c * 0.5);
  const titleSize = Math.round(c * 0.6);
  const subSize = Math.round(c * 0.4);
  const stepFont = `bold ${Math.round(c * 0.42)}px ${FONT}`;
  const textFont = `${Math.round(c * 0.4)}px ${FONT}`;
  const plan = assemblyPlanOfGrid(gridOfDims(save.width, save.height));
  const box = Math.round(c * 1.4);
  const bar = Math.round(c * 0.3);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const contentW = margin * 2 + c * 16; // same width as a panel sheet
  canvas.width = contentW;
  canvas.height = Math.round(c * 26);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.font = `bold ${titleSize}px ${FONT}`;
  ctx.fillText(save.name, margin, margin + titleSize / 2);
  ctx.font = `${subSize}px ${FONT}`;
  ctx.fillStyle = '#555';
  ctx.fillText('Assembly', margin, margin + titleSize + subSize / 2);

  const bodyTop = margin + titleSize + subSize + c;

  // Step 1: build rows joined with black connectors.
  ctx.font = stepFont;
  ctx.fillStyle = INK;
  ctx.fillText('1.', margin, bodyTop);
  ctx.fillText(`Build ${plan.rows} rows of ${plan.cols} panels`, margin + c * 0.7, bodyTop);
  ctx.font = textFont;
  ctx.fillStyle = '#555';
  ctx.fillText(
    `Connect the panels back-to-back with black connectors - 3 per edge,`,
    margin,
    bodyTop + c * 0.9,
  );
  ctx.fillText(`${plan.rowJoints} black connectors in all.`, margin, bodyTop + c * 1.7);

  // Schematic: one row of panel squares with three black connectors per shared edge.
  const rowY = bodyTop + c * 2.6;
  ctx.fillStyle = INK;
  for (let i = 0; i < plan.cols - 1; i++) {
    const bx = margin + (i + 1) * box + i * bar;
    for (const fy of [0.15, 0.5, 0.85]) {
      ctx.fillRect(bx, rowY + box * fy - bar / 2, bar, bar);
    }
  }
  for (let i = 0; i < plan.cols; i++) {
    const px = margin + i * (box + bar);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px, rowY, box, box);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, rowY + 1, box - 2, box - 2);
    ctx.fillStyle = INK;
    ctx.font = stepFont;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), px + box / 2, rowY + box / 2);
    ctx.textAlign = 'left';
  }

  // Step 2: join the rows with black connectors at every panel seam.
  const s2y = rowY + box + c;
  ctx.font = stepFont;
  ctx.fillStyle = INK;
  ctx.fillText('2.', margin, s2y);
  ctx.fillText('Join the rows', margin + c * 0.7, s2y);
  ctx.font = textFont;
  ctx.fillStyle = '#555';
  ctx.fillText(
    `Join the rows with ${plan.joinConnectors} black connectors - 3 per edge.`,
    margin,
    s2y + c * 0.9,
  );

  // Schematic: two stacked rows with three black connectors per panel of the seam.
  const gapY = s2y + c * 1.8;
  for (let i = 0; i < plan.cols; i++) {
    const px = margin + i * (box + bar);
    for (const fx of [0.15, 0.5, 0.85]) {
      ctx.fillStyle = INK;
      ctx.fillRect(px + box * fx - bar * 0.3, gapY + box * 0.55, bar * 0.6, box * 0.9);
    }
  }
  for (const ry of [gapY, gapY + box * 0.9 + bar]) {
    for (let i = 0; i < plan.cols; i++) {
      const px = margin + i * (box + bar);
      ctx.fillStyle = '#fff';
      ctx.fillRect(px, ry, box, box * 0.55);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, ry + 1, box - 2, box * 0.55 - 2);
    }
  }

  // Step 3: the raised frame; the plan view shows the backing, its border ring and the
  // four studded corner caps.
  const s3y = gapY + box * 0.9 + bar + box * 0.55 + c;
  ctx.font = stepFont;
  ctx.fillStyle = INK;
  ctx.fillText('3.', margin, s3y);
  ctx.fillText('Frame it', margin + c * 0.7, s3y);
  ctx.font = textFont;
  ctx.fillStyle = '#555';
  ctx.fillText(
    'Set the joined panels on a backing one stud larger all around, then raise a border',
    margin,
    s3y + c * 0.9,
  );
  ctx.fillText(
    'ring on its edge - bricks to panel-top height, then plates, then a smooth tile cap',
    margin,
    s3y + c * 1.7,
  );
  ctx.fillText(
    'one plate above the dots. Leave the four cap corners studded for hangers.',
    margin,
    s3y + c * 2.5,
  );

  // Plan view: the backing rectangle, its raised border ring and the studded corners.
  const frameY = s3y + c * 3.4;
  const u = Math.min((c * 3) / plan.cols, (c * 2) / plan.rows);
  const fw = plan.cols * u;
  const fh = plan.rows * u;
  const ring = Math.max(2, Math.round(u * 0.12));
  const cap = Math.max(4, ring * 2);
  ctx.fillStyle = '#ddd';
  ctx.fillRect(margin, frameY, fw, fh);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(margin, frameY, fw, fh);
  ctx.fillStyle = '#fff';
  ctx.fillRect(margin + ring, frameY + ring, fw - 2 * ring, fh - 2 * ring);
  ctx.strokeRect(margin + ring + 0.5, frameY + ring + 0.5, fw - 2 * ring - 1, fh - 2 * ring - 1);
  for (const [kx, ky] of [
    [margin, frameY],
    [margin + fw - cap, frameY],
    [margin, frameY + fh - cap],
    [margin + fw - cap, frameY + fh - cap],
  ]) {
    ctx.fillStyle = INK;
    ctx.fillRect(kx, ky, cap, cap);
  }

  // Step 4: hanging hooks on the top row.
  const s4y = frameY + fh + c;
  ctx.font = stepFont;
  ctx.fillStyle = INK;
  ctx.fillText('4.', margin, s4y);
  ctx.fillText('Hang it', margin + c * 0.7, s4y);
  ctx.font = textFont;
  ctx.fillStyle = '#555';
  ctx.fillText(
    `Attach ${plan.hooks} hanging hooks to the top edge of the top row`,
    margin,
    s4y + c * 0.9,
  );
  ctx.fillText('(e.g. two sawtooth picture hangers, one near each end).', margin, s4y + c * 1.7);

  // Schematic: the top row in side view, a hanger bar attached near each end.
  const hookY = s4y + c * 2.9;
  ctx.fillStyle = INK;
  for (const hx of [margin + box * 0.25, margin + (plan.cols - 1) * (box + bar) + box * 0.75]) {
    ctx.fillRect(hx - bar * 1.5, hookY - bar * 2, bar * 3, bar * 2);
  }
  for (let i = 0; i < plan.cols; i++) {
    const px = margin + i * (box + bar);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px, hookY, box, box * 0.55);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, hookY + 1, box - 2, box * 0.55 - 2);
  }

  // Connectors and hooks are generic parts outside the palette; the exports stay
  // palette-only by decision (card 01a1091d803d) - say so on the page.
  ctx.fillStyle = '#555';
  ctx.font = textFont;
  ctx.fillText(
    'Black connectors and hooks are generic LEGO parts, not part of the color palette -',
    margin,
    hookY + box + c,
  );
  ctx.fillText('order them separately.', margin, hookY + box + c * 1.8);

  return canvas;
}
