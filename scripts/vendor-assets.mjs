#!/usr/bin/env node
/**
 * Copies the exact Three.js addons and web fonts used by the site out of
 * node_modules and into assets/vendor. Everything served by GitHub Pages is
 * committed, so the deployed site has zero external CDN dependencies.
 *
 * Usage: npm run vendor
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const FILES = [
  // Three.js core (three.module.js imports three.core.js)
  ['three/build/three.module.js', 'assets/vendor/three/build/three.module.js'],
  ['three/build/three.core.js', 'assets/vendor/three/build/three.core.js'],
  ['three/LICENSE', 'assets/vendor/three/LICENSE'],

  // Addons used by the viewer, plus their local dependencies
  // GLTFLoader imports clone() from SkeletonUtils, so it must ship with it.
  ['three/examples/jsm/loaders/GLTFLoader.js', 'assets/vendor/three/addons/loaders/GLTFLoader.js'],
  ['three/examples/jsm/utils/SkeletonUtils.js', 'assets/vendor/three/addons/utils/SkeletonUtils.js'],
  ['three/examples/jsm/controls/OrbitControls.js', 'assets/vendor/three/addons/controls/OrbitControls.js'],
  ['three/examples/jsm/environments/RoomEnvironment.js', 'assets/vendor/three/addons/environments/RoomEnvironment.js'],
  ['three/examples/jsm/utils/BufferGeometryUtils.js', 'assets/vendor/three/addons/utils/BufferGeometryUtils.js'],
  ['three/examples/jsm/libs/meshopt_decoder.module.js', 'assets/vendor/three/addons/libs/meshopt_decoder.module.js'],

  // Self-hosted variable fonts (SIL Open Font License)
  ['@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', 'assets/fonts/space-grotesk-latin.woff2'],
  ['@fontsource-variable/space-grotesk/LICENSE', 'assets/fonts/LICENSE-space-grotesk.txt'],
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'assets/fonts/inter-latin.woff2'],
  ['@fontsource-variable/inter/LICENSE', 'assets/fonts/LICENSE-inter.txt'],
];

for (const [from, to] of FILES) {
  const src = resolve(ROOT, 'node_modules', from);
  const dest = resolve(ROOT, to);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`copied ${to}`);
}

console.log('\nVendored assets are up to date.');
