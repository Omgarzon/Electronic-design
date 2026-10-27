#!/usr/bin/env node
/**
 * Tiny zero-dependency static server for local development and previewing
 * the production build. Mirrors GitHub Pages behaviour:
 *   - serves index.html for "/" and for directories
 *   - serves 404.html for unknown paths
 *   - correct MIME types for .glb / .webp / .woff2 / modules
 *
 * Usage:
 *   npm run dev            # serve the repository root on http://localhost:4173
 *   npm run preview        # serve ./_site on http://localhost:4173
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] ?? '.');
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  let target = normalize(join(ROOT, decoded));
  if (!target.startsWith(ROOT + sep) && target !== ROOT) return null; // path traversal guard
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
    else return target;
  } catch {
    return null;
  }
  try {
    const info = await stat(target);
    return info.isFile() ? target : null;
  } catch {
    return null;
  }
}

/**
 * GitHub Pages serves /404.html from the site root, which for a project site
 * is the first path segment. Look in both places when previewing a build.
 */
async function find404(urlPath) {
  const segments = urlPath.split('?')[0].split('/').filter(Boolean);
  const candidates = [join(ROOT, '404.html')];
  if (segments.length) candidates.push(join(ROOT, segments[0], '404.html'));
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return { file: candidate, size: info.size };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? '/');
  if (!file) {
    const fallback = await find404(req.url ?? '/');
    if (fallback) {
      res.writeHead(404, { 'Content-Type': MIME['.html'], 'Content-Length': fallback.size });
      createReadStream(fallback.file).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const info = await stat(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Serving ${ROOT}\n  →  http://localhost:${PORT}\n`);
});
