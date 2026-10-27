/**
 * textures.js — every texture in the yard is generated on a 2D canvas, so the
 * game ships no binary art beyond the drone itself. All patterns are seeded
 * for stable results between reloads.
 */
import * as THREE from 'three';

/* roundRect landed in Safari 16; keep the label sprites working elsewhere. */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
  };
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function toTexture(canvas, { repeat = null, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/** Fractured grey concrete for the ground slab. */
export function concreteTexture(seed = 7, repeat = [12, 12]) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = rng(seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 26;
    const v = 132 + n;
    img.data[i] = v;
    img.data[i + 1] = v + 2;
    img.data[i + 2] = v + 4;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // stains and aggregate speckle
  for (let i = 0; i < 26; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 20 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() > 0.5;
    g.addColorStop(0, dark ? 'rgba(40,42,44,0.18)' : 'rgba(210,214,216,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // a few hairline cracks
  ctx.strokeStyle = 'rgba(35,37,39,0.55)';
  for (let i = 0; i < 7; i += 1) {
    ctx.lineWidth = 0.8 + rand() * 1.4;
    ctx.beginPath();
    let x = rand() * size;
    let y = rand() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s += 1) {
      x += (rand() - 0.5) * 120;
      y += (rand() - 0.5) * 120;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(canvas, { repeat });
}

/** Vertical precast wall panels with form-work lines and weathering. */
export function wallTexture(seed = 13, tint = 120) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = rng(seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 20;
    img.data[i] = tint + n;
    img.data[i + 1] = tint + n + 2;
    img.data[i + 2] = tint + n + 5;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // vertical form panel seams every 128 px
  ctx.strokeStyle = 'rgba(30,32,34,0.5)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= size; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  // runoff streaks
  for (let i = 0; i < 22; i += 1) {
    const x = rand() * size;
    const h = 60 + rand() * 260;
    const g = ctx.createLinearGradient(x, 0, x, h);
    g.addColorStop(0, 'rgba(35,38,40,0.16)');
    g.addColorStop(1, 'rgba(35,38,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 3 + rand() * 5, h);
  }
  return toTexture(canvas, { repeat: [2, 1] });
}

/**
 * Transparent crack decal. A jagged main fissure with branches, a faint light
 * edge (spalled concrete) and an optional thermal hotspot at the origin.
 */
export function crackDecalTexture(seed = 1, thermal = false) {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const rand = rng(seed * 991 + 17);
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawFissure = (x, y, angle, length, width) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    let px = x;
    let py = y;
    const steps = 9;
    for (let i = 0; i < steps; i += 1) {
      angle += (rand() - 0.5) * 0.9;
      const step = length / steps;
      px += Math.cos(angle) * step;
      py += Math.sin(angle) * step;
      ctx.lineTo(px, py);
    }
    // spalled light rim
    ctx.strokeStyle = thermal ? 'rgba(255,170,90,0.35)' : 'rgba(225,228,230,0.5)';
    ctx.lineWidth = width + 3;
    ctx.stroke();
    // dark void
    ctx.strokeStyle = thermal ? 'rgba(120,30,8,0.9)' : 'rgba(28,30,32,0.92)';
    ctx.lineWidth = width;
    ctx.stroke();
    return [px, py, angle];
  };

  // main vertical-ish fissure
  const [ex, ey, ea] = drawFissure(size * 0.5, size * 0.12, Math.PI / 2 + (rand() - 0.5) * 0.5, size * 0.78, 4);
  // branches
  for (let b = 0; b < 4; b += 1) {
    const t = 0.25 + rand() * 0.6;
    const bx = size * 0.5 + Math.cos(ea) * size * 0.78 * 0 + (rand() - 0.5) * 40;
    const by = size * 0.12 + t * size * 0.7;
    const dir = rand() > 0.5 ? 1 : -1;
    drawFissure(bx, by, ea + dir * (0.7 + rand() * 0.6), size * (0.12 + rand() * 0.18), 2);
  }

  if (thermal) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size * 0.42);
    g.addColorStop(0, 'rgba(255,120,40,0.55)');
    g.addColorStop(0.6, 'rgba(255,90,20,0.18)');
    g.addColorStop(1, 'rgba(255,80,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return toTexture(canvas);
}

/** Translucent spinning rotor disc: faint streaks radiating from the hub. */
export function rotorDiscTexture() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(c, c, c * 0.08, c, c, c);
  g.addColorStop(0, 'rgba(220,228,235,0.0)');
  g.addColorStop(0.25, 'rgba(210,220,228,0.10)');
  g.addColorStop(0.85, 'rgba(210,220,228,0.20)');
  g.addColorStop(1, 'rgba(210,220,228,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  // streaky blade ghosts
  ctx.strokeStyle = 'rgba(225,232,238,0.28)';
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * c * 0.12, c + Math.sin(a) * c * 0.12);
    ctx.lineTo(c + Math.cos(a + 0.12) * c * 0.92, c + Math.sin(a + 0.12) * c * 0.92);
    ctx.stroke();
  }
  return toTexture(canvas);
}

/** Round landing pad with an H, sized to a 1.8 m diameter. */
export function padTexture() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(79,240,192,0.9)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(c, c, c - 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(79,240,192,0.85)';
  ctx.font = 'bold 130px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', c, c + 8);
  return toTexture(canvas);
}

/** Small emissive heat sprite for thermal-only markers. */
export function heatSpriteTexture() {
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,150,70,0.95)');
  g.addColorStop(0.4, 'rgba(255,90,25,0.45)');
  g.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas);
}

/** Always-facing text label used for the scale references. */
export function labelSprite(text, color = '#e9f0f8') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 44px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(6,9,13,0.62)';
  const w = ctx.measureText(text).width + 44;
  ctx.beginPath();
  ctx.roundRect((512 - w) / 2, 24, w, 80, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 66);
  const tex = toTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}
