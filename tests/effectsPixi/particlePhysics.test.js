import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createEmitter,
  createAllEmitters,
  setEmitterSeed,
  getEmitterSeed,
  makePRNG,
  PARTICLE_PROFILES
} from "../../src/renderer/effectsPixi/particlePhysics.js";

/**
 * M7b PRNG seeding (Critic iter-3 Open Q#3).
 *
 * The emitter is Mulberry32-seeded; identical seeds produce identical
 * particle trajectories. Playwright's trajectory-hash assertion relies on
 * this determinism — if it ever breaks, the trajectory hashes drift between
 * runs and the AC-F4-extended assertion goes flaky.
 */

function trajectoryHash(emitter, steps = 30) {
  // Pump the emitter for N frames and accumulate the position string.
  // Mulberry32 + curlNoise + radial physics is fully deterministic so the
  // resulting string is identical across runs given the same seed.
  let now = 0;
  let acc = "";
  for (let i = 0; i < steps; i += 1) {
    now += 16.67;
    emitter.step(1, now);
    const ps = emitter.getParticles();
    for (const p of ps) {
      acc += `${p.id}:${p.x.toFixed(2)},${p.y.toFixed(2)};`;
    }
    acc += "|";
  }
  return acc;
}

test("makePRNG produces deterministic sequence for the same seed", () => {
  const a = makePRNG(12345);
  const b = makePRNG(12345);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(a(), b());
  }
});

test("identical seeds produce identical emitter trajectories", () => {
  const e1 = createEmitter({ element: "fire", origin: { x: 100, y: 100 }, seed: 42 });
  const e2 = createEmitter({ element: "fire", origin: { x: 100, y: 100 }, seed: 42 });
  const h1 = trajectoryHash(e1);
  const h2 = trajectoryHash(e2);
  assert.equal(h1, h2, "same seed → same trajectory");
  assert.ok(h1.length > 0, "trajectory should accumulate some positions");
});

test("different seeds produce different trajectories", () => {
  const e1 = createEmitter({ element: "fire", origin: { x: 100, y: 100 }, seed: 42 });
  const e2 = createEmitter({ element: "fire", origin: { x: 100, y: 100 }, seed: 43 });
  const h1 = trajectoryHash(e1);
  const h2 = trajectoryHash(e2);
  assert.notEqual(h1, h2, "different seed → different trajectory");
});

test("createAllEmitters yields 5 distinct trajectory hashes", () => {
  const ems = createAllEmitters({ origin: { x: 200, y: 200 }, seed: 0xdeadbeef });
  const hashes = new Map();
  for (const [el, em] of Object.entries(ems)) {
    hashes.set(el, trajectoryHash(em));
  }
  const unique = new Set(hashes.values());
  assert.equal(unique.size, 5, "all 5 element trajectories should be distinct");
});

test("setEmitterSeed and getEmitterSeed module-level wiring", () => {
  setEmitterSeed(0xdeadbeef);
  assert.equal(getEmitterSeed(), 0xdeadbeef);
  setEmitterSeed(null);
  assert.equal(getEmitterSeed(), null);
});

test("PARTICLE_PROFILES exposes profiles for all 5 elements", () => {
  for (const el of ["fire", "water", "wind", "earth", "light"]) {
    const profile = PARTICLE_PROFILES[el];
    assert.ok(profile, `profile missing for ${el}`);
    assert.equal(typeof profile.emitterRate, "number");
    assert.equal(typeof profile.lifespan, "number");
    assert.equal(typeof profile.sizeCurve, "function");
    assert.equal(typeof profile.alphaCurve, "function");
    assert.ok(Array.isArray(profile.palette));
    assert.equal(profile.palette.length, 3);
  }
});

test("velocity field varies by element family", () => {
  assert.equal(PARTICLE_PROFILES.earth.velocityField, "gravity");
  assert.equal(PARTICLE_PROFILES.water.velocityField, "gravity");
  assert.equal(PARTICLE_PROFILES.wind.velocityField, "curl");
  assert.equal(PARTICLE_PROFILES.fire.velocityField, "curl");
  assert.equal(PARTICLE_PROFILES.light.velocityField, "radial");
});

test("alphaCurve returns 0 at the end of lifespan", () => {
  for (const el of ["fire", "water", "wind", "earth", "light"]) {
    const profile = PARTICLE_PROFILES[el];
    const alpha = profile.alphaCurve(1.0);
    assert.ok(alpha <= 0.001, `${el} alphaCurve should approach 0 at t=1, got ${alpha}`);
  }
});

test("step + getParticles populate over time", () => {
  const e = createEmitter({ element: "fire", origin: { x: 50, y: 50 }, seed: 1 });
  let now = 0;
  for (let i = 0; i < 10; i += 1) {
    now += 16.67;
    e.step(1, now);
  }
  const particles = e.getParticles();
  assert.ok(particles.length > 0, "fire emitter should have spawned particles");
  for (const p of particles) {
    assert.equal(p.element, "fire");
    assert.ok(Number.isFinite(p.x));
    assert.ok(Number.isFinite(p.y));
  }
});

test("particles age out after lifespan", () => {
  const e = createEmitter({ element: "fire", origin: { x: 0, y: 0 }, seed: 1, lifespanMs: 100 });
  // Pump for 1 second worth of frames.
  let now = 0;
  for (let i = 0; i < 60; i += 1) {
    now += 16.67;
    e.step(1, now);
  }
  // Each particle's age should be ≤ lifespan; the splice loop removes older.
  for (const p of e.getParticles()) {
    assert.ok(now - p.bornAt <= 100 + 16.67, `particle ${p.id} aged past lifespan`);
  }
});
