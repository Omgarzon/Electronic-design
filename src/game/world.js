/**
 * world.js — the damaged-structure inspection course, built in true metres.
 *
 * Two layouts share one builder:
 *   - full yard for the desktop simulator (40 m slab, 14 m flight bounds)
 *   - compact room kit for WebXR, sized to fit a real living room
 *
 * Everything the game loop needs comes back in one descriptor: colliders for
 * the sphere test, crack targets with marker state, fly-through gates, gust
 * zones, the flight bounds and the home pad.
 */
import * as THREE from 'three';
import { YARD, YARD_AR, COLORS } from './config.js';
import {
  concreteTexture,
  wallTexture,
  crackDecalTexture,
  padTexture,
  labelSprite,
  rng,
} from './textures.js';

const ACCENT = new THREE.Color(COLORS.accent);
const AMBER = new THREE.Color(COLORS.amber);
const GREEN = new THREE.Color(0x57e389);

/* ── small construction helpers ─────────────────────────────────────────── */

function box(w, h, d, material, x, y, z, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Four glowing corner brackets that frame a scannable crack. */
function markerFrame(size) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 });
  const arm = size * 0.16;
  const thick = size * 0.022;
  const geo = new THREE.BoxGeometry(arm, thick, thick);
  const off = size / 2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const h = new THREE.Mesh(geo, mat);
      h.position.set(sx * (off - arm / 2), sy * off, 0);
      group.add(h);
      const v = new THREE.Mesh(geo, mat);
      v.rotation.z = Math.PI / 2;
      v.position.set(sx * off, sy * (off - arm / 2), 0);
      group.add(v);
    }
  }
  group.userData.mat = mat;
  return group;
}

function humanFigure() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2b333d,
    roughness: 0.8,
    transparent: true,
    opacity: 0.82,
  });
  const legGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.82, 10);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(sx * 0.09, 0.41, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.56, 0.22), mat);
  torso.position.y = 1.12;
  torso.castShadow = true;
  g.add(torso);
  const armGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.62, 8);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, mat);
    arm.position.set(sx * 0.26, 1.12, 0);
    g.add(arm);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), mat);
  head.position.y = 1.57;
  g.add(head); // top ≈ 1.69 m, plus a 0.01 base plate = 1.70 m
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.02, 1),
    new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.9 }),
  );
  plate.position.y = 0.01;
  plate.receiveShadow = true;
  g.add(plate);
  return g;
}

function doorFrame() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.85 });
  const postGeo = new THREE.BoxGeometry(0.09, YARD.doorHeight, 0.09);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, mat);
    post.position.set(sx * (YARD.doorWidth / 2 + 0.045), YARD.doorHeight / 2, 0);
    post.castShadow = true;
    g.add(post);
  }
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(YARD.doorWidth + 0.18, 0.1, 0.1),
    mat,
  );
  lintel.position.y = YARD.doorHeight + 0.05;
  lintel.castShadow = true;
  g.add(lintel);
  return g;
}

/* ── gust zone with drifting particle arrows ────────────────────────────── */

