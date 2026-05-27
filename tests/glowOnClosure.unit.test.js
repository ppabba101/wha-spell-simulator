import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createGlowOnClosure,
  computeFrameState,
  GLOW_TOTAL_DURATION_MS,
  GLOW_PHASE_FLASH_END_MS,
  GLOW_PHASE_SPARKS_END_MS
} from "../src/renderer/effects/glowOnClosure.js";

/**
 * Lightweight Canvas2D context stub. Records call counts on the methods the
 * glow renderer touches so unit tests can sanity-check the draw path without
 * pulling in a real browser canvas.
 */
function makeFakeContext() {
  const calls = {
    clearRect: 0,
    fill: 0,
    arc: 0,
    beginPath: 0,
    createRadialGradient: 0
  };
  return {
    canvas: { width: 800, height: 600 },
    save() {},
    restore() {},
    clearRect() {
      calls.clearRect += 1;
    },
    fill() {
      calls.fill += 1;
    },
    arc() {
      calls.arc += 1;
    },
    beginPath() {
      calls.beginPath += 1;
    },
    createRadialGradient() {
      calls.createRadialGradient += 1;
      return {
        addColorStop() {}
      };
    },
    set fillStyle(_) {},
    get fillStyle() {
      return "#000";
    },
    set globalCompositeOperation(_) {},
    _calls: calls
  };
}

function makeFakeCanvas() {
  const ctx = makeFakeContext();
  return {
    width: 800,
    height: 600,
    getContext: () => ctx,
    __ctx: ctx
  };
}

test("computeFrameState returns null outside the animation window", () => {
  assert.equal(computeFrameState(-1), null);
  assert.equal(computeFrameState(GLOW_TOTAL_DURATION_MS), null);
  assert.equal(computeFrameState(GLOW_TOTAL_DURATION_MS + 100), null);
});

test("computeFrameState classifies the three phases in order", () => {
  const flash = computeFrameState(50);
  assert.equal(flash.phase, "flash");
  assert.ok(flash.t > 0 && flash.t < 1);

  const sparks = computeFrameState(GLOW_PHASE_FLASH_END_MS + 50);
  assert.equal(sparks.phase, "sparks");

  const bloom = computeFrameState(GLOW_PHASE_SPARKS_END_MS + 50);
  assert.equal(bloom.phase, "bloom");
});

test("trigger only fires on active spells", () => {
  const canvas = makeFakeCanvas();
  const glow = createGlowOnClosure({ canvas, now: () => 0 });
  assert.equal(glow.trigger({ active: false, element: "fire" }, { center: { x: 100, y: 100 }, radius: 50 }), false);
  assert.equal(glow.isPlaying(), false);
  assert.equal(glow.trigger({ active: true, element: "fire" }, { center: { x: 100, y: 100 }, radius: 50 }), true);
  assert.equal(glow.isPlaying(), true);
});

test("trigger is a no-op for prepared spells", () => {
  const canvas = makeFakeCanvas();
  const glow = createGlowOnClosure({ canvas, now: () => 0 });
  const result = glow.trigger(
    { active: false, prepared: true, element: "fire" },
    { center: { x: 100, y: 100 }, radius: 80 }
  );
  assert.equal(result, false);
  assert.equal(glow.isPlaying(), false);
});

test("phases happen in flash → sparks → bloom order when frames are pumped", () => {
  const canvas = makeFakeCanvas();
  let clock = 0;
  const glow = createGlowOnClosure({ canvas, now: () => clock });

  glow.trigger({ active: true, element: "fire" }, { center: { x: 400, y: 300 }, radius: 100 });

  // Pump through every phase.
  clock = 30;
  glow.renderFrame();
  clock = 100;
  glow.renderFrame();
  clock = GLOW_PHASE_FLASH_END_MS + 50;
  glow.renderFrame();
  clock = GLOW_PHASE_FLASH_END_MS + 200;
  glow.renderFrame();
  clock = GLOW_PHASE_SPARKS_END_MS + 30;
  glow.renderFrame();
  clock = GLOW_PHASE_SPARKS_END_MS + 80;
  glow.renderFrame();

  const phases = glow._getPhasesSeen();
  assert.deepEqual(phases, ["flash", "sparks", "bloom"]);
});

test("animation stops automatically after total duration", () => {
  const canvas = makeFakeCanvas();
  let clock = 0;
  const glow = createGlowOnClosure({ canvas, now: () => clock });
  glow.trigger({ active: true, element: "fire" }, { center: { x: 100, y: 100 }, radius: 50 });
  clock = GLOW_TOTAL_DURATION_MS + 1;
  glow.renderFrame();
  assert.equal(glow.isPlaying(), false);
});

test("cancel() stops the animation immediately", () => {
  const canvas = makeFakeCanvas();
  let clock = 0;
  const glow = createGlowOnClosure({ canvas, now: () => clock });
  glow.trigger({ active: true, element: "fire" }, { center: { x: 100, y: 100 }, radius: 50 });
  assert.equal(glow.isPlaying(), true);
  glow.cancel();
  assert.equal(glow.isPlaying(), false);
});

test("retrigger resets phase tracking", () => {
  const canvas = makeFakeCanvas();
  let clock = 0;
  const glow = createGlowOnClosure({ canvas, now: () => clock });

  glow.trigger({ active: true, element: "fire" }, { center: { x: 100, y: 100 }, radius: 50 });
  clock = GLOW_PHASE_FLASH_END_MS + 50;
  glow.renderFrame();
  assert.ok(glow._getPhasesSeen().includes("sparks"));

  // New trigger resets state — fresh phasesSeen.
  clock = 1000;
  glow.trigger({ active: true, element: "water" }, { center: { x: 100, y: 100 }, radius: 50 });
  assert.deepEqual(glow._getPhasesSeen(), []);
});

test("renderFrame is a no-op when not playing", () => {
  const canvas = makeFakeCanvas();
  const glow = createGlowOnClosure({ canvas, now: () => 0 });
  // Should not throw, should not record any phases.
  glow.renderFrame();
  assert.deepEqual(glow._getPhasesSeen(), []);
});

test("trigger requires a positive radius", () => {
  const canvas = makeFakeCanvas();
  const glow = createGlowOnClosure({ canvas, now: () => 0 });
  const bad = glow.trigger({ active: true, element: "fire" }, { center: { x: 100, y: 100 }, radius: -1 });
  assert.equal(bad, false);
  assert.equal(glow.isPlaying(), false);
});
