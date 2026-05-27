/**
 * Unit tests for src/ui/judgeOverlay.js.
 *
 * Stubs the canvas 2D context to record draw calls so we can assert that each
 * WHA-DSL primitive maps to the expected shape calls.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createJudgeOverlay } from "../src/ui/judgeOverlay.js";

function makeStubCanvas() {
  const calls = [];
  const ctx = {
    save: () => calls.push(["save"]),
    restore: () => calls.push(["restore"]),
    clearRect: (...args) => calls.push(["clearRect", ...args]),
    beginPath: () => calls.push(["beginPath"]),
    moveTo: (...args) => calls.push(["moveTo", ...args]),
    lineTo: (...args) => calls.push(["lineTo", ...args]),
    arc: (...args) => calls.push(["arc", ...args]),
    stroke: () => calls.push(["stroke"]),
    fill: () => calls.push(["fill"]),
    setLineDash: (arr) => calls.push(["setLineDash", JSON.stringify(arr)]),
    createRadialGradient: () => ({
      addColorStop() {}
    }),
    set lineWidth(v) {
      calls.push(["lineWidth=", v]);
    },
    set strokeStyle(v) {
      calls.push(["strokeStyle=", v]);
    },
    set fillStyle(v) {
      // skip gradient objects (no string) to keep output sane
      if (typeof v === "string") calls.push(["fillStyle=", v]);
      else calls.push(["fillStyle=", "[gradient]"]);
    }
  };
  const canvas = {
    width: 1200,
    height: 800,
    getContext: () => ctx
  };
  // Stub global rAF to fire synchronously.
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (cb) => {
      setTimeout(() => cb(), 0);
      return 0;
    };
    globalThis.cancelAnimationFrame = () => {};
  }
  return { canvas, calls };
}

test("createJudgeOverlay: onPartial with a Ring triggers a stroke draw", () => {
  const { canvas, calls } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onPartial({ primitives: [{ type: "Ring", cx: 600, cy: 400, r: 120 }] });
  overlay._internal.paintNow();
  const hasArc = calls.some((c) => c[0] === "arc");
  const hasStroke = calls.some((c) => c[0] === "stroke");
  assert.ok(hasArc, "should have drawn an arc for the Ring");
  assert.ok(hasStroke, "should have stroked the Ring");
  overlay.destroy();
});

test("createJudgeOverlay: onPartial with a Dot triggers a fill", () => {
  const { canvas, calls } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onPartial({ primitives: [{ type: "Dot", cx: 100, cy: 200, r: 4 }] });
  overlay._internal.paintNow();
  assert.ok(calls.some((c) => c[0] === "fill"));
  overlay.destroy();
});

test("createJudgeOverlay: onPartial with a Line triggers moveTo+lineTo", () => {
  const { canvas, calls } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onPartial({ primitives: [{ type: "Line", a1: 0, a2: Math.PI / 2, length: 200 }] });
  overlay._internal.paintNow();
  assert.ok(calls.some((c) => c[0] === "moveTo"));
  assert.ok(calls.some((c) => c[0] === "lineTo"));
  overlay.destroy();
});

test("createJudgeOverlay: onPartial with a Symmetry draws n dashed segments", () => {
  const { canvas, calls } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onPartial({ primitives: [{ type: "Symmetry", n: 4, centerX: 600, centerY: 400 }] });
  overlay._internal.paintNow();
  const setDash = calls.filter((c) => c[0] === "setLineDash");
  assert.ok(setDash.length > 0, "should have set a dash pattern");
  // Expect 4 segments => 4 moveTo + 4 lineTo + 4 strokes (or strokes invoked per primitive).
  const moveToCount = calls.filter((c) => c[0] === "moveTo").length;
  assert.ok(moveToCount >= 4, `expected >=4 moveTo for n=4 symmetry, got ${moveToCount}`);
  overlay.destroy();
});

test("createJudgeOverlay: onPartial with an Arc draws an arc", () => {
  const { canvas, calls } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onPartial({
    primitives: [{ type: "Arc", cx: 100, cy: 100, r: 50, startAngle: 0, endAngle: Math.PI }]
  });
  overlay._internal.paintNow();
  const arcCalls = calls.filter((c) => c[0] === "arc");
  assert.ok(arcCalls.length >= 1);
  overlay.destroy();
});

test("createJudgeOverlay: clear() removes primitives so paint draws none", () => {
  const { canvas, calls } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onPartial({ primitives: [{ type: "Ring", cx: 600, cy: 400, r: 120 }] });
  assert.equal(overlay._internal.getPrimitiveCount(), 1);
  overlay.clear();
  assert.equal(overlay._internal.getPrimitiveCount(), 0);
  // Calls after clear should still include a clearRect but no draw calls beyond it.
  const lengthBefore = calls.length;
  overlay._internal.paintNow();
  // After clear, paint should only emit clearRect. Confirm no new arc calls.
  const newCalls = calls.slice(lengthBefore);
  assert.ok(newCalls.every((c) => c[0] !== "arc"));
  overlay.destroy();
});

test("createJudgeOverlay: setEnabled(false) stops drawing primitives", () => {
  const { canvas, calls } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onPartial({ primitives: [{ type: "Ring", cx: 100, cy: 100, r: 50 }] });
  overlay.setEnabled(false);
  // After disabling, paint should only clearRect.
  const before = calls.length;
  overlay._internal.paintNow();
  const newCalls = calls.slice(before);
  assert.ok(newCalls.every((c) => c[0] !== "stroke"));
  overlay.destroy();
});

test("createJudgeOverlay: deduplicates repeated primitives by key", () => {
  const { canvas } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onPartial({ primitives: [{ type: "Ring", cx: 600, cy: 400, r: 120 }] });
  overlay.onPartial({ primitives: [{ type: "Ring", cx: 600, cy: 400, r: 120 }] });
  assert.equal(overlay._internal.getPrimitiveCount(), 1);
  overlay.destroy();
});

test("createJudgeOverlay: onFinal settles primitives (no further pulse animation)", () => {
  const { canvas } = makeStubCanvas();
  const overlay = createJudgeOverlay({ canvas, settings: { surfaces: { canvasOverlay: true } } });
  overlay.onFinal({ primitives: [{ type: "Ring", cx: 100, cy: 200, r: 80 }] });
  assert.equal(overlay._internal.getPrimitiveCount(), 1);
  overlay.destroy();
});