function gustZone(center, radius, height, strength) {
  const count = 70;
  const positions = new Float32Array(count * 3);
  const rand = rng(42);
  for (let i = 0; i < count; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    positions[i * 3] = center.x + Math.cos(a) * r;
    positions[i * 3 + 1] = center.y + rand() * height;
    positions[i * 3 + 2] = center.z + Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: COLORS.amber,
    size: 0.09,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  // translucent cylinder so the pilot can see the hazard volume
  const volume = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: COLORS.amber,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  volume.position.copy(center);
  const group = new THREE.Group();
  group.add(volume, points);
  return {
    group,
    points,
    center: center.clone(),
    radius,
    height,
    strength,
    phase: rand() * 10,
  };
}

/* ── main builder ───────────────────────────────────────────────────────── */

export function buildWorld(compact = false) {
  const C = compact ? YARD_AR : YARD;
  const group = new THREE.Group();
  group.name = compact ? 'ar-yard' : 'inspection-yard';
  const colliders = [];
  const targets = [];
  const gates = [];
  const gustZones = [];

  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTexture(compact ? 21 : 13),
    roughness: 0.95,
    metalness: 0.02,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    map: concreteTexture(7, compact ? [3, 3] : [14, 14]),
    roughness: 0.98,
  });

  /* ground + metre grid */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(C.ground, C.ground), concreteMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const grid = new THREE.GridHelper(C.ground, C.grid, 0x3d5a55, 0x22302e);
  grid.position.y = 0.012;
  grid.material.transparent = true;
  grid.material.opacity = compact ? 0.5 : 0.42;
  group.add(grid);

  /* landing pad, 1.8 m diameter */
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 48),
    new THREE.MeshBasicMaterial({ map: padTexture(), transparent: true, depthWrite: false }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.02;
  group.add(pad);

  const addWall = (w, h, d, x, z) => {
    // Course walls are axis-aligned, so the collider is a plain AABB.
    const m = box(w, h, d, wallMat, x, h / 2, z);
    group.add(m);
    colliders.push({
      tag: 'wall',
      box: new THREE.Box3(
        new THREE.Vector3(x - w / 2, 0, z - d / 2),
        new THREE.Vector3(x + w / 2, h, z + d / 2),
      ),
    });
    return m;
  };

  const addTarget = (id, x, y, z, nx, ny, nz, thermal, seed) => {
    const t = new THREE.Group();
    const size = 0.95;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: crackDecalTexture(seed, thermal),
        transparent: true,
        depthWrite: false,
        opacity: thermal ? 0.25 : 0.95,
      }),
    );
    const frame = markerFrame(size * 1.18);
    t.add(decal, frame);
    t.position.set(x, y, z);
    t.lookAt(x + nx, y + ny, z + nz);
    group.add(t);
    const target = {
      id,
      thermal,
      pos: new THREE.Vector3(x, y, z),
      normal: new THREE.Vector3(nx, ny, nz).normalize(),
      group: t,
      frame,
      decal,
      scanned: false,
      progress: 0,
    };
    setTargetState(target, 'idle');
    targets.push(target);
    return target;
  };

  const addGate = (x, y, z, ry) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x162029,
      emissive: COLORS.accent,
      emissiveIntensity: 0.55,
      roughness: 0.5,
      metalness: 0.4,
    });
    const radius = 1.2; // 2.4 m opening clears the 1.87 m airframe
    const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.055, 12, 48), mat);
    torus.position.set(x, y, z);
    torus.rotation.y = ry;
    torus.castShadow = true;
    group.add(torus);
    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    gates.push({
      mesh: torus,
      mat,
      pos: new THREE.Vector3(x, y, z),
      normal,
      radius,
      passed: false,
    });
  };

  if (compact) {
    /* ── room-sized AR kit ─────────────────────────────────────────────── */
    addWall(3.4, 2.4, 0.24, 0, 2.6);
    addTarget('t1', 0.55, 1.7, 2.47, 0, 0, -1, false, 31);
    addTarget('t2', -0.85, 1.05, 2.47, 0, 0, -1, true, 37);
    addGate(0, 1.5, 1.3, 0);

    const human = humanFigure();
    human.position.set(-2.0, 0, 0.9);
    group.add(human);
    const label = labelSprite('1.70 m reference');
    label.position.set(-2.0, 1.95, 0.9);
    group.add(label);
  } else {
    /* ── full simulator course ─────────────────────────────────────────── */
    // Main inspection wall with a doorway gap.
    addWall(4.9, 3.0, 0.3, -3.55, 7);
    addWall(4.9, 3.0, 0.3, 3.55, 7);
    addTarget('t1', -3.6, 1.9, 6.84, 0, 0, -1, false, 11);
    addTarget('t2', 3.4, 2.3, 6.84, 0, 0, -1, false, 17);

    // Side wall carrying a thermal-only crack (rotated 90°, explicit AABB).
    const sideWall = box(7.0, 3.0, 0.3, wallMat, -6.5, 1.5, 5.5, Math.PI / 2);
    group.add(sideWall);
    colliders.push({
      tag: 'wall',
      box: new THREE.Box3(new THREE.Vector3(-6.65, 0, 2.0), new THREE.Vector3(-6.35, 3.0, 9.0)),
    });
    addTarget('t3', -6.34, 1.7, 5.2, 1, 0, 0, true, 23);

    // Low damaged return wall, second thermal target.
    addWall(6.0, 1.4, 0.3, -1.0, -4.5);
    addTarget('t4', -1.2, 0.85, -4.34, 0, 0, 1, true, 29);

    // Inspection columns, one with a visual crack.
    const col1 = box(0.55, 2.6, 0.55, wallMat, 4.6, 1.3, 3.0);
    group.add(col1);
    colliders.push({
      tag: 'column',
      box: new THREE.Box3(new THREE.Vector3(4.325, 0, 2.725), new THREE.Vector3(4.875, 2.6, 3.275)),
    });
    addTarget('t5', 4.6, 1.5, 2.71, 0, 0, -1, false, 41);

    const col2 = box(0.5, 2.2, 0.5, wallMat, -2.6, 1.1, -2.4);
    group.add(col2);
    colliders.push({
      tag: 'column',
      box: new THREE.Box3(new THREE.Vector3(-2.85, 0, -2.65), new THREE.Vector3(-2.35, 2.2, -2.15)),
    });

    // Rubble / brick piles.
    const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x6e5b4e, roughness: 1 });
    const pile1 = box(1.5, 0.5, 0.95, rubbleMat, 5.9, 0.25, 5.3);
    const pile2 = box(0.85, 0.45, 0.7, rubbleMat, 6.45, 0.72, 5.65);
    const pile3 = box(0.7, 0.35, 0.6, rubbleMat, 5.35, 0.67, 5.75);
    group.add(pile1, pile2, pile3);
    colliders.push({
      tag: 'rubble',
      box: new THREE.Box3(new THREE.Vector3(5.1, 0, 4.8), new THREE.Vector3(6.9, 0.95, 6.1)),
    });

    // Exposed rebar rods.
    const rebarMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.7, metalness: 0.6 });
    for (let i = 0; i < 5; i += 1) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 1.3, 6), rebarMat);
      rod.position.set(6.5 + (i % 2) * 0.25, 0.55, -2.8 - i * 0.18);
      rod.rotation.z = 0.35 + i * 0.05;
      rod.castShadow = true;
      group.add(rod);
    }

    addGate(0, 2.0, 3.4, 0);
    addGate(-3.6, 2.1, 5.4, -0.75);
    addGate(3.0, 1.7, 0.6, 2.4);

    const gust = gustZone(new THREE.Vector3(2.6, 1.5, 5.6), 1.7, 3.2, 3.4);
    group.add(gust.group);
    gustZones.push(gust);

    const human = humanFigure();
    human.position.set(-4.2, 0, 1.4);
    group.add(human);
    const hLabel = labelSprite('1.70 m human reference');
    hLabel.position.set(-4.2, 1.98, 1.4);
    group.add(hLabel);

    const door = doorFrame();
    door.position.set(7.6, 0, -0.5);
    group.add(door);
    const dLabel = labelSprite('2.10 × 0.90 m doorway');
    dLabel.position.set(7.6, 2.42, -0.5);
    group.add(dLabel);

    const padLabel = labelSprite('home pad · 1 m grid');
    padLabel.position.set(0, 1.0, -1.4);
    padLabel.scale.set(1.3, 0.33, 1);
    group.add(padLabel);
  }

  return {
    compact,
    group,
    colliders,
    targets,
    gates,
    gustZones,
    bounds: { x: C.bound, z: C.bound, ceiling: C.ceiling },
    home: new THREE.Vector3(0, 0, 0),
    update(time, dt, thermalOn) {
      /* gust particles drift along the local wind and wrap inside the can */
      const wind = new THREE.Vector3();
      for (const zone of gustZones) {
        windAt(zone, wind, time);
        const attr = zone.points.geometry.attributes.position;
        for (let i = 0; i < attr.count; i += 1) {
          attr.array[i * 3] += wind.x * dt;
          attr.array[i * 3 + 1] += wind.y * dt * 0.4;
          attr.array[i * 3 + 2] += wind.z * dt;
          const dx = attr.array[i * 3] - zone.center.x;
          const dz = attr.array[i * 3 + 2] - zone.center.z;
          if (dx * dx + dz * dz > zone.radius * zone.radius) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * zone.radius * 0.4;
            attr.array[i * 3] = zone.center.x + Math.cos(a) * r;
            attr.array[i * 3 + 2] = zone.center.z + Math.sin(a) * r;
            attr.array[i * 3 + 1] = zone.center.y + Math.random() * zone.height;
          }
        }
        attr.needsUpdate = true;
      }
      /* thermal markers hide until the thermal core is selected */
      for (const t of targets) {
        if (!t.thermal || t.scanned) continue;
        const targetOpacity = thermalOn ? 0.95 : 0.22;
        t.decal.material.opacity += (targetOpacity - t.decal.material.opacity) * Math.min(1, 8 * dt);
        t.frame.visible = thermalOn;
      }
    },
  };
}

