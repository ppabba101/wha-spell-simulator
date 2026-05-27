/**
 * M7b — Spark / ember emitter facade.
 *
 * Originally scoped as a tsParticles wrapper; we ship a lightweight custom
 * emitter on top of `particlePhysics.js` instead so the bundle stays small
 * and the Playwright trajectory test stays deterministic. The tsParticles
 * default emitter config is intentionally NOT used — per-element physics
 * lives in `particlePhysics.js`.
 *
 * Public API:
 *   createSparks({ element, origin, sign, seed }) → { step, render, getParticles }
 *
 * The `sign` parameter biases the emission direction:
 *   - dispersion → bias outward (radial spread)
 *   - direction  → bias along a unit vector
 *   - window     → bias along ±X
 *   - diamond    → bias along ±Y
 *   - repetition → no bias, but pulsed emission rate
 *   - default    → no bias
 */

import { createEmitter, getEmitterSeed } from "./particlePhysics.js";

function biasParticles(particles, element, sign) {
  // Apply a one-off velocity bias when each particle is born. The bias is
  // small so it doesn't drown out the per-element physics field.
  if (!sign) return;
  for (const p of particles) {
    if (p._biased) continue;
    p._biased = true;
    if (sign === "dispersion") {
      // Already radial by default; no-op
    } else if (sign === "direction") {
      p.vx *= 1.4;
    } else if (sign === "window") {
      p.vy *= 0.4;
    } else if (sign === "diamond") {
      p.vx *= 0.4;
    } else if (sign === "repetition") {
      p.vx *= 0.8;
      p.vy *= 0.8;
    }
  }
}

export function createSparks({ element, origin, sign, seed } = {}) {
  const effectiveSeed = seed ?? getEmitterSeed() ?? 0xcafe;
  const emitter = createEmitter({
    element: element ?? "fire",
    origin: origin ?? { x: 0, y: 0 },
    seed: effectiveSeed
  });

  function step(dt, timestamp) {
    emitter.step(dt, timestamp);
    biasParticles(emitter.getParticles(), element, sign);
  }

  function render(ctx) {
    if (!ctx) return;
    const profile = emitter.getProfile();
    const [r, g, b] = profile.palette;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const now = performance.now();
    for (const p of emitter.getParticles()) {
      const age = now - p.bornAt;
      const t = Math.min(1, age / 1200);
      const size = profile.sizeCurve(t);
      const alpha = profile.alphaCurve(t);
      if (alpha <= 0) continue;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    step,
    render,
    getParticles: () => emitter.getParticles(),
    element: emitter.element,
    seed: emitter.seed
  };
}
