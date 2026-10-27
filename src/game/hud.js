/**
 * hud.js — all cockpit instrumentation lives here: telemetry strip,
 * artificial horizon, lock reticle with scan ring, the simulated dual-sensor
 * picture-in-picture feed, a north-up minimap and the metre scale bar.
 */
import * as THREE from 'three';
import { SENSOR } from './config.js';

const $ = (sel) => document.querySelector(sel);

export class Hud {
  constructor() {
    this.el = {
      score: $('#hud-score'),
      clock: $('#hud-clock'),
      batteryFill: $('#hud-battery-fill'),
      batteryPct: $('#hud-battery-pct'),
      mode: $('#hud-mode'),
      rth: $('#hud-rth'),
      alt: $('#hud-alt'),
      speed: $('#hud-speed'),
      dist: $('#hud-dist'),
      attitude: $('#attitude-ball'),
      reticle: $('#reticle'),
      reticleRing: $('#reticle-ring'),
      reticleLabel: $('#reticle-label'),
      pip: $('#sensor-pip'),
      pipLabel: $('#sensor-pip-label'),
      minimap: $('#minimap'),
      scaleBar: $('#scale-bar'),
      scaleLabel: $('#scale-label'),
      wind: $('#wind-indicator'),
      checklist: $('#checklist'),
      toasts: $('#toast-container'),
    };
    this.pipCtx = this.el.pip.getContext('2d');
    this.mapCtx = this.el.minimap.getContext('2d');
    this._lastTick = 0;
    this._lastMap = 0;
  }

  setThermal(on) {
    this.el.mode.textContent = on ? 'THERMAL' : 'VISUAL';
    this.el.mode.classList.toggle('is-thermal', on);
    this.el.pipLabel.textContent = on ? 'THERMAL · 640 × 512' : 'VISUAL · 48 MP';
    this.el.pip.classList.toggle('is-thermal', on);
  }

  setRth(active) {
    this.el.rth.hidden = !active;
  }

  updateTelemetry(t) {
    this.el.alt.textContent = `${t.alt.toFixed(1)} m`;
    this.el.speed.textContent = `${t.speed.toFixed(1)} m/s`;
    this.el.dist.textContent = `${t.homeDist.toFixed(1)} m`;
    this.el.score.textContent = String(t.score).padStart(5, '0');
    const mm = Math.floor(t.elapsed / 60);
    const ss = Math.floor(t.elapsed % 60);
    this.el.clock.textContent = `${mm}:${String(ss).padStart(2, '0')}`;

    const pct = Math.max(0, t.battery * 100);
    this.el.batteryFill.style.width = `${pct}%`;
    this.el.batteryPct.textContent = `${pct.toFixed(0)}%`;
    this.el.batteryFill.parentElement.classList.toggle('is-low', t.battery < SENSOR.rthThreshold);

    // Artificial horizon: roll rotates the disc, pitch slides it vertically.
    this.el.attitude.style.transform =
      `rotate(${-t.roll * THREE.MathUtils.RAD2DEG}deg) translateY(${t.pitch * 46}px)`;
  }

