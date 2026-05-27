/**
 * M7a — Canvas-2D glow-on-closure animation.
 *
 * Triggered when a ring closes (the user transitions from a `prepared` spell
 * to an `active` one, i.e. compileSpell() returns a SpellIR whose `active`
 * flag flipped to true on a fresh draw).
 *
 * The animation runs over ~600ms in three phases:
 *   1. Silver flash    (0–200ms):  white-silver radial gradient expanding
 *                                  from the sigil centre. Peak luminance at
 *                                  frame ~3 of 60fps (~50ms in) — the
 *                                  AC-F4 colour-histogram assertion samples
 *                                  this moment.
 *   2. Radial sparks   (200–500ms): 12–24 sparks emitted from the ring
 *                                  boundary, fading as they travel out.
 *   3. Effect bloom    (500–600ms): the element effect blooms upward from
 *                                  the centre — a final colour wash so the
 *                                  downstream effect renderer takes over
 *                                  cleanly.
 *
 * This is the Canvas-2D safety net for AC-F4. M7b will layer PixiJS shaders
 * on top — M7a stands alone.
 */

const TOTAL_DURATION_MS = 600;
const PHASE_FLASH_END_MS = 200;
const PHASE_SPARKS_END_MS = 500;
const SPARK_COUNT = 18; // within the 12–24 window from the spec
const ELEMENT_COLORS = {
  fire: { r: 230, g: 110, b: 40 },
  water: { r: 80, g: 160, b: 240 },
  wind: { r: 200, g: 230, b: 220 },
  earth: { r: 160, g: 110, b: 60 },
  light: { r: 250, g: 240, b: 180 }
};

function clamp01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function getSigilCenter(spellIR) {
  // Defensive: spellIR.modifierLayers may be absent on minimal SpellIR objects.
  // The compile path always supplies the outer ring through pipeline.ring; we
  // accept a precomputed ring on the trigger argument to keep this module
  // pure and free of pipeline knowledge.
  return spellIR?._ringCenter ?? null;
}

function getRingRadius(spellIR) {
  return spellIR?._ringRadius ?? null;
}

function getElementColor(element) {
  return ELEMENT_COLORS[element] ?? { r: 255, g: 255, b: 255 };
}

/**
 * Compute the phase + intra-phase parameter for a given elapsed time.
 * Returns null when the animation should stop.
 */
export function computeFrameState(elapsed) {
  if (elapsed < 0 || elapsed >= TOTAL_DURATION_MS) return null;

  if (elapsed < PHASE_FLASH_END_MS) {
    return {
      phase: "flash",
      t: elapsed / PHASE_FLASH_END_MS,
      elapsed
    };
  }
  if (elapsed < PHASE_SPARKS_END_MS) {
    return {
      phase: "sparks",
      t: (elapsed - PHASE_FLASH_END_MS) / (PHASE_SPARKS_END_MS - PHASE_FLASH_END_MS),
      elapsed
    };
  }
  return {
    phase: "bloom",
    t: (elapsed - PHASE_SPARKS_END_MS) / (TOTAL_DURATION_MS - PHASE_SPARKS_END_MS),
    elapsed
  };
}

