/**
 * M7b — Paper texture substrate.
 *
 * Renders slow-scroll fbm noise into `#paperCanvas` (z-index BELOW the glyph
 * layer). ~2s period, 4% opacity drift — meant to feel "alive" without
 * stealing attention from the ink.
 *
 * Implemented in plain Canvas-2D so it stays cheap and doesn't depend on
 * Pixi/WebGL being available. The visual signature is distinct enough from
 * the empty paper background that the AC-F4-extended toggle ≥10% pixel-diff
 * assertion catches it.
 *
 * Hot-swap-able via `setEnabled(bool)` — the controller loop stops drawing
 * but the canvas element + drawing context are preserved.
 */

const PERIOD_MS = 2000;
const OPACITY_MIN = 0.02;
const OPACITY_DRIFT = 0.04;

let _state = null;

function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function noise2d(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  const ux = smoothstep(fx);
  const uy = smoothstep(fy);
  return (
    a * (1 - ux) * (1 - uy) +
    b * ux * (1 - uy) +
    c * (1 - ux) * uy +
    d * ux * uy
  );
}

function fbm(x, y) {
  let v = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < 3; i += 1) {
    v += amp * noise2d(fx, fy);
    fx *= 2;
    fy *= 2;
    amp *= 0.5;
  }
  return v;
}

/**
 * Render one frame of paper texture into the offscreen buffer, then composite
 * it to the canvas. We render at a downsampled resolution (every 8px) and
 * upscale with smoothing for cheap fbm at acceptable visual fidelity.
 */
function renderFrame(state, timestamp) {
  const { ctx, width, height, buffer } = state;
  const t = timestamp / PERIOD_MS;
  const opacity = OPACITY_MIN + (Math.sin(t * Math.PI * 2) * 0.5 + 0.5) * OPACITY_DRIFT;
  const scrollX = t * 4;
  const scrollY = Math.sin(t * Math.PI) * 2;

  const bw = buffer.width;
  const bh = buffer.height;
  const data = state.imageData;
  const pixels = data.data;
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const v = fbm(x * 0.12 + scrollX, y * 0.12 + scrollY);
      const idx = (y * bw + x) * 4;
      const intensity = Math.floor(220 + v * 35);
      pixels[idx] = intensity;
      pixels[idx + 1] = intensity - 12;
      pixels[idx + 2] = intensity - 30;
      pixels[idx + 3] = Math.floor(opacity * 255);
    }
  }
  state.bufferCtx.putImageData(data, 0, 0);

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buffer, 0, 0, bw, bh, 0, 0, width, height);
  ctx.restore();
}

function ensureState(canvas) {
  if (_state && _state.canvas === canvas) return _state;
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Downsample to 64×42 (≈width/20) — fbm at full res is unnecessarily
  // expensive and the texture is supposed to look soft.
  const bw = 64;
  const bh = Math.max(16, Math.round((canvas.height / canvas.width) * bw));
  const buffer = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(bw, bh)
    : Object.assign(document.createElement("canvas"), { width: bw, height: bh });
  const bufferCtx = buffer.getContext("2d");
  if (!bufferCtx) return null;
  const imageData = bufferCtx.createImageData(bw, bh);
  _state = {
    canvas,
    ctx,
    width: canvas.width,
    height: canvas.height,
    buffer,
    bufferCtx,
    imageData,
    rafId: null,
    enabled: false
  };
  return _state;
}

function loop(timestamp) {
  if (!_state) return;
  if (_state.enabled) {
    renderFrame(_state, timestamp ?? performance.now());
  }
  _state.rafId = requestAnimationFrame(loop);
}

/**
 * Initialize the paper texture loop. Idempotent — safe to call from main.
 */
export function initPaperTexture(canvas) {
  const state = ensureState(canvas);
  if (!state) return null;
  if (state.rafId == null) {
    state.rafId = requestAnimationFrame(loop);
  }
  return state;
}

export function setPaperTextureEnabled(value) {
  if (!_state) return;
  _state.enabled = !!value;
  if (!_state.enabled) {
    _state.ctx.clearRect(0, 0, _state.width, _state.height);
  }
}

export function isPaperTextureEnabled() {
  return !!_state?.enabled;
}

/**
 * Render exactly one frame at the current timestamp. Used by tests and the
 * non-rAF "static scene" toggle assertion.
 */
export function renderOnce(canvas, timestamp = performance.now()) {
  const state = ensureState(canvas);
  if (!state) return;
  const wasEnabled = state.enabled;
  state.enabled = true;
  renderFrame(state, timestamp);
  state.enabled = wasEnabled;
}

export function __resetPaperTextureForTest() {
  if (_state?.rafId != null) {
    try {
      cancelAnimationFrame(_state.rafId);
    } catch {
      // ignore
    }
  }
  _state = null;
}
