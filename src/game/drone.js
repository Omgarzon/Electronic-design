/**
 * drone.js — the PMB-1.3 airframe as a controllable rig.
 *
 *   root  (position = flight state, rotation.y = yaw)
 *    └─ tiltPivot at CoM height (rotation.x/z = pitch/roll)
 *       └─ glb model, shifted down so its skids sit on the root origin
 *       └─ four rotor blur discs on the real motor masts
 *    └─ gimbal (yaw root only — it counter-rotates to stay world-stable)
 *       └─ lens glow + sensor beam
 *    └─ rotor wash ring on the ground
 *
 * The GLB is already modelled in metres with its origin on the skid contact
 * line, so no scale is ever applied.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRONE } from './config.js';
import { rotorDiscTexture, heatSpriteTexture } from './textures.js';

const MODEL_URL = 'assets/models/drone-pbr.glb';
const COLOR_ACCENT = new THREE.Color(0x4ff0c0);
const COLOR_THERMAL = new THREE.Color(0xff8a3d);
const COLOR_IDLE = new THREE.Color(0x8d9cb0);

export async function loadDroneModel(onProgress = () => {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(MODEL_URL, (event) => {
    if (event.total) onProgress(event.loaded / event.total);
  });
  const model = gltf.scene;
  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // The inspection body is matte; keep metal parts from glowing.
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m && 'envMapIntensity' in m) m.envMapIntensity = 0.85;
      }
    }
  });
  return model;
}

export class DroneRig {
  constructor(model) {
    this.group = new THREE.Group();
    this.group.name = 'drone-root';

    /* ── tilt pivot around the centre of mass ──────────────────────────── */
    this.tilt = new THREE.Group();
    this.tilt.position.y = DRONE.comY;
    this.group.add(this.tilt);

    model.position.y = -DRONE.comY;
    this.tilt.add(model);
    this.model = model;

    /* ── rotor blur discs (the GLB props are baked into one static mesh) ─ */
    const discTex = rotorDiscTexture();
    this.rotors = [];
    const discGeo = new THREE.CircleGeometry(DRONE.propRadius, 48);
    for (const m of DRONE.motors) {
      const mat = new THREE.MeshBasicMaterial({
        map: discTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(discGeo, mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(m.x, m.y - DRONE.comY, m.z);
      this.tilt.add(disc);
      this.rotors.push(disc);
    }

    /* ── stabilized gimbal / sensor aim rig ────────────────────────────── */
    this.gimbal = new THREE.Group();
    this.gimbal.position.set(DRONE.sensor.x, DRONE.sensor.y, DRONE.sensor.z);
    this.group.add(this.gimbal);

    this.lens = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x4ff0c0 }),
    );
    this.lens.position.z = 0.05;
    this.gimbal.add(this.lens);

    // lock-on beam, updated per frame
    this.beamMat = new THREE.LineBasicMaterial({
      color: 0x4ff0c0,
      transparent: true,
      opacity: 0,
    });
    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0.06),
      new THREE.Vector3(0, 0, 1),
    ]);
    this.beam = new THREE.Line(beamGeo, this.beamMat);
    this.gimbal.add(this.beam);

    this.heat = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: heatSpriteTexture(),
        color: 0xff8a3d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.heat.scale.set(0.22, 0.22, 0.22);
    this.gimbal.add(this.heat);

    /* ── ground rotor wash ─────────────────────────────────────────────── */
    this.washMat = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.wash = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.62, 48), this.washMat);
    this.wash.rotation.x = -Math.PI / 2;
    this.group.add(this.wash);
  }

  /** World-space position of the sensor lens, for range/angle tests. */
  sensorWorld(target = new THREE.Vector3()) {
    // localToWorld so this stays correct when the AR yard is placed in a room
    return this.group.localToWorld(
      target.set(DRONE.sensor.x, DRONE.sensor.y, DRONE.sensor.z),
    );
  }

  /**
   * @param {object} s flight state
   * @param {object} aim {relYaw, relPitch, locked, scanning, range} | null
   * @param {boolean} thermal whether the thermal core is selected
   */
  update(s, aim, thermal, dt) {
    this.group.position.set(s.p[0], s.p[1], s.p[2]);
    this.group.rotation.y = s.yaw;
    this.tilt.rotation.x = s.pitch;
    this.tilt.rotation.z = s.roll;

    /* rotors: spin speed and disc opacity follow simulated RPM */
    for (let i = 0; i < 4; i += 1) {
      const disc = this.rotors[i];
      disc.rotation.z += s.rpm[i] * 46 * dt;
      const targetOpacity = s.airborne ? 0.12 + s.rpm[i] * 0.42 : Math.max(0, s.rpm[i] - 0.1) * 0.5;
      disc.material.opacity += (targetOpacity - disc.material.opacity) * Math.min(1, 10 * dt);
      disc.visible = disc.material.opacity > 0.02;
    }

    /* gimbal tracks the chosen target, else looks straight ahead */
    const targetYaw = aim ? aim.relYaw : 0;
    const targetPitch = aim ? aim.relPitch : 0;
    this.gimbal.rotation.y += (targetYaw - this.gimbal.rotation.y) * Math.min(1, 12 * dt);
    this.gimbal.rotation.x += (targetPitch - this.gimbal.rotation.x) * Math.min(1, 12 * dt);

    const lensColor = thermal ? COLOR_THERMAL : aim?.locked ? COLOR_ACCENT : COLOR_IDLE;
    this.lens.material.color.lerp(lensColor, Math.min(1, 8 * dt));

    /* beam only while locked, stretched to the target */
    const showBeam = Boolean(aim?.locked);
    this.beamMat.opacity += ((showBeam ? (aim.scanning ? 0.85 : 0.4) : 0) - this.beamMat.opacity) * Math.min(1, 10 * dt);
    if (showBeam) {
      this.beam.scale.z = aim.range;
      this.beamMat.color.copy(thermal ? COLOR_THERMAL : COLOR_ACCENT);
    }

    /* thermal core heat shimmer at the lens */
    this.heat.material.opacity += ((thermal ? 0.85 : 0) - this.heat.material.opacity) * Math.min(1, 6 * dt);
    const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.12;
    this.heat.scale.set(0.22 * pulse, 0.22 * pulse, 1);

    /* rotor wash ring stays on the ground under the airframe */
    this.wash.position.y = 0.02 - s.p[1];
    const groundEffect = s.airborne ? THREE.MathUtils.clamp(1 - s.p[1] / 2.2, 0, 1) : 0;
    this.washMat.opacity += (groundEffect * 0.35 * s.rpmNorm - this.washMat.opacity) * Math.min(1, 8 * dt);
    const washScale = 1 + (1 - groundEffect) * 0.9 + performance.now() * 0.0006 % 0.25;
    this.wash.scale.setScalar(washScale);
    this.wash.rotation.z += dt * 3 * s.rpmNorm;
  }
}
