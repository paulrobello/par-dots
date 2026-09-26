import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Aspect, LibraryEntry, NormalizedCrop } from '../src/types';

const PORTRAIT = new Set(['autumn-tree', 'dachshund-in-hat', 'lighthouse', 'concert-singer']);
const LANDSCAPE = new Set(['cartoon-dachshunds', 'cheshire-cat', 'orange-sunset']);

export const FULL_EDGE = 1024;
export const THUMB_EDGE = 256;
export const WEBP_QUALITY = 82;

/** Default crop aspect for a bundled library image (PRD §5.2). */
export function defaultAspectFor(slug: string): Aspect {
  if (PORTRAIT.has(slug)) return '3:4';
  if (LANDSCAPE.has(slug)) return '4:3';
  return '1:1';
}

/** Default crop for a bundled library image: centered at zoom 1 (PRD §5.2). */
export function defaultCropFor(_slug: string): NormalizedCrop {
  return { zoom: 1, cx: 0.5, cy: 0.5 };
}

/** Human title from a kebab-case slug: "dachshund-in-hat" -> "Dachshund in Hat". */
export function titleFor(slug: string): string {
  const minor = new Set(['a', 'an', 'and', 'at', 'in', 'of', 'on', 'the', 'to']);
  return slug
    .split('-')
    .filter((w) => w.length > 0)
    .map((w, i) => (i > 0 && minor.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Manifest entry for a slug; paths are relative to the site root (no leading slash). */
export function entryFor(slug: string): LibraryEntry {
  return {
    slug,
    title: titleFor(slug),
    aspect: defaultAspectFor(slug),
    crop: defaultCropFor(slug),
    src: `library/${slug}.webp`,
    thumb: `library/${slug}-thumb.webp`,
  };
}

/** Build library entries from a list of image filenames, sorted by slug. */
export function buildManifest(files: string[]): LibraryEntry[] {
  return files
    .filter((f) => /\.jpe?g$/i.test(f))
    .map((f) => basename(f).replace(/\.jpe?g$/i, ''))
    .sort()
    .map(entryFor);
}

async function main(): Promise<void> {
  const { default: sharp } = await import('sharp');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const srcDir = join(root, 'images');
  const outDir = join(root, 'public', 'library');
  await mkdir(outDir, { recursive: true });

  const files = await readdir(srcDir);
  const manifest = buildManifest(files);
  const sourceBySlug = new Map(
    files.filter((f) => /\.jpe?g$/i.test(f)).map((f) => [f.replace(/\.jpe?g$/i, ''), f]),
  );

  await Promise.all(
    manifest.map(async (entry) => {
      const input = join(srcDir, sourceBySlug.get(entry.slug) ?? `${entry.slug}.jpg`);
      const resize = (edge: number) =>
        sharp(input)
          .rotate()
          .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY });
      await resize(FULL_EDGE).toFile(join(outDir, `${entry.slug}.webp`));
      await resize(THUMB_EDGE).toFile(join(outDir, `${entry.slug}-thumb.webp`));
    }),
  );

  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`library: wrote ${manifest.length} images to ${outDir}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
