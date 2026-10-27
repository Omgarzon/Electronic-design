/**
 * flight-model.js — pure-math attitude-mode quadcopter dynamics.
 *
 * No Three.js here on purpose: the whole model is plain arrays and scalars
 * so it can be unit-tested in Node and driven identically by keyboard,
 * touch joysticks, the autopilot (RTH) and the WebXR build.
 *
 * Conventions
 *   - positions/metres, velocities m/s, angles radians.
 *   - yaw 0 faces +Z (the drone's nose, and the PMB-1.3 sensor, point +Z).
 *   - pitch negative = nose down (forward flight), roll positive = right.
 *   - a command channel is clamped to −1 … 1.
 */
import { FLIGHT } from './config.js';

const {
  gravity: G,
  maxTilt,
  maxYawRate,
  maxClimbRate,
  maxSpeed,
  attitudeGain,
  verticalP,
  dragH,
  dragV,
  groundFriction,
} = FLIGHT;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerpFactor = (rate, dt) => 1 - Math.exp(-rate * dt);

export function createFlightState(home = [0, 0, 0]) {
  return {
    p: [home[0], 0, home[2]],
    v: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    roll: 0,
    airborne: false,
    /** Per-rotor normalised speed 0…1, cosmetic + audio feed. */
    rpm: [0.12, 0.12, 0.12, 0.12],
    rpmNorm: 0.12,
    /** Collective load, T/g — drives battery drain and rotor noise. */
    thrustNorm: 0,
    /** Last hard impact speed, consumed by the game for damage. */
    impact: 0,
  };
}

/**
 * A neutral command block. `climb` is collective, `yaw` heading rate,
 * `pitch` forward/back, `roll` strafe. `deadStick` lets the battery
 * failure state decay thrust toward zero.
 */
export function neutralCommand() {
  return { climb: 0, yaw: 0, pitch: 0, roll: 0, deadStick: false };
}

/** Body-up unit vector for yaw → pitch → roll (Euler order YXZ). */
export function bodyUp(yaw, pitch, roll) {
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const sp = Math.sin(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return [
    -sr * cy + cr * sp * sy,
    cr * cp,
    sr * sy + cr * sp * cy,
  ];
}

/**
 * Advance the airframe one fixed step.
 *
 * @param {object} s   flight state (mutated)
 * @param {object} cmd normalised pilot/autopilot command
 * @param {Array}  wind acceleration from gusts, m/s² [x,y,z]
 * @param {number} dt  seconds (caller clamps this)
 */
export function stepFlight(s, cmd, wind = [0, 0, 0], dt = 1 / 60) {
  s.impact = 0;
  const c = {
    climb: clamp(cmd.climb || 0, -1, 1),
    yaw: clamp(cmd.yaw || 0, -1, 1),
    pitch: clamp(cmd.pitch || 0, -1, 1),
    roll: clamp(cmd.roll || 0, -1, 1),
    // Without this the dead-stick branch below can never run: the flag
    // arrives on cmd but was dropped while building the local command.
    deadStick: Boolean(cmd.deadStick),
  };

  /* ── attitude: rate-limited first-order tracker, self-levelling ──────── */
  // Three.js +X rotation tilts the +Z nose downward, so positive pitch
  // here means "nose down, thrust vector pitched toward +Z" (forward).
  const pitchTarget = s.airborne ? c.pitch * maxTilt : 0;
  const rollTarget = s.airborne ? c.roll * maxTilt : 0;
  const k = lerpFactor(attitudeGain, dt);
  s.pitch += (pitchTarget - s.pitch) * k;
  s.roll += (rollTarget - s.roll) * k;
  s.yaw += c.yaw * maxYawRate * dt * (s.airborne ? 1 : 0.4);

  /* ── collective thrust as an acceleration along body-up ──────────────── */
  let T;
  if (!s.airborne) {
    // Spool on the skids: lift only when the pilot clearly asks to climb.
    T = c.climb > 0.2 ? G + verticalP * (c.climb * maxClimbRate - s.v[1]) : 0;
    if (c.climb > 0.2) s.airborne = true;
  } else if (c.deadStick) {
    T = 0; // battery gone: rotors wind down, gravity takes over
  } else {
    const vzTarget = c.climb * maxClimbRate;
    T = G + clamp(verticalP * (vzTarget - s.v[1]), -G * 0.55, G * 0.95);
    T = Math.max(0, T);
  }
  s.thrustNorm = clamp(T / G, 0, 1.7);

  const up = bodyUp(s.yaw, s.pitch, s.roll);
  const ax = up[0] * T + (wind[0] || 0);
  const ay = up[1] * T - G + (wind[1] || 0);
  const az = up[2] * T + (wind[2] || 0);

  s.v[0] += ax * dt;
  s.v[1] += ay * dt;
  s.v[2] += az * dt;

  /* ── drag (exponential, frame-rate independent) ──────────────────────── */
  const dh = Math.exp(-dragH * dt);
  const dv = Math.exp(-dragV * dt);
  s.v[0] *= dh;
  s.v[2] *= dh;
  s.v[1] *= dv;

  /* ── horizontal speed clamp ──────────────────────────────────────────── */
  const hs = Math.hypot(s.v[0], s.v[2]);
  if (hs > maxSpeed) {
    const f = maxSpeed / hs;
    s.v[0] *= f;
    s.v[2] *= f;
  }

  /* ── integrate + ground contact ──────────────────────────────────────── */
  s.p[0] += s.v[0] * dt;
  s.p[1] += s.v[1] * dt;
  s.p[2] += s.v[2] * dt;

  if (s.p[1] <= 0) {
    s.p[1] = 0;
    if (s.v[1] < -FLIGHT.hardLanding) s.impact = -s.v[1];
    s.v[1] = 0;
    if (s.airborne && c.climb <= 0.05) {
      s.airborne = false;
      s.pitch = 0;
      s.roll = 0;
    }
    // Skid friction bleeds horizontal speed while on the ground.
    const fg = Math.exp(-groundFriction * dt);
    s.v[0] *= fg;
    s.v[2] *= fg;
  }

  /* ── rotor RPM: collective load + yaw/tilt differential (cosmetic) ───── */
  const base = s.airborne ? (c.deadStick ? 0.05 : 0.52) : 0.12;
  const load = (s.thrustNorm - 1) * 0.32;
  const yawDiff = c.yaw * 0.07;
  const tiltDiff = (Math.abs(c.pitch) + Math.abs(c.roll)) * 0.04;
  // Motor order: FR, FL, BR, BL. Diagonal pairs counter-rotate.
  const targets = [
    base + load + yawDiff + tiltDiff,
    base + load - yawDiff + tiltDiff,
    base + load - yawDiff - tiltDiff,
    base + load + yawDiff - tiltDiff,
  ];
  const rk = lerpFactor(9, dt);
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    s.rpm[i] += (clamp(targets[i], 0, 1) - s.rpm[i]) * rk;
    total += s.rpm[i];
  }
  s.rpmNorm = total / 4;
  return s;
}

