/**
 * viewer.js — the Three.js render stage for the PMB-1.3 hero.
 *
 * Imported lazily from main.js so the page paints before Three.js is parsed.
 * Callbacks keep the DOM work (annotation labels, progress pill) in main.js.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ANCHORS } from './annotations.js';

const MODELS = {
  pbr: { url: 'assets/models/drone-pbr.glb', label: 'PBR' },
  baked: { url: 'assets/models/drone-shaded.glb', label: 'Baked' },
};

const HOME = { azimuth: 34, elevation: 17 };
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const context =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return Boolean(window.WebGLRenderingContext && context);
  } catch {
    return false;
  }
}

/**
 * Detect CPU rasterisers (SwiftShader / llvmpipe / software WebGL). These can
 * create a context but not sustain a 60 fps scene, so the caller falls back to
 * the rendered poster instead of shipping a janky experience.
 */
export function isSoftwareRenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (!info) return false;
    const name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    return /swiftshader|llvmpipe|software|basic render|microsoft basic/.test(name);
  } catch {
    return false;
  }
}

/* ── procedural turntable floor ───────────────────────────────────────────── */

function createFloorTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const TAU = Math.PI * 2;

  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(120, 190, 210, 0.15)');
  glow.addColorStop(0.45, 'rgba(90, 150, 180, 0.06)');
  glow.addColorStop(1, 'rgba(80, 140, 170, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(150, 205, 225, 0.3)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.86, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(150, 205, 225, 0.18)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.74, 0, TAU);
  ctx.stroke();

  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg / 360) * TAU - Math.PI / 2;
    const major = deg % 30 === 0;
    const inner = c * (major ? 0.86 : 0.905);
    const outer = c * 0.955;
    ctx.strokeStyle = major ? 'rgba(150, 215, 235, 0.5)' : 'rgba(150, 205, 225, 0.2)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
    ctx.lineTo(c + Math.cos(a) * outer, c + Math.sin(a) * outer);
    ctx.stroke();
  }

  ctx.setLineDash([6, 14]);
  ctx.strokeStyle = 'rgba(150, 205, 225, 0.14)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.58, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* ── viewer ───────────────────────────────────────────────────────────────── */

