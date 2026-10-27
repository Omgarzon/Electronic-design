/**
 * config.js — every measured and tuned constant for the inspection game.
 *
 * SCALE
 * The drone GLB is authored in real metres: its decoded bounding box is
 *   x −0.94 … 0.94  (1.87 m prop-tip span)
 *   y  0.00 … 0.77  (0.77 m tall, origin on the skid contact line)
 *   z −0.79 … 0.79  (1.58 m long, front = +Z)
 * so the rig is never scaled. The whole virtual yard is built in the same
 * metre grid, and WebXR hit-test placement reproduces that 1:1 scale in a
 * real room.
 */

export const DRONE = {
  /** Measured from assets/models/drone-pbr.glb (metres). */
  span: 1.87,
  length: 1.58,
  height: 0.77,
  /** 24-inch folding propellers → 0.61 m disc, 0.305 m radius. */
  propDiameter: 0.61,
  propRadius: 0.305,
  /** Motor mast positions derived from the prop-tip extents. */
  motors: [
    { x: 0.635, y: 0.44, z: 0.485 },
    { x: -0.635, y: 0.44, z: 0.485 },
    { x: 0.635, y: 0.44, z: -0.485 },
    { x: -0.635, y: 0.44, z: -0.485 },
  ],
  /** PMB-1.3 dual-sensor head, from the annotation anchors (metres). */
  sensor: { x: 0.02, y: 0.6, z: 0.34 },
  /** Centre of mass the airframe tilts around (metres up from skids). */
  comY: 0.35,
  /** Collision sphere centred on the CoM; slightly inside the prop tips. */
  collisionRadius: 0.82,
  /** Reference all-up mass, airframe + 1.3 kg PMB-1.3 payload (kg). */
  mass: 3.4,
  /** Reference pack (Wh). Endurance is time-compressed for the sortie. */
  batteryWh: 98,
};

/** Attitude-mode quadcopter flight envelope, tuned for an inspection rig. */
export const FLIGHT = {
  gravity: 9.81,
  maxTilt: 0.42, // ~24° of pitch/roll
  maxYawRate: 1.7, // rad/s
  maxClimbRate: 2.8, // m/s
  maxSpeed: 9.0, // m/s horizontal clamp
  attitudeGain: 7.0, // how fast the airframe reaches its tilt setpoint
  verticalP: 3.4, // climb-rate P gain on collective thrust
  dragH: 0.55, // horizontal exponential drag
  dragV: 0.9,
  groundFriction: 4.5,
  /** Landing impact above this vertical speed (m/s) counts as a hard one. */
  hardLanding: 1.6,
};

/** Sensor / gimbal performance, mirroring the PMB-1.3 specification. */
export const SENSOR = {
  maxRange: 7.0, // m
  minRange: 1.1, // m
  lockAngle: 0.22, // ~12.6° half-cone for a stable lock
  scanAngle: 0.14, // ~8° half-cone while grading
  maxScanSpeed: 2.0, // m/s over ground — the gimbal needs a steady platform
  scanSeconds: 3.2, // time to grade one crack
  /** Battery fraction per second: hover drain ≈ 7-minute aggressive sortie. */
  drainBase: 0.0011,
  drainThrust: 0.0016,
  drainSensor: 0.00035,
  rthThreshold: 0.2,
  deadThreshold: 0.0,
};

/** Scoring. */
export const SCORE = {
  visualCrack: 1000,
  thermalCrack: 1500,
  gate: 250,
  collision: 150,
  hardLanding: 100,
  batteryBonus: 1200, // paid on the fraction still in the pack at landing
  timeBonusPerSecond: 8,
};

/** Course geometry for the full simulator yard (metres). */
export const YARD = {
  ground: 40,
  grid: 40,
  bound: 14, // soft flight boundary, ± on x and z
  ceiling: 6,
  humanHeight: 1.7,
  doorHeight: 2.1,
  doorWidth: 0.9,
};

/** Compact course used inside a real room through WebXR (metres). */
export const YARD_AR = {
  ground: 8,
  grid: 8,
  bound: 3.2,
  ceiling: 3.0,
};

export const COLORS = {
  accent: 0x4ff0c0,
  amber: 0xffb35c,
  danger: 0xff7a7a,
  thermal: 0xff8a3d,
  ink: 0xe9f0f8,
};
