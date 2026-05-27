import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * M7b GLSL compile-fallback (Critic iter-3 Open Q#1).
 *
 * When a per-element shader fails to compile / link, the renderer MUST fall
 * back to a flat element-tinted Canvas-2D fill for that element. The
 * compositor consults `isElementFailed(element)` and routes to
 * `drawFallbackFill` instead of the PixiJS path.
 *
 * This unit test forges a compile failure via `__markElementFailed` and
 * verifies the compositor invokes the Canvas-2D fallback on the supplied
 * 2D context stub.
 */

import {
  __markElementFailed,
  __resetStage,
  isElementFailed,
  getFailedElements
} from "../../src/renderer/effectsPixi/stage.js";
import {
  compositeElementEffect,
  __resetCompositorForTest
} from "../../src/renderer/effectsPixi/compositor.js";

function makeCtxStub() {
  const calls = {
    save: 0,
    restore: 0,
    fill: 0,
    arc: 0,
    beginPath: 0,
    clearRect: 0,
    fillStyleSet: []
  };
  let _fillStyle = "";
  let _alpha = 1;
  let _compositeOp = "source-over";
  return {
    save() { calls.save += 1; },
    restore() { calls.restore += 1; },
    beginPath() { calls.beginPath += 1; },
    arc() { calls.arc += 1; },
    fill() { calls.fill += 1; },
    clearRect() { calls.clearRect += 1; },
    set fillStyle(v) { _fillStyle = v; calls.fillStyleSet.push(v); },
    get fillStyle() { return _fillStyle; },
    set globalAlpha(v) { _alpha = v; },
    get globalAlpha() { return _alpha; },
    set globalCompositeOperation(v) { _compositeOp = v; },
    get globalCompositeOperation() { return _compositeOp; },
    _calls: calls
  };
}

test("isElementFailed reports false by default", () => {
  __resetStage();
  for (const el of ["fire", "water", "wind", "earth", "light"]) {
    assert.equal(isElementFailed(el), false, `${el} should not be failed by default`);
  }
});

test("__markElementFailed flips isElementFailed for that element only", () => {
  __resetStage();
  __markElementFailed("fire");
  assert.equal(isElementFailed("fire"), true);
  assert.equal(isElementFailed("water"), false);
  assert.equal(isElementFailed("earth"), false);
  const failed = getFailedElements();
  assert.equal(failed.has("fire"), true);
  assert.equal(failed.size, 1);
});

test("compositeElementEffect uses Canvas-2D flat-fill when element is failed", () => {
  __resetStage();
  __resetCompositorForTest();
  __markElementFailed("water");

  const ctx = makeCtxStub();
  compositeElementEffect({
    element: "water",
    ring: { center: { x: 600, y: 400 }, radius: 200 },
    timestamp: 100,
    fallbackCtx: ctx,
    intensity: 1
  });

  // The fallback path draws exactly one filled arc with an element-tinted
  // colour. Verify the call shape.
  assert.equal(ctx._calls.beginPath, 1, "fallback should beginPath()");
  assert.equal(ctx._calls.arc, 1, "fallback should draw exactly one arc");
  assert.equal(ctx._calls.fill, 1, "fallback should fill()");
  // The fillStyle must have been set to something water-tinted (blue).
  const fillStyle = ctx._calls.fillStyleSet.find((s) => typeof s === "string");
  assert.ok(fillStyle?.includes("80, 160, 240"), `fillStyle should be water-tinted, got ${fillStyle}`);
});

test("compositeElementEffect uses distinct colours per failed element", () => {
  __resetStage();
  __resetCompositorForTest();
  for (const el of ["fire", "water", "wind", "earth", "light"]) {
    __markElementFailed(el);
  }

  const styles = new Set();
  for (const element of ["fire", "water", "wind", "earth", "light"]) {
    const ctx = makeCtxStub();
    compositeElementEffect({
      element,
      ring: { center: { x: 100, y: 100 }, radius: 50 },
      timestamp: 0,
      fallbackCtx: ctx,
      intensity: 1
    });
    const fillStyle = ctx._calls.fillStyleSet.find((s) => typeof s === "string");
    assert.ok(fillStyle, `${element} should set a fillStyle`);
    styles.add(fillStyle);
  }
  // All 5 should be distinct so the fallback still visually differentiates.
  assert.equal(styles.size, 5, "all 5 fallback fill styles should be distinct");
});

test("compositeElementEffect is a no-op when fallbackCtx is missing", () => {
  __resetStage();
  __resetCompositorForTest();
  __markElementFailed("fire");
  // Should not throw.
  compositeElementEffect({
    element: "fire",
    ring: { center: { x: 0, y: 0 }, radius: 10 },
    timestamp: 0,
    fallbackCtx: null,
    intensity: 1
  });
});

test("compositeElementEffect skips when element or ring is missing", () => {
  __resetStage();
  __resetCompositorForTest();
  __markElementFailed("fire");
  const ctx = makeCtxStub();
  compositeElementEffect({ element: null, ring: null, fallbackCtx: ctx });
  assert.equal(ctx._calls.fill, 0, "no draw should happen without element/ring");
});