  /**
   * @param {string} state idle | lock | scanning | done
   */
  setReticle(state, info = {}) {
    const r = this.el.reticle;
    r.dataset.state = state;
    if (state === 'idle') {
      this.el.reticleLabel.textContent = '';
      this.el.reticleRing.style.background = '';
      return;
    }
    if (state === 'scanning') {
      const pct = Math.round((info.progress || 0) * 100);
      this.el.reticleRing.style.background =
        `conic-gradient(var(--accent) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
      this.el.reticleLabel.textContent = `SCANNING ${pct}% · ${info.distance.toFixed(1)} m`;
    } else if (state === 'lock') {
      this.el.reticleRing.style.background =
        'conic-gradient(var(--amber) 100%, rgba(255,255,255,0.12) 0)';
      this.el.reticleLabel.textContent = `LOCK · ${info.distance.toFixed(1)} m · hold steady`;
    } else if (state === 'done') {
      this.el.reticleLabel.textContent = 'GRADED ✓';
    }
  }

  setWind(strength, inside) {
    this.el.wind.classList.toggle('is-active', inside);
    this.el.wind.querySelector('[data-wind-value]').textContent = `${strength.toFixed(1)} m/s²`;
  }

  /** Simulated sensor feed, redrawn at ~15 fps to save battery. */
  drawPip(thermal, lockInfo, time) {
    const ctx = this.pipCtx;
    const w = this.el.pip.width;
    const h = this.el.pip.height;
    if (time - this._lastTick < 0.066) return;
    this._lastTick = time;

    ctx.fillStyle = thermal ? '#0b0507' : '#0a0e12';
    ctx.fillRect(0, 0, w, h);

    if (thermal) {
      // iron false-colour wash with moving noise
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#102040');
      g.addColorStop(0.55, '#3a1850');
      g.addColorStop(0.8, '#b03a20');
      g.addColorStop(1, '#ffd36b');
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      if (lockInfo?.thermal) {
        const cx = w / 2 + Math.sin(time * 1.7) * 6;
        const cy = h / 2 + Math.cos(time * 1.3) * 5;
        const hot = ctx.createRadialGradient(cx, cy, 2, cx, cy, 46);
        hot.addColorStop(0, 'rgba(255,240,180,0.95)');
        hot.addColorStop(0.5, 'rgba(255,120,40,0.7)');
        hot.addColorStop(1, 'rgba(120,20,10,0)');
        ctx.fillStyle = hot;
        ctx.beginPath();
        ctx.arc(cx, cy, 46, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // faint visual-spectrum grain + centre framing marks
      ctx.fillStyle = 'rgba(180,200,215,0.05)';
      for (let i = 0; i < 60; i += 1) {
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
      }
    }

    // crosshair + corners
    ctx.strokeStyle = thermal ? 'rgba(255,150,80,0.8)' : 'rgba(79,240,192,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 10, h / 2);
    ctx.lineTo(w / 2 + 10, h / 2);
    ctx.moveTo(w / 2, h / 2 - 10);
    ctx.lineTo(w / 2, h / 2 + 10);
    ctx.stroke();
    ctx.strokeRect(8, 8, w - 16, h - 16);

    if (lockInfo) {
      ctx.strokeStyle = lockInfo.scanning ? '#4ff0c0' : '#ffb35c';
      ctx.lineWidth = 2;
      const bw = 72;
      const bh = 54;
      ctx.strokeRect(w / 2 - bw / 2, h / 2 - bh / 2, bw, bh);
      if (lockInfo.scanning) {
        ctx.fillStyle = 'rgba(79,240,192,0.85)';
        ctx.fillRect(w / 2 - bw / 2, h / 2 + bh / 2 + 6, bw * (lockInfo.progress || 0), 3);
      }
    }
  }

  /** North-up course map at ~4 fps. */
  drawMinimap(world, drone, time) {
    if (time - this._lastMap < 0.25) return;
    this._lastMap = time;
    const ctx = this.mapCtx;
    const size = this.el.minimap.width;
    const bound = world.bounds.x;
    const scale = (size / 2 - 8) / bound;
    const cx = size / 2;
    const cy = size / 2;
    const toMap = (x, z) => [cx + x * scale, cy + z * scale];

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(8,12,17,0.78)';
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
    ctx.fill();

    // colliders
    ctx.fillStyle = 'rgba(160,175,190,0.35)';
    for (const c of world.colliders) {
      const [x1, z1] = toMap(c.box.min.x, c.box.min.z);
      const [x2, z2] = toMap(c.box.max.x, c.box.max.z);
      ctx.fillRect(Math.min(x1, x2), Math.min(z1, z2), Math.abs(x2 - x1), Math.abs(z2 - z1));
    }
    // gust cans
    ctx.fillStyle = 'rgba(255,179,92,0.18)';
    for (const g of world.gustZones) {
      const [gx, gy] = toMap(g.center.x, g.center.z);
      ctx.beginPath();
      ctx.arc(gx, gy, g.radius * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    // gates
    for (const gate of world.gates) {
      const [gx, gy] = toMap(gate.pos.x, gate.pos.z);
      ctx.fillStyle = gate.passed ? '#57e389' : '#4ff0c0';
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // targets
    for (const t of world.targets) {
      const [tx, ty] = toMap(t.pos.x, t.pos.z);
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      if (t.scanned) {
        ctx.fillStyle = '#57e389';
        ctx.fill();
      } else {
        ctx.strokeStyle = t.thermal ? '#ff8a3d' : '#4ff0c0';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
    // home pad
    const [hx, hy] = toMap(0, 0);
    ctx.strokeStyle = 'rgba(79,240,192,0.9)';
    ctx.strokeRect(hx - 4, hy - 4, 8, 8);

    // drone heading arrow
    const [dx, dy] = toMap(drone.p[0], drone.p[2]);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(-drone.yaw);
    ctx.fillStyle = '#e9f0f8';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** A ground-truth scale bar derived from camera projection. */
  updateScaleBar(camera, canvas) {
    // Depth from camera to the ground point straight below it.
    const groundPoint = new THREE.Vector3(camera.position.x, 0, camera.position.z);
    const d = camera.position.distanceTo(groundPoint);
    const fovV = THREE.MathUtils.degToRad(camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (canvas.clientWidth / canvas.clientHeight));
    const metersPerPixel = (2 * d * Math.tan(fovH / 2)) / canvas.clientWidth;
    const choices = [0.5, 1, 2, 5, 10];
    const chosen = choices.find((m) => m / metersPerPixel >= 90) ?? 10;
    const px = chosen / metersPerPixel;
    this.el.scaleBar.style.width = `${Math.min(px, 160)}px`;
    this.el.scaleLabel.textContent = `${chosen} m`;
  }

  renderChecklist(world) {
    const items = world.targets
      .map((t, i) => {
        const tag = t.thermal ? 'THERMAL' : 'VISUAL';
        const status = t.scanned ? 'done' : '';
        return `<li class="${status}"><span class="checklist__dot ${t.thermal ? 'is-thermal' : ''}"></span>
          <span>Crack ${String(i + 1).padStart(2, '0')} · ${tag}</span>
          <span class="checklist__state">${t.scanned ? 'GRADED' : '—'}</span></li>`;
      })
      .join('');
    const gates = world.gates
      .map((g, i) => `<li class="${g.passed ? 'done' : ''}"><span class="checklist__dot is-gate"></span>
        <span>Gate ${i + 1}</span><span class="checklist__state">${g.passed ? 'PASSED' : '—'}</span></li>`)
      .join('');
    this.el.checklist.innerHTML = `<ul>${items}${gates}</ul>`;
  }

  toast(message, kind = 'info') {
    const node = document.createElement('div');
    node.className = `toast toast--${kind}`;
    node.textContent = message;
    this.el.toasts.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 400);
    }, 2600);
  }
}
