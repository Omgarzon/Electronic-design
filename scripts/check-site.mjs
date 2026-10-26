#!/usr/bin/env node
/**
 * check-site.mjs — dependency-free sanity checks run by `npm run build`.
 *
 * Catches the failure modes a static GitHub Pages deploy actually hits:
 *   1. a vendored Three.js addon importing a file we forgot to copy
 *   2. a local asset referenced by the HTML/CSS/JS that doesn't exist
 *   3. an import map target that is missing
 *   4. compression extensions in a .glb whose decoder isn't wired up
 */
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const problems = [];

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/* 1 — relative imports inside the vendored Three.js tree ------------------ */

async function checkVendoredImports() {
  const addons = join(ROOT, 'assets/vendor/three/addons');
  const files = [];

  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.js')) files.push(path);
    }
  };
  await walk(addons);

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1]);
      if (!(await exists(target))) {
        problems.push(
          `${file.replace(`${ROOT}/`, '')} imports ${match[1]} — copy that file in scripts/vendor-assets.mjs`,
        );
      }
    }
  }
  return files.length;
}

/* 2 — local references in HTML, CSS and our own JS ------------------------ */

async function checkLocalReferences() {
  const local = (value) =>
    value &&
    !/^(?:https?:|data:|mailto:|tel:|#|\/\/)/.test(value) &&
    !value.startsWith('//');

  const files = ['index.html', '404.html', 'styles/main.css', 'src/main.js', 'src/viewer.js', 'src/annotations.js'];

  for (const file of files) {
    const source = await readFile(join(ROOT, file), 'utf8');
    const base = dirname(join(ROOT, file));

    // href/src attributes (index.html, 404.html)
    for (const match of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (!local(match[1])) continue;
      if (!(await exists(join(base, match[1].split('#')[0])))) {
        problems.push(`${file} references missing ${match[1]}`);
      }
    }

    // css url(...)
    for (const match of source.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
      if (!local(match[1])) continue;
      if (!(await exists(join(base, match[1])))) {
        problems.push(`${file} references missing ${match[1]}`);
      }
    }

    // es module specifiers + asset strings in our JS
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      if (!(await exists(join(base, match[1])))) {
        problems.push(`${file} imports missing ${match[1]}`);
      }
    }
    for (const match of source.matchAll(/['"]((?:assets\/)[^'"]+\.(?:glb|webp|png|jpg|svg|woff2))['"]/g)) {
      if (!(await exists(join(ROOT, match[1])))) {
        problems.push(`${file} references missing ${match[1]}`);
      }
    }
  }

  // import map targets
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (map) {
    const { imports } = JSON.parse(map[1]);
    for (const [name, target] of Object.entries(imports)) {
      if (target.endsWith('/')) {
        if (!(await exists(join(ROOT, target)))) problems.push(`import map target ${target} is missing`);
      } else if (!(await exists(join(ROOT, target)))) {
        problems.push(`import map target ${name} → ${target} is missing`);
      }
    }
  }
}

/* 3 — compression extensions vs. wired-up decoders ------------------------ */

async function checkGlb(file, requireDecoder) {
  const path = join(ROOT, file);
  if (!(await exists(path))) return;
  const handle = await readFile(path);
  const jsonLength = handle.readUInt32LE(12);
  const json = JSON.parse(handle.subarray(20, 20 + jsonLength).toString('utf8'));
  const used = json.extensionsUsed ?? [];

  if (used.includes('EXT_meshopt_compression') && requireDecoder === false) {
    problems.push(`${file} is meshopt-compressed but no decoder is configured`);
  }
  if (used.includes('KHR_draco_mesh_compression')) {
    problems.push(`${file} is Draco-compressed — the site only wires up meshopt`);
  }
}

/* run -------------------------------------------------------------------- */

const addonCount = await checkVendoredImports();
await checkLocalReferences();
for (const model of ['assets/models/drone-pbr.glb', 'assets/models/drone-shaded.glb']) {
  await checkGlb(model, true);
}

const viewer = await readFile(join(ROOT, 'src/viewer.js'), 'utf8');
if (!viewer.includes('setMeshoptDecoder')) {
  problems.push('src/viewer.js does not register the meshopt decoder');
}

if (problems.length) {
  console.error(`\n  check-site: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`   ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`  check-site: ok — ${addonCount} vendored addons, references and decoders verified`);
