import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG } from "../src/config.js";
import { compileSpell } from "../src/compiler/spellBuilder.js";
import { aggregateSemanticDeltas } from "../src/compiler/semanticRules.js";
import { isFlippedRotationDeg } from "../src/parser/signRotation.js";

/**
 * Build a sign descriptor that mirrors the parser's output shape so the
 * compiler / semantic-rules layer can be tested in isolation. The `flipped`
 * field is the only thing that should change the sign of the semantic delta.
 */
function sign({ id, semantic, flipped = false, angleDeg = 270 }) {
  return {
    id,
    flipped,
    confidence: 0.94,
    neatness: 0.92,
    sizeNorm: 0.18,
    lengthNorm: 0.22,
    layer: "outer",
    radiusNorm: 0.82,
    angleDeg,
    orientationDeg: angleDeg,
    directedOrientationDeg: angleDeg,
    radialFacing: "outward",
    shape: {
      axisDominance: 0.4,
      strokeLengthImbalance: 0.16,
      elongationNorm: 0.22
    },
    semantic
  };
}

test("isFlippedRotationDeg returns true near 180° and false elsewhere", () => {
  assert.equal(isFlippedRotationDeg(180), true);
  assert.equal(isFlippedRotationDeg(170), true);
  assert.equal(isFlippedRotationDeg(190), true);
  assert.equal(isFlippedRotationDeg(0), false);
  assert.equal(isFlippedRotationDeg(45), false);
  assert.equal(isFlippedRotationDeg(135), false);
  assert.equal(isFlippedRotationDeg(225), false);
});

test("aggregateSemanticDeltas mirrors deltas when sign.flipped === true (paired inversion #1)", () => {
  const enlarge = sign({
    id: "enlarge-stub",
    semantic: { force: 0.4, focus: 0.2, spread: -0.1, range: 0.3, lifetimeBias: 0.15 }
  });
  const flippedEnlarge = sign({
    id: "enlarge-stub",
    flipped: true,
    semantic: { force: 0.4, focus: 0.2, spread: -0.1, range: 0.3, lifetimeBias: 0.15 }
  });

  const baseline = aggregateSemanticDeltas([enlarge]);
  const inverted = aggregateSemanticDeltas([flippedEnlarge]);

  // Every directional delta should be flipped sign-for-sign within float tolerance.
  for (const key of ["force", "focus", "spread", "range", "lifetimeBias"]) {
    assert.ok(
      Math.abs(baseline[key] + inverted[key]) < 0.01,
      `expected ${key} to invert: baseline ${baseline[key]}, inverted ${inverted[key]}`
    );
  }
});

test("aggregateSemanticDeltas inverts a convergence-style sign (paired inversion #2)", () => {
  const convergence = sign({
    id: "convergence",
    semantic: {
      manifestation: "convergence",
      directionMode: "inward",
      force: 0.08,
      focus: 0.36,
      spread: -0.32,
      range: -0.04,
      lifetimeBias: 0.08
    }
  });
  const flippedConvergence = sign({
    id: "convergence",
    flipped: true,
    semantic: convergence.semantic
  });

  const baseline = aggregateSemanticDeltas([convergence]);
  const inverted = aggregateSemanticDeltas([flippedConvergence]);

  for (const key of ["force", "focus", "spread", "range", "lifetimeBias"]) {
    assert.ok(
      Math.abs(baseline[key] + inverted[key]) < 0.01,
      `expected ${key} to invert on convergence flip: baseline ${baseline[key]}, inverted ${inverted[key]}`
    );
  }
});

test("compileSpell propagates flipped sign deltas into SpellIR force/focus/range", () => {
  const glyphASTFromSign = (signObj) => ({
    type: "GlyphAST",
    version: CONFIG.appVersion,
    ring: { found: true, complete: true, completeness: 1, neatness: 0.85, unsupportedMultipleRings: [] },
    rings: [],
    primarySigil: {
      id: "fire",
      element: "fire",
      confidence: 0.91,
      sizeNorm: 0.2,
      neatness: 0.85,
      semantic: { force: 0.1, focus: 0.1, spread: 0, range: 0, lifetimeBias: 0 }
    },
    signs: [signObj],
    unknowns: [],
    globalMetrics: { neatness: 0.85, radialSymmetry: 0.9, instability: 0.12 },
    warnings: []
  });

  const upright = sign({
    id: "enlarge-stub",
    semantic: { force: 0.4, focus: 0.2, spread: 0, range: 0.2, lifetimeBias: 0 }
  });
  const flipped = sign({
    id: "enlarge-stub",
    flipped: true,
    semantic: upright.semantic
  });

  const uprightSpell = compileSpell({
    glyphAST: glyphASTFromSign(upright),
    config: CONFIG
  });
  const flippedSpell = compileSpell({
    glyphAST: glyphASTFromSign(flipped),
    config: CONFIG
  });

  // Both spells must be valid (flip only changes deltas, not validity).
  assert.equal(uprightSpell.valid, true);
  assert.equal(flippedSpell.valid, true);

  // Flipping a positive-force sign should reduce the spell's force versus the
  // unflipped baseline.
  assert.ok(uprightSpell.force > flippedSpell.force);
  // Flipping a positive-range sign should reduce range too.
  assert.ok(uprightSpell.range > flippedSpell.range);
});
