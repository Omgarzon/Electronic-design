#!/usr/bin/env node
/**
 * render-posters.mjs — regenerates the hero poster from the live scene.
 *
 * Optional developer tool. It drives a headless Chrome over the dev server,
 * hides the page chrome, and screenshots the WebGL stage — so the still image
 * always matches what a visitor with WebGL sees.
 *
 * Requirements (development only, not part of the site):
 *   npm run dev                       # in another terminal
 *   npm i --no-save puppeteer-core @sparticuz/chromium
 *
 * Usage:
 *   node scripts/render-posters.mjs [width] [height] [output]
 */
import { writeFile } from 'node:fs/promises';

const WIDTH = Number(process.argv[2] ?? 1920);
const HEIGHT = Number(process.argv[3] ?? 1200);
const OUTPUT = process.argv[4] ?? 'assets/img/drone-hero.webp';
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173';

let puppeteer;
let chromium;
try {
  puppeteer = (await import('puppeteer-core')).default;
  chromium = (await import('@sparticuz/chromium')).default;
} catch {
  console.error(`
  render-posters needs a headless Chrome bridge:

    npm install --no-save puppeteer-core @sparticuz/chromium
    npx puppeteer browsers install chrome    # or point CHROME_PATH at a browser

  Then run this again with the dev server running (npm run dev).
`);
  process.exit(1);
}

const executablePath = process.env.CHROME_PATH ?? (await chromium.executablePath());
const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: true,
  env: { ...process.env, ...(process.env.LD_LIBRARY_PATH ? {} : {}) },
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  // ?3d=on forces the live scene even on a software rasteriser; a=0 & n=0 keep
  // the pose deterministic and the annotation dots out of the still.
  await page.goto(`${BASE}/index.html?3d=on&a=0&n=0`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(
    "document.querySelector('[data-stage]').classList.contains('is-ready')",
    { timeout: 120_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));

  await page.addStyleTag({
    content: `
      .hero__inner, .dock, .stage-hint, .focus-hint, .hotspots,
      .stage__poster, .site-header { display: none !important; }
      .hero { min-height: ${HEIGHT}px !important; padding: 0 !important; }
    `,
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const buffer = await page.screenshot({ type: 'png' });
  await writeFile(OUTPUT.replace(/\.webp$/, '.png'), buffer);
  console.log(`  rendered ${WIDTH}×${HEIGHT} → ${OUTPUT.replace(/\.webp$/, '.png')}`);
  console.log('  convert to webp with:  convert <file>.png -quality 82 ' + OUTPUT);
} finally {
  await browser.close();
}
