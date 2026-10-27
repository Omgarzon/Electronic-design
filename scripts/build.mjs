#!/usr/bin/env node
/**
 * build.mjs — assembles the static site into ./_site for GitHub Pages.
 *
 * The site is hand-written HTML/CSS/ES modules, so "building" means copying
 * the files Pages must serve and leaving everything else out (sources of the
 * original models, node_modules, dev scratch, this script…).
 */
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '_site');

/** Files and folders copied verbatim, in this order. */
const INCLUDE = [
  'index.html',
  'game.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'styles',
  'src',
  'assets',
];

/** The original, unoptimised exports are not part of the published site. */
const EXCLUDE = new Set([
  'assets/models/source',
  'base_basic_pbr.glb',
  'base_basic_shaded.glb',
  'imagen_prototipo.jpeg',
]);

const started = performance.now();

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let files = 0;
let bytes = 0;

async function copy(relative) {
  if (EXCLUDE.has(relative)) return;
  const source = join(ROOT, relative);
  const target = join(OUT, relative);
  let info;
  try {
    info = await stat(source);
  } catch {
    console.warn(`  ! missing ${relative}`);
    return;
  }
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    const { readdir } = await import('node:fs/promises');
    for (const entry of await readdir(source)) {
      await copy(join(relative, entry));
    }
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
  files += 1;
  bytes += info.size;
}

for (const entry of INCLUDE) await copy(entry);

/* GitHub Pages must not run Jekyll over the output. */
await writeFile(join(OUT, '.nojekyll'), '');
files += 1;

const kib = (bytes / 1024).toFixed(0);
console.log(`\n  built _site — ${files} files, ${kib} KiB, ${(performance.now() - started).toFixed(0)} ms\n`);
