import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { validateDsl } from "../src/parser/llmJudge/dslValidator.js";
import { astToDsl, dslToAst, ringTreesEqual } from "../src/parser/llmJudge/astDslMapper.js";

const GLYPH_IDS = ["fire", "water", "wind", "earth", "light", "none"];

const ringArb = fc.record({
  type: fc.constant("Ring"),
  cx: fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e3, max: 1e3 }),
  cy: fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e3, max: 1e3 }),
  r: fc.double({ noNaN: true, noDefaultInfinity: true, min: 0.1, max: 1e3 }),
  completeness: fc.double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 1 })
});

const guessArb = fc.record({
  glyphId: fc.constantFrom(...GLYPH_IDS),
  confidence: fc.double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 1 })
});

const critiqueArb = fc.record({
  score: fc.double({ noNaN: true, noDefaultInfinity: true, min: 1, max: 5 })
});

const dslArb = fc.record({
  primitives: fc.array(ringArb, { maxLength: 6 }),
  guess: guessArb,
  critique: critiqueArb
});

test("fast-check: well-formed DSL always validates", () => {
  fc.assert(
    fc.property(dslArb, (dsl) => {
      // fast-check may produce -0 / +0; ajv accepts both.
      const out = validateDsl(dsl);
      return out.ok === true;
    }),
    { numRuns: 100 }
  );
});

// Random nested ring tree generator for round-trip property.
function makeRing(depth, rng) {
  const cx = (rng() - 0.5) * 1000;
  const cy = (rng() - 0.5) * 1000;
  const r = Math.max(1, rng() * 200);
  const completeness = rng();
  const children = [];
  if (depth > 0 && rng() < 0.45) {
    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i += 1) {
      children.push(makeRing(depth - 1, rng));
    }
  }
  return { cx, cy, r, completeness, children };
}

test("fast-check: AST↔DSL round-trip is identity (100 random trees)", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 0xffffff }), (seed) => {
      // Deterministic RNG from a fast-check integer seed.
      let s = seed || 1;
      const rng = () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
      };
      const ast = { rings: [makeRing(3, rng), makeRing(2, rng)] };
      const ast2 = dslToAst(astToDsl(ast));
      return ringTreesEqual(ast, ast2);
    }),
    { numRuns: 100 }
  );
});

test("fast-check: arbitrary garbage objects are rejected by validateDsl", () => {
  fc.assert(
    fc.property(
      fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
      (garbage) => {
        const out = validateDsl(garbage);
        // Will be rejected unless fast-check accidentally constructed a valid one,
        // which is astronomically unlikely with the schema's required keys.
        if (out.ok) {
          assert.ok(garbage.primitives && garbage.guess && garbage.critique, "valid was a real coincidence");
        }
        return true;
      }
    ),
    { numRuns: 50 }
  );
});
