#!/usr/bin/env node
/**
 * optimize-models.mjs — regenerates the web-ready glTF binaries from the
 * original Blender exports, and the poster renders from the optimized models.
 *
 * Run this only when base_basic_pbr.glb / base_basic_shaded.glb change:
 *
 *     npm run optimize
 *
 * Pipeline (via @gltf-transform/cli):
 *   weld → join → prune → quantize (KHR_mesh_quantization)
 *        → meshopt compression (EXT_meshopt_compression)
 *        → WebP textures, max 2048 px
 *
 * 24.6 MB → ~3.1 MB and 19.1 MB → ~2.9 MB, with no visible loss at the
 * distances the site uses them.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');

const JOBS = [
  { from: 'base_basic_pbr.glb', to: 'assets/models/drone-pbr.glb' },
  { from: 'base_basic_shaded.glb', to: 'assets/models/drone-shaded.glb' },
];

const args = [
  'optimize',
  // geometry
  '--compress', 'meshopt',
  '--meshopt-level', 'high',
  // textures
  '--texture-compress', 'webp',
  '--texture-size', '2048',
  // the mesh is already authored at a sensible density; simplifying it would
  // soften the panel detail the model exists to show
  '--simplify', 'false',
  '--palette', 'false',
  '--instance', 'false',
];

const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

for (const job of JOBS) {
  const input = resolve(ROOT, job.from);
  const output = resolve(ROOT, job.to);
  process.stdout.write(`\n▸ ${job.from} → ${job.to}\n`);
  try {
    const { stdout } = await run('npx', ['gltf-transform', ...args, input, output], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    const summary = stdout.trim().split('\n').filter((line) => line.startsWith('info:'));
    summary.forEach((line) => console.log(`  ${line}`));
  } catch (error) {
    console.error(`  ! failed: ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  const before = await stat(input);
  const after = await stat(output);
  console.log(`  ${mib(before.size)} → ${mib(after.size)}`);
}

console.log(`
Done. If the renders in assets/img look stale, regenerate them:

  npm run dev                       # in another terminal
  node scripts/render-posters.mjs   # needs a headless Chrome (see the script)
`);