/* ── runtime queries ────────────────────────────────────────────────────── */

/** Gust acceleration (m/s²) inside a gust can, written into `out`. */
export function windAt(zone, out, time) {
  const sway = Math.sin(time * 0.9 + zone.phase);
  const gust = 0.65 + 0.35 * Math.sin(time * 2.3 + zone.phase * 1.7);
  return out.set(
    zone.strength * gust,
    0.25 * sway,
    zone.strength * 0.35 * Math.cos(time * 1.3 + zone.phase),
  );
}

export function isInsideGust(zone, pos) {
  const dx = pos.x - zone.center.x;
  const dz = pos.z - zone.center.z;
  const dy = pos.y - zone.center.y;
  return (
    dx * dx + dz * dz <= zone.radius * zone.radius &&
    dy >= -zone.height / 2 &&
    dy <= zone.height / 2
  );
}

/** Marker colour state: idle → lock → scanning → done. */
export function setTargetState(target, state) {
  const mat = target.frame.userData.mat;
  if (state === 'done') {
    mat.color.copy(GREEN);
    target.decal.material.color = new THREE.Color(0x9ff5c4);
  } else if (state === 'scanning') {
    mat.color.copy(ACCENT);
  } else if (state === 'lock') {
    mat.color.copy(AMBER);
  } else {
    mat.color.copy(target.thermal ? new THREE.Color(COLORS.thermal) : ACCENT);
    target.decal.material.color.set(0xffffff);
  }
}

export function setGateState(gate, passed) {
  gate.passed = passed;
  gate.mat.emissive.copy(passed ? GREEN : ACCENT);
  gate.mat.emissiveIntensity = passed ? 0.9 : 0.55;
}
