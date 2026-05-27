/**
 * M7b — Compositor.
 *
 * Bridges the Canvas-2D spellEffectRenderer to the PixiJS effect stage.
 * Once the stage is ready, the compositor:
 *   1. Renders an element-tinted disc into a Pixi Sprite that owns the
 *      per-element shader filter.
 *   2. Applies the bloom filter to the stage container when enabled.
 *   3. Renders a flat-tinted Canvas-2D fill on `#effectPixiCanvas` for any
 *      element whose GLSL compile failed (the M7b safety net).
 *
 * The compositor is intentionally pull-based: the main animation frame calls
 * `compositeElementEffect(...)` once per frame; it returns immediately if the
 * stage isn't ready yet.
 */

import {
  getStage,
  getElementFilter,
  isElementFailed,
  getBloomFilterRef,
  ELEMENT_LIST
} from "./stage.js";

const ELEMENT_FILL_COLORS = {
  fire: "rgba(230, 95, 30, 0.55)",
  water: "rgba(80, 160, 240, 0.55)",
  wind: "rgba(200, 230, 220, 0.45)",
  earth: "rgba(150, 110, 60, 0.55)",
  light: "rgba(248, 232, 168, 0.55)"
};

let _layer = null;
let _spritesByElement = new Map();
let _PIXI = null;
let _initFailed = false;
let _bloomApplied = false;

async function ensureLayer() {
  if (_layer || _initFailed) return _layer;
  let app;
  try {
    app = await getStage();
  } catch (err) {
    _initFailed = true;
    return null;
  }
  if (!app) {
    _initFailed = true;
    return null;
  }
  try {
    _PIXI = await import("pixi.js");
    _layer = new _PIXI.Container();
    _layer.label = "wha-effect-layer";
    app.stage.addChild(_layer);
  } catch (err) {
    console.warn("[effectsPixi.compositor] failed to mount layer:", err?.message ?? err);
    _initFailed = true;
    return null;
  }
  return _layer;
}

function makeElementSprite(element, app) {
  if (!_PIXI) return null;
  const filter = getElementFilter(element);
  // Even if the per-element shader failed, we still want a placeholder sprite
  // so the Canvas-2D fallback path has a stable element identity. We don't
  // attach the filter when it failed.
  const g = new _PIXI.Graphics();
  // Pixi v8: Graphics uses `.circle().fill()`. Draw a unit-quad-sized disc;
  // we'll scale/position via the sprite transform.
  g.circle(0, 0, 1).fill({ color: 0xffffff, alpha: 1 });
  const tex = app.renderer.generateTexture(g);
  const sprite = new _PIXI.Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.visible = false;
  if (filter) {
    sprite.filters = [filter];
  }
  return sprite;
}

/**
 * Composite the given element's effect for one frame. No-op if the stage
 * isn't ready yet; falls back to Canvas-2D flat-tint if GLSL failed.
 *
 * @param {object} args
 * @param {string} args.element  one of fire|water|wind|earth|light
 * @param {object} args.ring     { center: {x,y}, radius }
 * @param {number} args.timestamp
 * @param {CanvasRenderingContext2D | null} args.fallbackCtx  Canvas-2D ctx for the failure path
 * @param {number} args.intensity 0..1 multiplier (emission)
 */
export function compositeElementEffect({ element, ring, timestamp, fallbackCtx, intensity }) {
  if (!element || !ring) return;
  // Fallback path — uses the flat-fill safety net regardless of whether the
  // stage is ready. The Canvas-2D effect renderer drew the base; we layer the
  // tinted disc on top of the Pixi canvas so a failed shader still has
  // element-distinct colour.
  if (isElementFailed(element)) {
    drawFallbackFill(fallbackCtx, element, ring, intensity ?? 1);
    return;
  }
  drawShaderEffect({ element, ring, timestamp, intensity });
}

function drawFallbackFill(ctx, element, ring, intensity) {
  if (!ctx) return;
  const color = ELEMENT_FILL_COLORS[element];
  if (!color) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = color;
  ctx.globalAlpha = Math.max(0, Math.min(1, intensity));
  ctx.beginPath();
  ctx.arc(ring.center.x, ring.center.y, ring.radius * 0.92, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

async function drawShaderEffect({ element, ring, timestamp, intensity }) {
  const layer = await ensureLayer();
  if (!layer || !_PIXI) return;
  const app = await getStage();
  if (!app) return;

  let sprite = _spritesByElement.get(element);
  if (!sprite) {
    sprite = makeElementSprite(element, app);
    if (!sprite) return;
    _spritesByElement.set(element, sprite);
    layer.addChild(sprite);
  }

  // Hide every other element's sprite — this is a single-element-at-a-time
  // composition.
  for (const [el, sp] of _spritesByElement.entries()) {
    sp.visible = el === element;
  }

  // Update the filter uniforms (u_time, u_intensity). The filter resources
  // bag was set up in stage.js. Pixi v8 uniform updates are pushed via the
  // resources mapping; defensive try/catch in case the build differs.
  const filter = sprite.filters?.[0];
  if (filter) {
    try {
      const u = filter.resources?.elementUniforms?.uniforms;
      if (u) {
        u.u_time = (timestamp ?? performance.now()) / 1000;
        u.u_intensity = Math.max(0, Math.min(1, intensity ?? 1));
      }
    } catch {
      // ignore — uniform path varies across PIXI patch versions
    }
  }

  sprite.position.set(ring.center.x, ring.center.y);
  sprite.scale.set(ring.radius * 1.3);

  // Apply bloom filter to the layer container when enabled. Hot-swap-safe:
  // we never remount the layer; only mutate `.filters`.
  const bloom = getBloomFilterRef();
  const bloomEnabled = bloom?.enabled !== false && bloom != null;
  if (bloomEnabled && !_bloomApplied) {
    layer.filters = [bloom];
    _bloomApplied = true;
  } else if (!bloomEnabled && _bloomApplied) {
    layer.filters = [];
    _bloomApplied = false;
  }
}

/**
 * Clear all Pixi sprites — used when the effect ends. Stage stays mounted.
 */
export function clearCompositor() {
  for (const sp of _spritesByElement.values()) {
    sp.visible = false;
  }
}

/**
 * Test-only helper: reset module state.
 */
export function __resetCompositorForTest() {
  _layer = null;
  _spritesByElement = new Map();
  _PIXI = null;
  _initFailed = false;
  _bloomApplied = false;
}

export { ELEMENT_LIST };