/* ── collision primitives ───────────────────────────────────────────────── */

/**
 * Sphere vs axis-aligned box. Returns the penetration depth and a correction
 * normal pointing away from the box, or null when they do not overlap.
 * Accepts plain array boxes ({min:[x,y,z]}) or THREE.Box3-like objects
 * ({min: {x,y,z}}).
 */
export function sphereVsBox(center, radius, box) {
  const min = box.min;
  const max = box.max;
  const ax = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);
  const mn = ax(min);
  const mx = ax(max);
  const qx = clamp(center[0], mn[0], mx[0]);
  const qy = clamp(center[1], mn[1], mx[1]);
  const qz = clamp(center[2], mn[2], mx[2]);
  const dx = center[0] - qx;
  const dy = center[1] - qy;
  const dz = center[2] - qz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > radius * radius) return null;
  const d = Math.sqrt(d2);
  if (d > 1e-6) {
    return { normal: [dx / d, dy / d, dz / d], depth: radius - d };
  }
  // Centre inside the box: push out along the smallest penetration axis.
  const axes = [
    { n: [1, 0, 0], d: Math.min(center[0] - mn[0], mx[0] - center[0]) },
    { n: [0, 1, 0], d: Math.min(center[1] - mn[1], mx[1] - center[1]) },
    { n: [0, 0, 1], d: Math.min(center[2] - mn[2], mx[2] - center[2]) },
  ];
  axes.sort((a, b) => a.d - b.d);
  return { normal: axes[0].n, depth: axes[0].d + radius };
}

/**
 * Gimbal line-of-sight solution in WORLD frame. The gimbal is mounted on the
 * tilted airframe but counter-rotates to hold a world-frame aim, which is
 * exactly the three-axis stabilization the PMB-1.3 advertises.
 *
 * Returns relative yaw/pitch to feed the gimbal Object3D plus geometry.
 */
export function gimbalAim(state, sensorOffset, target) {
  const sx = state.p[0] + sensorOffset.x;
  const sy = state.p[1] + sensorOffset.y;
  const sz = state.p[2] + sensorOffset.z;
  const dx = target[0] - sx;
  const dy = target[1] - sy;
  const dz = target[2] - sz;
  const range = Math.hypot(dx, dy, dz);
  const worldYaw = Math.atan2(dx, dz);
  // Positive three.js +X rotation aims +Z downward, so aiming up is negative.
  const worldPitch = -Math.atan2(dy, Math.hypot(dx, dz));
  return {
    range,
    worldYaw,
    worldPitch,
    /** For a gimbal parented under the yaw-only airframe root. */
    relYaw: worldYaw - state.yaw,
    relPitch: worldPitch,
    dir: [dx / range, dy / range, dz / range],
  };
}

export const __test = { clamp, lerpFactor };