function drawSilverFlash(ctx, center, radius, t) {
  // Peak luminance shaped so frame ~3 of 60fps (~50ms in, t≈0.25) is the
  // crest; from t=0.25 onward the flash decays. This ensures the AC-F4
  // colour histogram is sampled at peak silver.
  const peakT = 0.25;
  const distanceFromPeak = Math.abs(t - peakT);
  const luminance = clamp01(1 - distanceFromPeak * 2.4);
  if (luminance <= 0) return;

  // The gradient radius expands across the flash so the silver wash sweeps
  // outward through the ring.
  const flashRadius = radius * (0.4 + t * 1.1);
  const gradient = ctx.createRadialGradient(
    center.x,
    center.y,
    0,
    center.x,
    center.y,
    flashRadius
  );
  gradient.addColorStop(0, `rgba(255, 255, 255, ${0.95 * luminance})`);
  gradient.addColorStop(0.5, `rgba(220, 220, 230, ${0.78 * luminance})`);
  gradient.addColorStop(1, "rgba(192, 192, 200, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y, flashRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSparks(ctx, center, radius, t, sparks) {
  // Sparks travel from the ring boundary outward, fading linearly.
  const alpha = clamp01(1 - t);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const spark of sparks) {
    const travel = radius * 0.35 * t;
    const x = spark.startX + spark.dx * travel;
    const y = spark.startY + spark.dy * travel;
    const sparkAlpha = alpha * spark.intensity;
    ctx.fillStyle = `rgba(255, 245, 200, ${sparkAlpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.4 * (1 - t * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBloom(ctx, center, radius, t, element) {
  const alpha = clamp01(1 - t);
  if (alpha <= 0) return;
  const color = getElementColor(element);
  // Bloom rises slightly (negative Y) so the wash feels like the element
  // materialising upward from the sigil.
  const offsetY = -radius * 0.1 * t;
  const bloomRadius = radius * (0.5 + t * 0.4);
  const gradient = ctx.createRadialGradient(
    center.x,
    center.y + offsetY,
    0,
    center.x,
    center.y + offsetY,
    bloomRadius
  );
  gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${0.6 * alpha})`);
  gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y + offsetY, bloomRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function makeSparks(center, radius) {
  const sparks = [];
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const angle = (i / SPARK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    sparks.push({
      startX: center.x + dx * radius,
      startY: center.y + dy * radius,
      dx,
      dy,
      intensity: 0.7 + Math.random() * 0.3
    });
  }
  return sparks;
}

/**
 * Create a glow-on-closure controller bound to a canvas. The controller is
 * frame-driven by the caller: the animation loop must invoke `renderFrame()`
 * each tick so the glow composites on top of the spell-effect canvas (which
 * is cleared every frame).
 *
 * Triggering the glow while a play is already in flight resets the animation
 * to phase 1 of the new spell so a rapid retrigger does not visually stutter.
 */
export function createGlowOnClosure({ canvas, now = () => performance.now() } = {}) {
  if (!canvas) {
    throw new Error("createGlowOnClosure: canvas is required");
  }
  const ctx = canvas.getContext("2d");

  let state = null;
  // Track the phases that the controller has rendered at least once — exposed
  // for unit tests so they can assert phase order without sampling pixels.
  let phasesSeen = [];

  function renderFrame() {
    if (!state) return;
    const elapsed = now() - state.startedAt;
    const frame = computeFrameState(elapsed);
    if (!frame) {
      state = null;
      return;
    }
    if (frame.phase === "flash") {
      drawSilverFlash(ctx, state.center, state.radius, frame.t);
    } else if (frame.phase === "sparks") {
      // Hold a faint flash tail so the transition is visually continuous.
      drawSilverFlash(ctx, state.center, state.radius, 1);
      drawSparks(ctx, state.center, state.radius, frame.t, state.sparks);
    } else {
      drawSparks(ctx, state.center, state.radius, 1, state.sparks);
      drawBloom(ctx, state.center, state.radius, frame.t, state.element);
    }
    if (phasesSeen[phasesSeen.length - 1] !== frame.phase) {
      phasesSeen.push(frame.phase);
    }
  }

  function trigger(spellIR, options = {}) {
    if (!spellIR || !spellIR.active) {
      // Per spec: only active spells trigger the glow. Prepared spells are
      // intentionally a no-op so the user sees no flash until they close the
      // ring with the dot.
      return false;
    }
    // The trigger needs a centre + radius. The caller passes them through
    // either on spellIR (via _ringCenter / _ringRadius) or via the options.
    const center =
      options.center ??
      getSigilCenter(spellIR) ??
      (canvas ? { x: canvas.width / 2, y: canvas.height / 2 } : null);
    const radius = options.radius ?? getRingRadius(spellIR) ?? Math.min(canvas.width, canvas.height) * 0.25;
    if (!center || !Number.isFinite(radius) || radius <= 0) {
      return false;
    }
    state = {
      startedAt: now(),
      center,
      radius,
      element: spellIR.element,
      sparks: makeSparks(center, radius)
    };
    phasesSeen = [];
    return true;
  }

  function isPlaying() {
    return state !== null;
  }

  function cancel() {
    state = null;
  }

  function destroy() {
    state = null;
  }

  // Test-only helper exposed so phase-order unit tests don't need to poll.
  function _getPhasesSeen() {
    return phasesSeen.slice();
  }

  return {
    trigger,
    renderFrame,
    isPlaying,
    cancel,
    destroy,
    _getPhasesSeen
  };
}

export const GLOW_TOTAL_DURATION_MS = TOTAL_DURATION_MS;
export const GLOW_PHASE_FLASH_END_MS = PHASE_FLASH_END_MS;
export const GLOW_PHASE_SPARKS_END_MS = PHASE_SPARKS_END_MS;
