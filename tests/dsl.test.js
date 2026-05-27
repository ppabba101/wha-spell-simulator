import assert from "node:assert/strict";
import test from "node:test";

import { validateDsl, validatePartial } from "../src/parser/llmJudge/dslValidator.js";
import { Ring, Line, Arc, Dot, Symmetry } from "../src/parser/llmJudge/dsl.js";

// ---------- Valid fixtures ----------

test("validateDsl accepts a minimal valid response (ring + guess + critique)", () => {
  const obj = {
    primitives: [Ring({ cx: 100, cy: 100, r: 40, completeness: 0.9 })],
    guess: { glyphId: "fire", confidence: 0.82 },
    critique: { score: 4.1 }
  };
  const out = validateDsl(obj);
  assert.equal(out.ok, true);
});

test("validateDsl accepts all five primitive types", () => {
  const obj = {
    primitives: [
      Ring({ cx: 0, cy: 0, r: 50 }),
      Line({ a1: 0, a2: Math.PI, length: 1 }),
      Arc({ cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: 1 }),
      Dot({ cx: 5, cy: 5 }),
      Symmetry({ n: 4, centerX: 0, centerY: 0 })
    ],
    guess: { glyphId: "wind", confidence: 0.5 },
    critique: { score: 3 }
  };
  const out = validateDsl(obj);
  assert.equal(out.ok, true);
});

test("validateDsl accepts full critique payload with all sub-scores", () => {
  const out = validateDsl({
    primitives: [Ring({ cx: 1, cy: 1, r: 1 })],
    guess: { glyphId: "water", confidence: 1 },
    critique: { closure: 5, cleanliness: 4, continuity: 3, recognizability: 5, score: 4.5 }
  });
  assert.equal(out.ok, true);
});

test("validateDsl accepts none as a glyphId", () => {
  const out = validateDsl({
    primitives: [],
    guess: { glyphId: "none", confidence: 0 },
    critique: { score: 1 }
  });
  assert.equal(out.ok, true);
});

test("validateDsl accepts optional alternatives + hint + errors", () => {
  const out = validateDsl({
    primitives: [Ring({ cx: 0, cy: 0, r: 10 })],
    guess: { glyphId: "earth", confidence: 0.4 },
    alternatives: [{ glyphId: "fire", confidence: 0.3 }],
    critique: { score: 2 },
    errors: ["ring closure low"],
    hint: "close the ring"
  });
  assert.equal(out.ok, true);
});

// ---------- Invalid fixtures ----------

test("validateDsl rejects missing primitives field", () => {
  const out = validateDsl({ guess: { glyphId: "fire", confidence: 0.5 }, critique: { score: 3 } });
  assert.equal(out.ok, false);
});

test("validateDsl rejects unknown glyphId", () => {
  const out = validateDsl({
    primitives: [],
    guess: { glyphId: "void", confidence: 0.5 },
    critique: { score: 3 }
  });
  assert.equal(out.ok, false);
});

test("validateDsl rejects confidence > 1", () => {
  const out = validateDsl({
    primitives: [],
    guess: { glyphId: "fire", confidence: 1.7 },
    critique: { score: 3 }
  });
  assert.equal(out.ok, false);
});

test("validateDsl rejects primitive with unknown type", () => {
  const out = validateDsl({
    primitives: [{ type: "Spiral", cx: 0, cy: 0, r: 1 }],
    guess: { glyphId: "fire", confidence: 0.5 },
    critique: { score: 3 }
  });
  assert.equal(out.ok, false);
});

test("validateDsl rejects critique missing score", () => {
  const out = validateDsl({
    primitives: [],
    guess: { glyphId: "fire", confidence: 0.5 },
    critique: { closure: 4 }
  });
  assert.equal(out.ok, false);
});

test("validateDsl rejects critique score outside 1..5", () => {
  const out = validateDsl({
    primitives: [],
    guess: { glyphId: "fire", confidence: 0.5 },
    critique: { score: 6.2 }
  });
  assert.equal(out.ok, false);
});

test("validateDsl rejects top-level extra fields", () => {
  const out = validateDsl({
    primitives: [],
    guess: { glyphId: "fire", confidence: 0.5 },
    critique: { score: 3 },
    raw_thoughts: "leak this please"
  });
  assert.equal(out.ok, false);
});

// ---------- Partial validator ----------

test("validatePartial accepts a primitives-only fragment", () => {
  const out = validatePartial({ primitives: [Ring({ cx: 0, cy: 0, r: 10 })] });
  assert.equal(out.ok, true);
});

test("validatePartial accepts a guess-only fragment", () => {
  const out = validatePartial({ guess: { glyphId: "fire", confidence: 0.3 } });
  assert.equal(out.ok, true);
});

test("validatePartial accepts an empty object", () => {
  const out = validatePartial({});
  assert.equal(out.ok, true);
});

test("validatePartial still rejects malformed primitive", () => {
  const out = validatePartial({ primitives: [{ type: "Ring", cx: "wrong" }] });
  assert.equal(out.ok, false);
});
