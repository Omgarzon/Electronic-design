/**
 * graphics.js — WebGL capability detection and renderer quality profiles.
 *
 * The showcase (src/viewer.js) already refuses to start on software
 * rasterisers; the game needs the same checks plus a low-fidelity profile so
 * a weak GPU, a crashed context or hardware acceleration being disabled can
 * never drop the player onto a silent black screen.
 *
 * Detection is memoised: boot (main.js) and the renderer bootstrap (game.js)
 * share one result, and the optional `?quality=low|high` URL param overrides
 * the automatic choice for testing and for manual recovery.
 */

/**
 * Renderer settings for the two fidelity tiers. `high` matches the original
 * launch configuration; `low` removes the workloads that most often crash
 * Windows GPU processes: MSAA, 2× device pixels and the 2048² shadow map.
 */
export const QUALITY_PROFILES = {
  high: {
    id: 'high',
    antialias: true,
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
  },
  low: {
    id: 'low',
    antialias: false,
    pixelRatioCap: 1.25,
    shadows: true,
    shadowMapSize: 1024,
  },
};

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
 * create a context but cannot sustain a 394k-triangle shadowed scene, so the
 * caller downgrades to the low-fidelity profile instead of starting black.
 * Ported verbatim from src/viewer.js.
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

/** Read the optional `?quality=low|high` override (case-insensitive). */
export function requestedQuality() {
  try {
    const value = new URLSearchParams(window.location.search).get('quality');
    return value ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Pick a fidelity profile. Explicit URL params win; otherwise software
 * rasterisers get the safe profile and everything else gets full fidelity.
 */
export function resolveQuality(software = isSoftwareRenderer()) {
  const forced = requestedQuality();
  if (forced === 'low') return QUALITY_PROFILES.low;
  if (forced === 'high') return QUALITY_PROFILES.high;
  return software ? QUALITY_PROFILES.low : QUALITY_PROFILES.high;
}

let cached = null;

/**
 * One-stop graphics report, evaluated once per page load:
 *   { webgl, software, forced, quality }
 */
export function detectGraphics() {
  if (cached) return cached;
  const webgl = supportsWebGL();
  const software = webgl && isSoftwareRenderer();
  const forced = requestedQuality();
  cached = { webgl, software, forced, quality: resolveQuality(software) };
  return cached;
}

/** Test-only hook: drop the memoised detection result. */
export function resetGraphicsDetection() {
  cached = null;
}
