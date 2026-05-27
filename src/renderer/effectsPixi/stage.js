/**
 * M7b — PixiJS effect stage.
 *
 * Lazy-loaded on the first pointerdown so the bundle entry chunk does NOT
 * include pixi.js. The structural assertion lives in
 * `tests/effectsPixi/stage.test.js`.
 *
 * The stage layers ON TOP of the Canvas-2D effects. If GLSL compile fails
 * for any element, that element falls back to the Canvas-2D flat-fill path
 * (the M7a safety net). The application keeps rendering either way.
 */

import { ELEMENT_SHADERS } from "./elementShaders/index.js";

const SHADERS = ELEMENT_SHADERS;

const ELEMENT_COLORS = {
  fire: [0.95, 0.32, 0.12],
  water: [0.22, 0.6, 0.95],
  wind: [0.86, 0.95, 0.92],
  earth: [0.62, 0.45, 0.22],
  light: [0.98, 0.94, 0.66]
};

let _app = null;
let _initPromise = null;
let _preloadPromise = null;
let _failedElements = new Set();
let _elementFilters = new Map();
let _bloomFilter = null;

/**
 * The actual init. We isolate the dynamic imports so unit tests that only
 * want the structural assertion (no pixi in entry chunk) don't accidentally
 * pull pixi via static analysis.
 */
async function initStage() {
  // Dynamic import — Vite code-splits this into its own chunk.
  const PIXI = await import("pixi.js");

  const canvas = typeof document !== "undefined" ? document.getElementById("effectPixiCanvas") : null;
  if (!canvas) {
    throw new Error("effectPixiCanvas element not found in DOM");
  }

  const app = new PIXI.Application();
  try {
    await app.init({
      canvas,
      width: canvas.width,
      height: canvas.height,
      backgroundAlpha: 0,
      antialias: true,
      preference: "webgl",
      autoStart: true
    });
  } catch (err) {
    console.warn("[effectsPixi] PIXI.Application.init failed:", err?.message ?? err);
    throw err;
  }

  // Compile per-element shaders eagerly so the GLSL-fallback path is settled
  // before the first render. Each failed compile is logged once and the
  // element ID is added to _failedElements; the renderer skips the Pixi
  // layer for that element and falls back to the Canvas-2D flat-fill path.
  for (const [element, source] of Object.entries(SHADERS)) {
    try {
      const filter = createElementFilter(PIXI, element, source);
      _elementFilters.set(element, filter);
    } catch (err) {
      console.warn(`[effectsPixi] GLSL compile failed for ${element}; falling back to Canvas-2D:`, err?.message ?? err);
      _failedElements.add(element);
    }
  }

  _app = app;
  return app;
}

/**
 * Build a PixiJS Filter from a fragment shader source string. Throws on
 * compile/link failure so the caller can fall back per-element.
 */
function createElementFilter(PIXI, element, fragmentSource) {
  // PixiJS v8 uses a unified GlProgram + Filter API. We compile via
  // GlProgram.from and let Pixi surface compile errors via thrown Errors.
  const color = ELEMENT_COLORS[element] ?? [1, 1, 1];
  const defaultVertex = `
    in vec2 aPosition;
    out vec2 vTextureCoord;
    uniform vec4 uInputSize;
    uniform vec4 uOutputFrame;
    uniform vec4 uOutputTexture;
    vec4 filterVertexPosition(void) {
      vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
      position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
      position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
      return vec4(position, 0.0, 1.0);
    }
    vec2 filterTextureCoord(void) {
      return aPosition * (uOutputFrame.zw * uInputSize.zw);
    }
    void main(void) {
      gl_Position = filterVertexPosition();
      vTextureCoord = filterTextureCoord();
    }
  `;

  // Defensive: if Filter or GlProgram is unavailable on this Pixi build,
  // throw so we fall back to Canvas-2D. The structural test exercises this
  // path via the simulated-failure helper.
  if (!PIXI.Filter || !PIXI.GlProgram) {
    throw new Error("PIXI.Filter / PIXI.GlProgram missing");
  }

  const glProgram = PIXI.GlProgram.from({
    vertex: defaultVertex,
    fragment: fragmentSource,
    name: `wha-elem-${element}`
  });

  const filter = new PIXI.Filter({
    glProgram,
    resources: {
      elementUniforms: {
        u_time: { value: 0, type: "f32" },
        u_color: { value: color, type: "vec3<f32>" },
        u_intensity: { value: 1.0, type: "f32" }
      }
    }
  });
  filter.element = element;
  return filter;
}

/**
 * Lazy stage initialization. The first caller wins; concurrent callers share
 * the same in-flight promise so we never double-init.
 */
export async function getStage() {
  if (_app) return _app;
  if (!_initPromise) {
    _initPromise = initStage().catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

/**
 * Public preload hook — fire on first pointerdown. Schedules init via
 * requestIdleCallback when available, otherwise requestAnimationFrame so the
 * cold-cache cost doesn't land in the same frame as the user's first stroke.
 */
export function preloadStage() {
  if (_preloadPromise) return _preloadPromise;
  _preloadPromise = new Promise((resolve) => {
    const run = () => {
      getStage().then(resolve).catch(() => resolve(null));
    };
    if (typeof globalThis !== "undefined" && typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(run, { timeout: 500 });
    } else if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    } else {
      run();
    }
  });
  return _preloadPromise;
}

export function getElementFilter(element) {
  return _elementFilters.get(element) ?? null;
}

export function isElementFailed(element) {
  return _failedElements.has(element);
}

export function getFailedElements() {
  return new Set(_failedElements);
}

export function setBloomFilterRef(filter) {
  _bloomFilter = filter;
}

export function getBloomFilterRef() {
  return _bloomFilter;
}

/**
 * Test-only helper: force a compile failure for a given element. Used by
 * the GLSL fallback unit test. No production code calls this.
 */
export function __markElementFailed(element) {
  _failedElements.add(element);
  _elementFilters.delete(element);
}

/**
 * Test-only helper: reset module state between tests.
 */
export function __resetStage() {
  _app = null;
  _initPromise = null;
  _preloadPromise = null;
  _failedElements = new Set();
  _elementFilters = new Map();
  _bloomFilter = null;
}

export const ELEMENT_LIST = Object.keys(SHADERS);
