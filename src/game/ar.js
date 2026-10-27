/**
 * ar.js — the mixed-reality session.
 *
 * A handheld immersive-ar session gives us camera passthrough and a hit-test
 * source against real surfaces. The pilot taps a floor to place the compact
 * inspection yard at a true 1:1 metre scale; from then on the same flight
 * model, gimbal and scanning logic used in the simulator run against the
 * real room. DOM controls ride along through the optional dom-overlay.
 */
import * as THREE from 'three';

export async function arSupported() {
  if (!('xr' in navigator) || !navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

export class ARSession {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.session = null;
    this.hitTestSource = null;
    this.placed = false;
    this.onPlace = null;
    this.onEnd = null;

    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 48),
      new THREE.MeshBasicMaterial({
        color: 0x4ff0c0,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    scene.add(this.reticle);
  }

  async start() {
    const renderer = this.renderer;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.setClearColor(0x000000, 0);

    this.session = await navigator.xr.requestSession('immersive-ar', {
      optionalFeatures: ['local-floor', 'hit-test', 'dom-overlay'],
      domOverlay: { root: document.body },
    });

    await renderer.xr.setSession(this.session);

    const viewerSpace = await this.session.requestReferenceSpace('viewer');
    this.hitTestSource = await this.session.requestHitTestSource({ space: viewerSpace });
    this.refSpace = renderer.xr.getReferenceSpace();

    this.session.addEventListener('selectstart', () => {
      if (this.reticle.visible && !this.placed) {
        this.placed = true;
        this.reticle.visible = false;
        this.onPlace?.(this.reticle.matrix.clone());
      }
    });
    this.session.addEventListener('end', () => {
      this.session = null;
      this.placed = false;
      this.reticle.visible = false;
      this.onEnd?.();
    });
  }

  /** Called every animation frame while the session runs. */
  poll(frame) {
    if (!this.session || !this.hitTestSource || this.placed) return;
    const results = frame?.getHitTestResults?.(this.hitTestSource) ?? [];
    if (results.length === 0) {
      this.reticle.visible = false;
      return;
    }
    const pose = results[0].getPose(this.refSpace);
    if (!pose) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.matrix.fromArray(pose.transform.matrix);
  }

  async end() {
    try {
      this.hitTestSource = null;
      await this.session?.end();
    } catch {
      /* session already gone */
    }
  }
}