export async function createViewer({
  canvas,
  stage,
  desktopQuery,
  initialMaterial = 'pbr',
  initialAnnotations = true,
  initialAutoRotate = true,
  onProgress = () => {},
  onAnchorFrame = () => {},
  onReady = () => {},
}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.1;
  controls.maxDistance = 8;
  controls.minPolarAngle = 0.16;
  controls.maxPolarAngle = Math.PI * 0.492;
  controls.rotateSpeed = 0.8;
  controls.zoomSpeed = 0.65;
  controls.autoRotate = Boolean(initialAutoRotate);
  controls.autoRotateSpeed = 0.4;

  /* environment: soft studio reflections for the PBR material */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envTexture = pmrem.fromScene(envScene, 0.04).texture;
  envScene.traverse((object) => {
    if (object.isMesh) {
      object.geometry.dispose();
      object.material.dispose();
    }
  });
  pmrem.dispose();
  scene.environment = envTexture;
  scene.environmentIntensity = 0.8;

  /* light rig — key light casts the contact shadow, rims separate the edges */
  const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.6);
  keyLight.position.set(3.2, 5.4, 2.6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 16;
  keyLight.shadow.camera.left = -2.2;
  keyLight.shadow.camera.right = 2.2;
  keyLight.shadow.camera.top = 2.2;
  keyLight.shadow.camera.bottom = -2.2;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.012;
  keyLight.shadow.radius = 3;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x7fb4ff, 2.1);
  rimLight.position.set(-4.5, 2.2, -3.4);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0x5ff0c8, 0.7);
  fillLight.position.set(-1.5, 1.2, 4);
  scene.add(fillLight);

  scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x0a1018, 0.5));

  /* floor: contact shadow + procedural instrument turntable */
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.5 }),
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  const floorTexture = createFloorTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 5.4),
    new THREE.MeshBasicMaterial({
      map: floorTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.85,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.003;
  scene.add(floor);

  /* ── loading ───────────────────────────────────────────────────────────── */

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const models = {};
  const loading = new Map();
  let reportProgress = true;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  let radius = 1.3;
  let activeMaterial = 'pbr';
  let annotationsOn = Boolean(initialAnnotations);
  let focused = false;
  let layout = { desktop: true };

  function prepare(gltfScene, kind) {
    gltfScene.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = kind === 'pbr';
      object.receiveShadow = false;
      object.frustumCulled = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.envMapIntensity = kind === 'pbr' ? 1 : 0;
        material.needsUpdate = true;
      }
    });
    models[kind] = gltfScene;
    gltfScene.visible = false;
    scene.add(gltfScene);
    return gltfScene;
  }

  function loadModel(kind) {
    if (loading.has(kind)) return loading.get(kind);
    const { url, label } = MODELS[kind];
    const promise = new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => resolve(prepare(gltf.scene, kind)),
        (event) => {
          if (!reportProgress) return;
          if (event.lengthComputable && event.total) {
            onProgress({ ratio: Math.min(event.loaded / event.total, 1), label: `Loading ${label} model` });
          } else {
            onProgress({ indeterminate: true, label: `Loading ${label} model` });
          }
        },
        reject,
      );
    });
    loading.set(kind, promise);
    return promise;
  }

  const model = await loadModel(initialMaterial === 'baked' ? 'baked' : 'pbr');
  model.visible = true;
  activeMaterial = initialMaterial === 'baked' ? 'baked' : 'pbr';

  const bounds = new THREE.Box3().setFromObject(model);
  bounds.getSize(size);
  bounds.getCenter(center);
  radius = size.length() / 2;

  /* ── projection targets for the annotation labels ──────────────────────── */

  const anchorPoints = ANCHORS.map((anchor) => ({
    ...anchor,
    point: new THREE.Vector3(...anchor.position),
  }));
  const projected = new THREE.Vector3();
  const frame = [];

  /* ── framing ───────────────────────────────────────────────────────────── */

  function updateLayout() {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    layout = { desktop: desktopQuery.matches };

    const shift = focused || !layout.desktop ? 0 : width * 0.115;
    if (shift) camera.setViewOffset(width, height, -shift, -height * 0.03, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /* Home direction: the camera orbits on this vector around the target. */
  const homeDirection = (() => {
    const az = THREE.MathUtils.degToRad(HOME.azimuth);
    const el = THREE.MathUtils.degToRad(HOME.elevation);
    return new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    ).normalize();
  })();

  const framingTarget = new THREE.Vector3();
  const corners = [];
  for (let i = 0; i < 8; i += 1) {
    corners.push(
      new THREE.Vector3(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z,
      ),
    );
  }
  const probe = new THREE.Vector3();

  /**
   * Frame the model by projecting its bounding-box corners and shrinking the
   * orbit radius until they fit the safe area. Two or three iterations
   * converge because projected size is near-linear in distance.
   */
  function frameModel() {
    framingTarget.set(center.x, center.y - 0.02, center.z);

    const limits = focused
      ? { x: 0.84, y: 0.72 }
      : layout.desktop
        ? { x: 0.78, y: 0.66 }
        : { x: 0.84, y: 0.66 };

    let distance = radius * 2.6;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      camera.position.copy(framingTarget).addScaledVector(homeDirection, distance);
      camera.lookAt(framingTarget);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();

      let extentX = 0;
      let extentY = 0;
      for (const corner of corners) {
        probe.copy(corner).project(camera);
        extentX = Math.max(extentX, Math.abs(probe.x));
        extentY = Math.max(extentY, Math.abs(probe.y));
      }

      const correction = Math.max(extentX / limits.x, extentY / limits.y);
      if (!Number.isFinite(correction) || Math.abs(correction - 1) < 0.004) break;
      distance = THREE.MathUtils.clamp(distance * correction, 0.6, 40);
    }

    controls.target.copy(framingTarget);
    controls.update();
  }

  updateLayout();
  frameModel();

  /* intro: drift in from a wider, higher angle */
  let intro = null;
  const cancelIntro = () => {
    if (!intro) return;
    intro = null;
    controls.enabled = true;
  };
  if (!REDUCED_MOTION) {
    const from = new THREE.Vector3(-2.4, 2.5, 5.6).add(center);
    const to = camera.position.clone();
    intro = { from, to, start: performance.now(), duration: 1600 };
    camera.position.copy(from);
    controls.enabled = false;
    canvas.addEventListener('pointerdown', cancelIntro, { passive: true, once: true });
    window.addEventListener('keydown', cancelIntro, { passive: true, once: true });
  }

  /* ── render loop ───────────────────────────────────────────────────────── */

  let running = false;
  let onScreen = true;
  let rafId = 0;
  const clock = new THREE.Clock();

  function emitAnchors() {
    if (!annotationsOn) {
      onAnchorFrame([]);
      return;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    frame.length = 0;
    for (const anchor of anchorPoints) {
      projected.copy(anchor.point).project(camera);
      frame.push({
        id: anchor.id,
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
        visible:
          projected.z < 1 &&
          projected.x > -1.15 &&
          projected.x < 1.15 &&
          projected.y > -1.15 &&
          projected.y < 1.15,
      });
    }
    onAnchorFrame(frame);
  }

  function render() {
    const delta = clock.getDelta();

    if (intro) {
      const t = Math.min((performance.now() - intro.start) / intro.duration, 1);
      const eased = easeOutCubic(t);
      camera.position.lerpVectors(intro.from, intro.to, eased);
      camera.lookAt(controls.target);
      if (t === 1) {
        intro = null;
        controls.enabled = true;
      }
    } else {
      controls.update(delta);
    }

    renderer.render(scene, camera);
    emitAnchors();
  }

  function tick() {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (!onScreen) return;
    render();
  }

  function start() {
    if (running) return;
    running = true;
    clock.getDelta();
    tick();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  /* draw only while the stage is in view */
  const stageObserver = new IntersectionObserver(
    (entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (onScreen) render();
    },
    { threshold: 0 },
  );
  stageObserver.observe(stage);

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  const onResize = () => {
    updateLayout();
    render();
  };
  window.addEventListener('resize', onResize, { passive: true });
  if (desktopQuery.addEventListener) desktopQuery.addEventListener('change', onResize);

  /* ── public API ────────────────────────────────────────────────────────── */

  function setMaterial(kind) {
    const next = MODELS[kind] ? kind : 'pbr';
    if (next === activeMaterial && models[next]) return Promise.resolve(activeMaterial);

    const apply = (scene3d) => {
      if (models[activeMaterial]) models[activeMaterial].visible = false;
      scene3d.visible = true;
      activeMaterial = next;
      setAnnotations(annotationsOn);
      render();
      return activeMaterial;
    };

    if (models[next]) {
      onProgress(null);
      return Promise.resolve(apply(models[next]));
    }
    onProgress({ label: `Loading ${MODELS[next].label} set`, indeterminate: true });
    return loadModel(next).then((scene3d) => {
      onProgress(null);
      return apply(scene3d);
    });
  }

  function setAnnotations(on) {
    annotationsOn = Boolean(on);
    if (!annotationsOn) onAnchorFrame([]);
    else emitAnchors();
    return annotationsOn;
  }

  function setAutoRotate(on) {
    controls.autoRotate = Boolean(on);
  }

  function focus() {
    focused = true;
    updateLayout();
    frameModel();
    render();
  }

  function reset() {
    focused = false;
    document.body.classList.remove('is-focus');
    updateLayout();
    frameModel();
    render();
  }

  async function snapshot() {
    renderer.render(scene, camera);
    const source = renderer.domElement;
    const width = Math.min(source.width, 2400);
    const scale = width / source.width;
    const height = Math.round(source.height * scale);

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, width * 0.7, height);
    gradient.addColorStop(0, '#0b131c');
    gradient.addColorStop(1, '#06090d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);

    const pad = Math.round(width * 0.032);
    ctx.fillStyle = 'rgba(233, 240, 248, 0.92)';
    ctx.font = `600 ${Math.round(width * 0.022)}px "Space Grotesk", system-ui, sans-serif`;
    ctx.fillText('B0GOTA · PMB-1.3', pad, pad + width * 0.02);
    ctx.fillStyle = 'rgba(79, 240, 192, 0.92)';
    ctx.font = `500 ${Math.round(width * 0.0115)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(
      `STRUCTURAL INSPECTION PAYLOAD · ${activeMaterial.toUpperCase()} · ${new Date()
        .toISOString()
        .slice(0, 10)}`,
      pad,
      pad + width * 0.043,
    );

    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pmb-1.3-${activeMaterial}-${Date.now()}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }

  /* keyboard orbiting — the canvas is focusable, so the model stays reachable
     without a pointer device. Arrows rotate, +/- zoom, 0 re-frames. */
  canvas.setAttribute('tabindex', '0');
  canvas.addEventListener('keydown', (event) => {
    const step = THREE.MathUtils.degToRad(6);
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);

    switch (event.key) {
      case 'ArrowLeft':
        spherical.theta -= step;
        break;
      case 'ArrowRight':
        spherical.theta += step;
        break;
      case 'ArrowUp':
        spherical.phi = Math.max(controls.minPolarAngle, spherical.phi - step);
        break;
      case 'ArrowDown':
        spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + step);
        break;
      case '+':
      case '=':
        spherical.radius = Math.max(controls.minDistance, spherical.radius * 0.92);
        break;
      case '-':
      case '_':
        spherical.radius = Math.min(controls.maxDistance, spherical.radius / 0.92);
        break;
      case '0':
        reset();
        return;
      default:
        return;
    }

    event.preventDefault();
    cancelIntro();
    offset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
    controls.update();
    render();
  });

  /* warm the second material set once the page is idle */
  const prefetch = () => {
    if (navigator.connection?.saveData || !navigator.onLine) return;
    reportProgress = false;
    loadModel('baked')
      .catch(() => {})
      .finally(() => {
        reportProgress = true;
      });
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(prefetch, { timeout: 9000 });
  else window.setTimeout(prefetch, 5000);

  start();
  onReady();

  return {
    setMaterial,
    setAnnotations,
    setAutoRotate,
    focus,
    reset,
    snapshot,
    render,
    get material() {
      return activeMaterial;
    },
    dispose() {
      stop();
      stageObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      desktopQuery.removeEventListener?.('change', onResize);
      for (const gltfScene of Object.values(models)) {
        gltfScene.traverse((object) => {
          if (!object.isMesh) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        });
      }
      envTexture.dispose();
      floorTexture.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      shadowCatcher.geometry.dispose();
      shadowCatcher.material.dispose();
      controls.dispose();
      renderer.dispose();
    },
  };
}
