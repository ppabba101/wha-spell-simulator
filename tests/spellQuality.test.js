/**
 * M5 — Unit tests for the explicit quality formula.
 *
 * Asserts the qualityMetrics block produced by `computeQualityMetrics`
 * tracks expected ordinal rankings (clean ≥ messy), and that the
 * formula-level fields (cleanliness, length, closurePrecision, symmetry)
 * stay in their documented ranges across hand-crafted inputs.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CLEANLINESS_WEIGHTS,
  LENGTH_CAP,
  computeQualityMetrics,
  computeSpellQuality
} from "../src/compiler/spellQuality.js";
import { computeSpellPower, CLEANLINESS_POWER_WEIGHT, LENGTH_POWER_WEIGHT } from "../src/compiler/spellBuilder.js";

function buildAst({
  ringComplete = true,
  ringNeatness = 0.95,
  ringRadius = 200,
  overdrawAmount = 0,
  gapArcLength = null,
  ringCompleteness = ringComplete ? 1 : 0.5,
  primaryNeatness = 0.94,
  signs = [],
  candidates = null,
  globalSymmetry = 0.9,
  globalNeatness = 0.92,
  unknowns = []
} = {}) {
  // Default candidates: a ring stroke + sigil + sign strokes (one each).
  const defaultCandidates =
    candidates ??
    [
      { candidateId: "c1", strokeIds: ["s1"] },
      { candidateId: "c2", strokeIds: ["s2"] }
    ];
  return {
    ring: {
      found: true,
      complete: ringComplete,
      completeness: ringCompleteness,
      neatness: ringNeatness,
      lineSmoothness: ringNeatness,
      radius: ringRadius,
      overdrawAmount,
      gapArcLength,
      strokeIds: ["s1"]
    },
    rings: [
      {
        found: true,
        complete: ringComplete,
        completeness: ringCompleteness,
        neatness: ringNeatness,
        lineSmoothness: ringNeatness,
        radius: ringRadius,
        overdrawAmount,
        gapArcLength,
        center: { x: 0, y: 0 },
        strokeIds: ["s1"]
      }
    ],
    primarySigil: {
      id: "fire",
      element: "fire",
      confidence: 0.92,
      neatness: primaryNeatness,
      sizeNorm: 0.2,
      semantic: {}
    },
    signs,
    candidates: defaultCandidates,
    unknowns,
    globalMetrics: {
      neatness: globalNeatness,
      radialSymmetry: globalSymmetry,
      instability: 0.15
    },
    warnings: []
  };
}

test("cleanliness ≥ 0.85 for a clean perfect circle + 2 straight lines", () => {
  const ast = buildAst({
    ringComplete: true,
    ringNeatness: 0.98,
    primaryNeatness: 0.96,
    globalNeatness: 0.95,
    globalSymmetry: 0.95,
    candidates: [
      { candidateId: "c1", strokeIds: ["s1"] }, // ring
      { candidateId: "c2", strokeIds: ["s2"] }, // straight line 1
      { candidateId: "c3", strokeIds: ["s3"] } // straight line 2
    ]
  });
  const metrics = computeQualityMetrics(ast);
  assert.ok(
    metrics.cleanliness >= 0.85,
    `expected cleanliness ≥ 0.85 for clean drawing, got ${metrics.cleanliness}`
  );
  assert.equal(metrics.closurePrecision, 1, "complete ring → closure precision 1");
});

test("cleanliness ≤ 0.45 for a jittery, overdrawn, open-ring drawing", () => {
  const ast = buildAst({
    ringComplete: false,
    ringNeatness: 0.25,
    ringCompleteness: 0.4,
    overdrawAmount: 0.5,
    primaryNeatness: 0.3,
    globalNeatness: 0.3,
    globalSymmetry: 0.35,
    gapArcLength: 800, // wide gap relative to a 200-radius ring (circumference ≈ 1256)
    candidates: Array.from({ length: 14 }, (_, i) => ({
      candidateId: `c${i}`,
      strokeIds: [`s${i}`]
    })) // tons of pen-lifts → low continuity
  });
  const metrics = computeQualityMetrics(ast);
  assert.ok(
    metrics.cleanliness <= 0.45,
    `expected cleanliness ≤ 0.45 for jittery drawing, got ${metrics.cleanliness}`
  );
  assert.ok(metrics.closurePrecision < 0.6, "wide gap → closure precision < 0.6");
});

test("length is normalised to outer-ring circumference, capped at 2.5", () => {
  // A ring with massive overdraw should saturate at the LENGTH_CAP.
  const ast = buildAst({
    ringComplete: true,
    ringRadius: 100,
    overdrawAmount: 1.0,
    candidates: Array.from({ length: 20 }, (_, i) => ({
      candidateId: `c${i}`,
      strokeIds: [`s${i}`]
    }))
  });
  const metrics = computeQualityMetrics(ast);
  assert.equal(LENGTH_CAP, 2.5, "LENGTH_CAP must be 2.5 per spec");
  assert.ok(metrics.length <= LENGTH_CAP + 1e-9, "length must not exceed cap");
  assert.ok(metrics.length > 0, "length must be positive for drawn ring");
});

test("length is 0 when no outer ring is present", () => {
  const ast = {
    ring: { found: false },
    rings: [],
    primarySigil: null,
    signs: [],
    candidates: [],
    unknowns: [],
    globalMetrics: { neatness: 0, radialSymmetry: 0, instability: 1 },
    warnings: []
  };
  const metrics = computeQualityMetrics(ast);
  assert.equal(metrics.length, 0);
  assert.equal(metrics.closurePrecision, 0);
});

test("cleanliness weights sum to 1.0 (canon: weighted composite)", () => {
  const total =
    CLEANLINESS_WEIGHTS.strokeSmoothness +
    CLEANLINESS_WEIGHTS.strokeContinuity +
    CLEANLINESS_WEIGHTS.closurePrecision +
    CLEANLINESS_WEIGHTS.symmetry;
  assert.ok(Math.abs(total - 1.0) < 1e-9, `weights must sum to 1.0, got ${total}`);
});

test("computeSpellQuality returns the explicit named outputs + legacy back-compat fields", () => {
  const ast = buildAst();
  const out = computeSpellQuality(ast);
  for (const key of ["cleanliness", "length", "closurePrecision", "symmetry"]) {
    assert.equal(typeof out[key], "number", `${key} must be number`);
  }
  // Legacy fields preserved.
  assert.equal(typeof out.neatness, "number");
  assert.equal(typeof out.legacyQuality, "number");
  assert.equal(out.valid, true);
});

test("power formula is base × (1 + cleanliness × 0.4 + length × 0.2)", () => {
  assert.equal(CLEANLINESS_POWER_WEIGHT, 0.4);
  assert.equal(LENGTH_POWER_WEIGHT, 0.2);

  const cleanCleanness = 1;
  const cleanLength = 2;
  const power = computeSpellPower({ cleanliness: cleanCleanness, length: cleanLength });
  // 1 × (1 + 1 × 0.4 + 2 × 0.2) = 1 × (1 + 0.4 + 0.4) = 1.8
  assert.ok(Math.abs(power - 1.8) < 1e-9, `expected power 1.8, got ${power}`);

  // Length must clamp at LENGTH_CAP.
  const cappedPower = computeSpellPower({ cleanliness: 1, length: 100 });
  // 1 × (1 + 0.4 + 2.5 × 0.2) = 1 × (1 + 0.4 + 0.5) = 1.9
  assert.ok(Math.abs(cappedPower - 1.9) < 1e-9, `length must cap at 2.5, got power ${cappedPower}`);
});

test("computeQualityMetrics is O(1) — cost budget < 5ms per compile (M5 perf)", () => {
  // The new explicit formula must not blow the compile budget. We measure
  // 1000 calls and assert mean per-call < 5ms even on a cold path.
  const ast = buildAst({
    candidates: Array.from({ length: 10 }, (_, i) => ({ candidateId: `c${i}`, strokeIds: [`s${i}`] }))
  });
  const start = process.hrtime.bigint();
  const ITER = 1000;
  for (let i = 0; i < ITER; i += 1) {
    computeQualityMetrics(ast);
  }
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const perCallMs = elapsedMs / ITER;
  assert.ok(perCallMs < 5, `computeQualityMetrics took ${perCallMs.toFixed(3)}ms/call, budget 5ms`);
});

test("clean spell power > messy spell power (ordinal stability)", () => {
  // Hold candidate count steady so length is comparable; vary only the
  // neatness signals. This isolates the cleanliness contribution.
  const sharedCandidates = [
    { candidateId: "c1", strokeIds: ["s1"] },
    { candidateId: "c2", strokeIds: ["s2"] },
    { candidateId: "c3", strokeIds: ["s3"] }
  ];
  const cleanMetrics = computeQualityMetrics(
    buildAst({
      ringComplete: true,
      ringNeatness: 0.95,
      primaryNeatness: 0.95,
      candidates: sharedCandidates
    })
  );
  const messyMetrics = computeQualityMetrics(
    buildAst({
      ringComplete: false,
      ringNeatness: 0.3,
      ringCompleteness: 0.45,
      primaryNeatness: 0.35,
      gapArcLength: 600,
      candidates: sharedCandidates
    })
  );

  const cleanPower = computeSpellPower(cleanMetrics);
  const messyPower = computeSpellPower(messyMetrics);
  assert.ok(cleanPower > messyPower, `clean (${cleanPower}) should exceed messy (${messyPower})`);
});
