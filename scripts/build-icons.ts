// Renders the favicon and PWA icon set from one SVG master. Run: bun run scripts/build-icons.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

type Dot = { c: string; ring: string; side: string };
const RED: Dot = { c: '#d01012', ring: '#ff5a4f', side: '#7e0a0b' };
const YELLOW: Dot = { c: '#f5cd2f', ring: '#fff08a', side: '#9a7a12' };
const BLUE: Dot = { c: '#0a6bc2', ring: '#5fb2ff', side: '#053a6b' };
const WHITE: Dot = { c: '#f2f3f2', ring: '#ffffff', side: '#9ea4a6' };

/** Icon art on a 512 canvas. `inset` shrinks the plate for maskable safe zones. */
function iconSvg(opts: { rounded: boolean; inset: number; bg: boolean }): string {
  const { rounded, inset, bg } = opts;
  const plate = 512 - inset * 2;
  const cell = plate / 3;
  const studR = cell * 0.3;
  const dotR = cell * 0.42;
  const wall = cell * 0.07;
  const grid: (Dot | null)[] = [RED, YELLOW, null, BLUE, WHITE, RED, null, RED, YELLOW];
  let studs = '';
  grid.forEach((dot, i) => {
    const cx = inset + (i % 3) * cell + cell / 2;
    const cy = inset + Math.floor(i / 3) * cell + cell / 2;
    if (!dot) {
      studs += `<circle cx="${cx}" cy="${cy + cell * 0.05}" r="${studR}" fill="#0e3d1f" opacity=".55"/>`;
      studs += `<circle cx="${cx}" cy="${cy}" r="${studR}" fill="url(#stud)"/>`;
      studs += `<circle cx="${cx}" cy="${cy}" r="${studR * 0.92}" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="${cell * 0.025}"/>`;
      return;
    }
    const top = cy - wall / 2;
    studs += `<ellipse cx="${cx}" cy="${cy + wall * 1.4}" rx="${dotR * 1.02}" ry="${dotR * 1.02}" fill="#000" opacity=".28"/>`;
    studs += `<path d="M${cx - dotR} ${top} v${wall} a${dotR} ${dotR} 0 0 0 ${dotR * 2} 0 v${-wall} z" fill="${dot.side}"/>`;
    studs += `<circle cx="${cx}" cy="${top}" r="${dotR}" fill="${dot.c}"/>`;
    studs += `<path d="M${cx - dotR * 0.93} ${top} a${dotR * 0.93} ${dotR * 0.93} 0 0 1 ${dotR * 1.45} ${-dotR * 0.7}" fill="none" stroke="${dot.ring}" stroke-opacity=".75" stroke-width="${cell * 0.028}" stroke-linecap="round"/>`;
    studs += `<circle cx="${cx}" cy="${top}" r="${dotR * 0.9}" fill="url(#sheen)"/>`;
  });
  const r = rounded ? 104 : 0;
  const pr = rounded ? Math.max(64, 104 - inset) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#454a50"/><stop offset="1" stop-color="#23262a"/></linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2e9150"/><stop offset="1" stop-color="#1c6a37"/></linearGradient>
    <radialGradient id="stud" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#3fa965"/><stop offset=".7" stop-color="#26803f"/><stop offset="1" stop-color="#1b6532"/></radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  ${bg ? `<rect width="512" height="512" rx="${r}" fill="url(#bg)"/>` : ''}
  <rect x="${inset}" y="${inset}" width="${plate}" height="${plate}" rx="${pr}" fill="url(#plate)"/>
  <rect x="${inset}" y="${inset}" width="${plate}" height="${plate}" rx="${pr}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="4"/>
  ${studs}
</svg>`;
}

const out = 'public/icons';
mkdirSync(out, { recursive: true });
const standard = iconSvg({ rounded: true, inset: 40, bg: true });
const maskable = iconSvg({ rounded: false, inset: 76, bg: true });
const apple = iconSvg({ rounded: false, inset: 56, bg: true });
const favicon = iconSvg({ rounded: true, inset: 0, bg: false });

writeFileSync('public/favicon.svg', favicon);
writeFileSync('assets/icon-master.svg', standard);
const png = (svg: string, size: number, file: string): Promise<unknown> =>
  sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(file);
await Promise.all([
  png(standard, 192, `${out}/icon-192.png`),
  png(standard, 512, `${out}/icon-512.png`),
  png(maskable, 192, `${out}/icon-maskable-192.png`),
  png(maskable, 512, `${out}/icon-maskable-512.png`),
  png(apple, 180, `${out}/apple-touch-icon.png`),
  png(favicon, 32, 'public/favicon-32.png'),
  png(favicon, 16, 'public/favicon-16.png'),
]);
console.log('icons written');
