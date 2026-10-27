/**
 * game.js — the sortie itself.
 *
 * One Game drives both the desktop simulator and the WebXR mixed-reality
 * build: the flight model, gimbal scanning, gust response, collisions,
 * battery/RTH autopilot and scoring are mode-agnostic. Only the camera
 * (chase cam vs. XR pose) and the yard layout (full course vs. room kit)
 * differ. All distances stay in metres against the unscaled drone model.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DRONE, FLIGHT, SENSOR, SCORE } from './config.js';
import {
  createFlightState,
  neutralCommand,
  stepFlight,
  sphereVsBox,
  gimbalAim,
} from './flight-model.js';
import { loadDroneModel, DroneRig } from './drone.js';
import {
  buildWorld,
  windAt,
  isInsideGust,
  setTargetState,
  setGateState,
} from './world.js';
import { InputManager } from './input.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { ARSession } from './ar.js';

const MODES = { MENU: 'menu', PLACING: 'placing', FLYING: 'flying', PAUSED: 'paused', ENDED: 'ended' };
const PAR_SECONDS = 240;

export class Game {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.mode = 'sim';
    this.sandbox = false;
    this.phase = MODES.MENU;
    this.thermalOn = false;
    this.rthActive = false;
    this.settling = false;
    this.assist = null; // { type: 'takeoff' | 'land', t }
    this.score = 0;
    this.elapsed = 0;
    this.battery = 1;
    this.hull = 1;
    this.collisionCooldown = 0;
    this.warnedLowBattery = false;
    this.time = 0;
    this._wind = new THREE.Vector3();
    this._windArray = [0, 0, 0];
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._camDesired = new THREE.Vector3();
    this.camAz = 0.6;
    this.camEl = 0.32;
    this.camDistance = 4.4;
    this._dragging = false;
  }

  async init(mode, sandbox, onProgress = () => {}) {
    this.mode = mode;
    this.sandbox = sandbox;
    const ar = mode === 'ar';

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true, // required so an AR session can show camera passthrough
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (ar) this.renderer.setClearColor(0x000000, 0);
    else this.renderer.setClearColor(0x070a0e, 1);

    this.scene = new THREE.Scene();
    if (!ar) this.scene.fog = new THREE.Fog(0x070a0e, 24, 46);
    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.05,
      120,
    );
    this.camera.position.set(4.5, 3.2, -5.5);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    /* lights */
    this.hemi = new THREE.HemisphereLight(0xbfd4e6, 0x3a332c, ar ? 0.85 : 0.65);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, ar ? 1.1 : 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const reach = ar ? 6 : 13;
    this.sun.shadow.camera.left = -reach;
    this.sun.shadow.camera.right = reach;
    this.sun.shadow.camera.top = reach;
    this.sun.shadow.camera.bottom = -reach;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    /* course + airframe */
    this.world = buildWorld(ar);
    this.scene.add(this.world.group);
    const model = await loadDroneModel(onProgress);
    this.rig = new DroneRig(model);
    this.world.group.add(this.rig.group);

    this.state = createFlightState();
    this.input = new InputManager(document.body);
    this.hud = new Hud();
    this.sfx = new Sfx();
    this.hud.setThermal(false);
    this.hud.renderChecklist(this.world);

    this._bindCameraDrag();
    window.addEventListener('resize', this._onResize);

    // Built in every mode so the same instance can open an AR session later;
    // the renderer is alpha-capable and the reticle stays hidden until used.
    this.ar = new ARSession(this.renderer, this.scene);
    this.ar.onPlace = (matrix) => this._placeYard(matrix);
    this.ar.onEnd = () => this.cb.onQuit?.();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(this._tick);
  }

  /* ── lifecycle ───────────────────────────────────────────────────────── */

  async enterAR() {
    this.phase = MODES.PLACING;
    this.hud.el.scaleBar.style.display = 'none';
    this.hud.el.scaleLabel.textContent = '1:1 real scale';
    try {
      await this.ar.start();
      this.cb.onPlacing?.();
    } catch (err) {
      console.error('AR session failed', err);
      this.phase = MODES.MENU;
      this.cb.onARBlocked?.();
    }
  }

  toMenu() {
    this.phase = MODES.MENU;
    this.rthActive = false;
    this.assist = null;
    this._resetSortie();
    this.cb.onMenu?.();
  }

  _placeYard(matrix) {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    matrix.decompose(pos, quat, new THREE.Vector3());
    const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
    this.world.group.position.set(pos.x, 0, pos.z);
    this.world.group.rotation.y = euler.y;
    this._resetSortie();
    this.phase = MODES.FLYING;
    this.cb.onFlying?.();
    this.hud.toast('Yard placed at 1:1 scale — take off when ready');
  }

  start(sandbox = false) {
    this.sandbox = sandbox;
    this._resetSortie();
    this.phase = MODES.FLYING;
    this.cb.onFlying?.();
  }

  _resetSortie() {
    this.state = createFlightState();
    this.score = 0;
    this.elapsed = 0;
    this.battery = 1;
    this.hull = 1;
    this.rthActive = false;
    this.settling = false;
    this.assist = null;
    this.warnedLowBattery = false;
    this.thermalOn = false;
    this.hud.setThermal(false);
    this.hud.setRth(false);
    for (const t of this.world.targets) {
      t.scanned = false;
      t.progress = 0;
      setTargetState(t, 'idle');
    }
    for (const g of this.world.gates) setGateState(g, false);
    this.hud.renderChecklist(this.world);
    this.rig.gimbal.rotation.set(0, 0, 0);
  }

  pause() {
    if (this.phase !== MODES.FLYING) return;
    this.phase = MODES.PAUSED;
    this.cb.onPause?.(true);
  }

  resume() {
    if (this.phase !== MODES.PAUSED) return;
    this.phase = MODES.FLYING;
    this.cb.onPause?.(false);
    this.clock.getDelta();
  }

  endSortie() {
    if (this.phase === MODES.ENDED) return;
    this.phase = MODES.ENDED;
    this.cb.onResults?.(this._results(false));
  }

  async quit() {
    this.renderer.setAnimationLoop(null);
    if (this.ar) await this.ar.end();
    this.input?.dispose();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.cb.onQuit?.();
  }

  /* ── input edges ─────────────────────────────────────────────────────── */

  _handleEdges(edges) {
    const flying = this.phase === MODES.FLYING;
    for (const edge of edges) {
      switch (edge) {
        case 'pause':
          if (this.phase === MODES.FLYING) this.pause();
          else if (this.phase === MODES.PAUSED) this.resume();
          break;
        case 'mute':
          this.sfx.setMuted(!this.sfx.muted);
          this.hud.toast(this.sfx.muted ? 'Sound muted' : 'Sound on');
          break;
        default:
          // Mission controls only respond while the sortie is live.
          if (!flying) break;
          if (edge === 'thermal') {
            this.thermalOn = !this.thermalOn;
            this.hud.setThermal(this.thermalOn);
            this.sfx.blip();
          } else if (edge === 'rth' && !this.sandbox) {
            this.rthActive = !this.rthActive;
            if (!this.rthActive) this.settling = false;
            this.hud.setRth(this.rthActive);
            this.hud.toast(this.rthActive ? 'Return-to-home engaged' : 'Return-to-home cancelled');
            this.sfx.blip();
          } else if (edge === 'takeoff') {
            this.sfx.ensure();
            if (!this.state.airborne) this.assist = { type: 'takeoff', t: 0 };
            else this.assist = { type: 'land', t: 0 };
          }
          break;
      }
    }
  }

  /* ── autopilot: RTH and assisted landing ─────────────────────────────── */

  _autopilot(cmd, dt) {
    const s = this.state;
    const dx = -s.p[0];
    const dz = -s.p[2];
    const dist = Math.hypot(dx, dz);
    const descend = () => {
      this.settling = true;
      // Active horizontal braking: kill residual speed so the airframe
      // cannot drift out of the pad envelope while it is coming down.
      const brake = Math.exp(-3.5 * dt);
      s.v[0] *= brake;
      s.v[2] *= brake;
      cmd.yaw = 0;
      cmd.pitch = 0;
      cmd.roll = 0;
      cmd.climb = s.p[1] > 0.15 ? -0.45 : 0;
      if (s.p[1] <= 0.05 && !s.airborne) {
        this.assist = null;
    
        if (this.rthActive || this.battery <= 0) this._finishRth();
      }
    };

    // Once a landing starts it commits, even if momentum carries us a little.
    if (this.settling) return descend();
    // Assisted landing settles straight down wherever the drone is.
    if (this.assist?.type === 'land') return descend();
    // RTH / dead pack: settle once inside the pad's braking envelope.
    if ((this.rthActive || this.battery <= 0) && dist < 1.1) return descend();

    const desiredYaw = Math.atan2(dx, dz);
    let diff = desiredYaw - s.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cmd.yaw = THREE.MathUtils.clamp(diff * 1.4, -1, 1);
    cmd.roll = 0;
    // Brake in the inner envelope so the pad cannot be overshot at speed.
    if (dist < 1.5) cmd.pitch = 0;
    else if (Math.abs(diff) < 0.5) cmd.pitch = THREE.MathUtils.clamp(dist * 0.32, 0, 0.85);
    cmd.climb = THREE.MathUtils.clamp((2.4 - s.p[1]) * 0.9, -1, 1);
  }

  _finishRth() {
    this.rthActive = false;
    this.hud.setRth(false);
    if (this.battery <= 0) {
      this.endSortie();
      return;
    }
    this.hud.toast('On the pad — sortie complete once you land the final time');
  }

  /* ── scanning ────────────────────────────────────────────────────────── */

  _updateScanning(dt) {
    const s = this.state;
    // Make sure world matrices (including the placed AR yard) are current
    // before we read the gimbal orientation and target world positions.
    this.rig.gimbal.updateWorldMatrix(true, false);
    const sensorWorld = this.rig.sensorWorld(new THREE.Vector3());
    const gimbalQuat = this.rig.gimbal.getWorldQuaternion(new THREE.Quaternion());
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(gimbalQuat);
    const speed = Math.hypot(s.v[0], s.v[2]);

    let best = null;
    let bestDot = -1;
    for (const t of this.world.targets) {
      if (t.scanned) continue;
      const targetWorld = t.pos.clone();
      this.world.group.localToWorld(targetWorld);
      const to = targetWorld.sub(sensorWorld);
      const range = to.length();
      if (range < SENSOR.minRange || range > SENSOR.maxRange) continue;
      to.normalize();
      const dot = facing.dot(to);
      // target must also face the drone (don't scan through a wall)
      const normalWorld = t.normal.clone().applyQuaternion(this.world.group.getWorldQuaternion(new THREE.Quaternion()));
      if (normalWorld.dot(to.clone().negate()) < 0.25) continue;
      if (dot > Math.cos(SENSOR.lockAngle) && dot > bestDot) {
        best = t;
        bestDot = dot;
        best._range = range;
        best._dot = dot;
      }
    }

    if (!best) {
      this.rig.update(s, null, this.thermalOn, dt);
      this.hud.setReticle('idle');
      return null;
    }

    const aim = gimbalAim(s, DRONE.sensor, [best.pos.x, best.pos.y, best.pos.z]);
    const canScan =
      this.input.scanHeld &&
      bestDot > Math.cos(SENSOR.scanAngle) &&
      speed < SENSOR.maxScanSpeed &&
      (!best.thermal || this.thermalOn);
    const locked = { ...aim, locked: true, scanning: false };

    if (canScan) {
      best.progress = Math.min(1, best.progress + dt / SENSOR.scanSeconds);
      locked.scanning = true;
      setTargetState(best, 'scanning');
      this.hud.setReticle('scanning', { progress: best.progress, distance: best._range });
      if (Math.floor(best.progress * 12) !== Math.floor((best.progress - dt / SENSOR.scanSeconds) * 12)) {
        this.sfx.scanTick();
      }
      if (best.progress >= 1) this._completeScan(best);
    } else {
      setTargetState(best, best.thermal && !this.thermalOn ? 'idle' : 'lock');
      this.hud.setReticle('lock', { distance: best._range });
    }
    this.rig.update(s, locked, this.thermalOn, dt);
    this.hud.drawPip(this.thermalOn, {
      thermal: best.thermal,
      scanning: canScan,
      progress: best.progress,
    }, this.time);
    return best;
  }

  _completeScan(target) {
    target.scanned = true;
    target.progress = 1;
    setTargetState(target, 'done');
    const gained = target.thermal ? SCORE.thermalCrack : SCORE.visualCrack;
    this.score += gained;
    this.sfx.success();
    this.hud.toast(`${target.thermal ? 'Thermal' : 'Visual'} crack graded — +${gained}`, 'success');
    this.hud.renderChecklist(this.world);
    this.hud.setReticle('done');
    if (this.world.targets.every((t) => t.scanned)) {
      this.hud.toast('All cracks graded — return to the home pad and land', 'success');
    }
  }

  /* ── gates, gusts, collisions, battery ───────────────────────────────── */

  _updateGates(prev) {
    const s = this.state;
    for (const g of this.world.gates) {
      if (g.passed) continue;
      const cur = this._tmp2.set(s.p[0] - g.pos.x, s.p[1] - g.pos.y, s.p[2] - g.pos.z);
      const prevRel = prev.clone().sub(g.pos);
      const sNow = cur.dot(g.normal);
      const sBefore = prevRel.dot(g.normal);
      const lateral = Math.hypot(cur.x - g.normal.x * sNow, cur.z - g.normal.z * sNow);
      const vertical = Math.abs(cur.y - g.normal.y * sNow);
      // Sign change on the plane axis = a crossing in either direction.
      if (sBefore * sNow <= 0 && sBefore !== 0 && lateral < g.radius - 0.45 && vertical < g.radius - 0.45) {
        g.passed = true;
        setGateState(g, true);
        this.score += SCORE.gate;
        this.sfx.gate();
        this.hud.toast(`Gate cleared — +${SCORE.gate}`, 'success');
        this.hud.renderChecklist(this.world);
      }
    }
  }

  _sampleWind() {
    this._wind.set(0, 0, 0);
    let inside = false;
    for (const zone of this.world.gustZones) {
      if (isInsideGust(zone, this.state.p)) {
        windAt(zone, this._wind, this.time);
        inside = true;
        break;
      }
    }
    this._windArray[0] = this._wind.x;
    this._windArray[1] = this._wind.y;
    this._windArray[2] = this._wind.z;
    this.hud.setWind(this._wind.length(), inside);
  }

  _resolveCollisions() {
    const s = this.state;
    const center = [s.p[0], s.p[1] + DRONE.comY, s.p[2]];
    for (const c of this.world.colliders) {
      const hit = sphereVsBox(center, DRONE.collisionRadius, c.box);
      if (!hit) continue;
      s.p[0] += hit.normal[0] * hit.depth;
      s.p[1] += hit.normal[1] * hit.depth;
      s.p[2] += hit.normal[2] * hit.depth;
      const vn = s.v[0] * hit.normal[0] + s.v[1] * hit.normal[1] + s.v[2] * hit.normal[2];
      if (vn < 0) {
        s.v[0] -= 1.6 * vn * hit.normal[0];
        s.v[1] -= 1.6 * vn * hit.normal[1];
        s.v[2] -= 1.6 * vn * hit.normal[2];
        s.v[0] *= 0.45;
        s.v[1] *= 0.45;
        s.v[2] *= 0.45;
      }
      const impact = Math.abs(vn);
      if (impact > 1.1 && this.collisionCooldown <= 0) {
        this.collisionCooldown = 0.8;
        this.hull = Math.max(0, this.hull - impact * 0.06);
        this.score = Math.max(0, this.score - SCORE.collision);
        this.sfx.crash();
        this.hud.toast(`Impact — hull ${(this.hull * 100).toFixed(0)}% · −${SCORE.collision}`, 'danger');
        if (this.hull <= 0) this.endSortie();
      }
    }
  }

  _enforceBounds() {
    const b = this.world.bounds;
    const s = this.state;
    const clampAxis = (i, bound) => {
      if (s.p[i] > bound) {
        s.p[i] = bound;
        s.v[i] *= -0.4;
      } else if (s.p[i] < -bound) {
        s.p[i] = -bound;
        s.v[i] *= -0.4;
      }
    };
    clampAxis(0, b.x);
    clampAxis(2, b.z);
    if (s.p[1] > b.ceiling) {
      s.p[1] = b.ceiling;
      s.v[1] = 0;
    }
  }

  _updateBattery(dt) {
    if (this.sandbox) return;
    const s = this.state;
    const drain =
      (SENSOR.drainBase + s.thrustNorm * SENSOR.drainThrust + SENSOR.drainSensor) * dt;
    this.battery = Math.max(0, this.battery - drain);
    if (this.battery <= SENSOR.rthThreshold && !this.warnedLowBattery) {
      this.warnedLowBattery = true;
      this.rthActive = true;
      this.hud.setRth(true);
      this.sfx.warn();
      this.hud.toast('Battery at 20% — automatic return-to-home', 'danger');
    }
  }

  /* ── camera ──────────────────────────────────────────────────────────── */

  _bindCameraDrag() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.mode === 'ar') return;
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.camAz -= dx * 0.006;
      this.camEl = THREE.MathUtils.clamp(this.camEl + dy * 0.005, 0.08, 1.2);
    });
    const stop = () => {
      this._dragging = false;
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('wheel', (e) => {
      if (this.mode === 'ar') return;
      e.preventDefault();
      this.camDistance = THREE.MathUtils.clamp(this.camDistance + e.deltaY * 0.004, 1.6, 10);
    }, { passive: false });
  }

  _updateChaseCamera(dt) {
    const s = this.state;
    const az = this.camAz;
    const el = this.camEl;
    const horizontal = Math.cos(el) * this.camDistance;
    this._camDesired.set(
      s.p[0] + Math.sin(az) * horizontal,
      s.p[1] + 0.35 + Math.sin(el) * this.camDistance,
      s.p[2] - Math.cos(az) * horizontal,
    );
    // Pull the camera in front of walls instead of clipping through them.
    const origin = this._tmp.set(s.p[0], s.p[1] + 0.3, s.p[2]);
    for (let t = 1; t >= 0.25; t -= 0.15) {
      const candidate = origin.clone().lerp(this._camDesired, t);
      candidate.y = Math.max(0.35, candidate.y);
      let blocked = false;
      for (const c of this.world.colliders) {
        if (
          candidate.x > c.box.min.x - 0.2 && candidate.x < c.box.max.x + 0.2 &&
          candidate.y > c.box.min.y - 0.2 && candidate.y < c.box.max.y + 0.2 &&
          candidate.z > c.box.min.z - 0.2 && candidate.z < c.box.max.z + 0.2
        ) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        this._camDesired.copy(candidate);
        break;
      }
    }
    const k = 1 - Math.exp(-8 * dt);
    this.camera.position.lerp(this._camDesired, k);
    this.camera.lookAt(s.p[0], s.p[1] + 0.3, s.p[2]);
  }

  /* ── results ─────────────────────────────────────────────────────────── */

  _results(completed) {
    const scanned = this.world.targets.filter((t) => t.scanned).length;
    const gates = this.world.gates.filter((g) => g.passed).length;
    const batteryBonus = Math.round(SCORE.batteryBonus * this.battery);
    const timeBonus = Math.max(0, Math.round((PAR_SECONDS - this.elapsed) * SCORE.timeBonusPerSecond));
    const total = this.score + (completed ? batteryBonus + timeBonus : 0);
    const grade =
      total >= 7500 ? 'S' : total >= 5800 ? 'A' : total >= 4000 ? 'B' : total >= 2200 ? 'C' : 'D';
    return {
      completed,
      grade,
      total,
      breakdown: {
        scans: `${scanned}/${this.world.targets.length}`,
        gates: `${gates}/${this.world.gates.length}`,
        hull: `${(this.hull * 100).toFixed(0)}%`,
        battery: `${(this.battery * 100).toFixed(0)}%`,
        time: `${Math.floor(this.elapsed / 60)}:${String(Math.floor(this.elapsed % 60)).padStart(2, '0')}`,
        batteryBonus: completed ? batteryBonus : 0,
        timeBonus: completed ? timeBonus : 0,
      },
    };
  }

  /* ── main loop ───────────────────────────────────────────────────────── */

  _tick = (timestamp, frame) => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    this.ar?.poll(frame);
    this._handleEdges(this.input.consumeEdges());

    if (this.phase === MODES.MENU || this.phase === MODES.PLACING) {
      // Gentle showcase turntable while the player reads the briefing.
      if (this.rig) {
        this.state.yaw += dt * 0.35;
        this.world.update(this.time, dt, this.thermalOn);
        this.rig.update(this.state, null, this.thermalOn, dt);
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.phase === MODES.PAUSED || this.phase === MODES.ENDED) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const s = this.state;
    const prev = new THREE.Vector3(s.p[0], s.p[1], s.p[2]);

    /* pilot or autopilot */
    const cmd = this.rthActive || this.assist ? neutralCommand() : this.input.sample();
    if (this.assist) {
      this.assist.t += dt;
      if (this.assist.type === 'takeoff') {
        cmd.climb = Math.max(cmd.climb, 0.85);
        if (this.assist.t > 1.4 || s.p[1] > 1.2) this.assist = null;
      } else {
        this._autopilot(cmd, dt);
      }
    } else if (this.rthActive) {
      this._autopilot(cmd, dt);
    }
    cmd.deadStick = !this.sandbox && this.battery <= 0;

    this._sampleWind();
    stepFlight(s, cmd, this._windArray, dt);
    if (cmd.deadStick && !s.airborne && this.phase === MODES.FLYING) {
      this.endSortie();
      return;
    }
    this._enforceBounds();
    this._resolveCollisions();
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

    // hard landing damage
    if (s.impact > FLIGHT.hardLanding) {
      this.hull = Math.max(0, this.hull - 0.08);
      this.score = Math.max(0, this.score - SCORE.hardLanding);
      this.sfx.crash();
      this.hud.toast(`Hard landing — hull ${(this.hull * 100).toFixed(0)}%`, 'danger');
      if (this.hull <= 0) this.endSortie();
    }

    this._updateGates(prev);
    this._updateBattery(dt);
    this.elapsed += dt;

    const scanTarget = this._updateScanning(dt);
    if (!scanTarget) this.rig.update(s, null, this.thermalOn, dt);
    this.world.update(this.time, dt, this.thermalOn);

    /* light follows the airframe so shadows stay crisp across the yard */
    this.sun.position.set(s.p[0], 8, s.p[2] + 4);
    this.sun.target.position.set(s.p[0], 0, s.p[2]);

    if (this.mode !== 'ar') this._updateChaseCamera(dt);
    this.sfx.updateRotor(s.rpmNorm, dt);

    /* telemetry + mission completion */
    const homeDist = Math.hypot(s.p[0], s.p[2]);
    this.hud.updateTelemetry({
      alt: s.p[1],
      speed: Math.hypot(s.v[0], s.v[2]),
      battery: this.battery,
      pitch: s.pitch,
      roll: s.roll,
      yaw: s.yaw,
      score: this.score,
      elapsed: this.elapsed,
      homeDist,
    });
    this.hud.drawMinimap(this.world, s, this.time);
    if (this.mode !== 'ar') this.hud.updateScaleBar(this.camera, this.canvas);
    if (!scanTarget) this.hud.drawPip(this.thermalOn, null, this.time);

    const allScanned = this.world.targets.every((t) => t.scanned);
    if (allScanned && !s.airborne && homeDist < 1.2 && this.phase === MODES.FLYING) {
      this.phase = MODES.ENDED;
      this.cb.onResults?.(this._results(true));
    }

    this.renderer.render(this.scene, this.camera);
  };

  _onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
