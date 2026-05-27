/**
 * M5 — Sensitivity tests for line-quality weights (Principle 5).
 *
 * Asserts that the **ordinal ranking** of clean vs messy drawings is stable
 * under ±0.05 perturbations of every cleanliness sub-weight and of the
 * power-formula weights (0.4 cleanliness, 0.2 length). If a single ±0.05
 * change can swap the ranking, that weight is too fragile and the change
 * must come with a follow-up justification.
 *
 * This is Principle 5 in practice: any retune of the line-quality formula
 * must demonstrate it doesn't accidentally rerank clean and messy drawings.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { CLEANLINESS_WEIGHTS, LENGTH_CAP, computeQualityMetrics } from "../src/compiler/spellQuality.js";
import { CLEANLINESS_POWER_WEIGHT, LENGTH_POWER_WEIGHT, computeSpellPower } from "../src/compiler/spellBuilder.js";

/**
 * Re-derive cleanliness with a perturbed weight (the production formula is
 * the source of truth; this helper is only used by the sensitivity sweep).
 */
function cleanlinessWith(metrics, weights) {
  return Math.max(
    0,
    Math.min(
      1,
      metrics.strokeSmoothness * weights.strokeSmoothness +
        metrics.strokeContinuity * weights.strokeContinuity +
        metrics.closurePrecision * weights.closurePrecision +
        metrics.symmetry * weights.symmetry
    )
  );
}

function perturb(weights, key, delta) {
  return { ...weights, [key]: weights[key] + delta };
}

function powerWith({ cleanliness, length }, cleanW, lengthW) {
  const capped = Math.min(LENGTH_CAP, Math.max(0, length ?? 0));
  return 1 * (1 + cleanliness * cleanW + capped * lengthW);
}

function buildAst({
  ringComplete = true,
  ringNeatness = 0.95,
  ringCompleteness = ringComplete ? 1 : 0.5,
  primaryNeatness = 0.94,
  candidateCount = 3,
  globalSymmetry = 0.9
} = {}) {
  return {
    ring: {
      found: true,
      complete: ringComplete,
      completeness: ringCompleteness,
      neatness: ringNeatness,
      lineSmoothness: ringNeatness,
      radius: 200,
      overdrawAmount: 0,
      strokeIds: ["s1"]
    },
    rings: [
      {
        found: true,
        complete: ringComplete,
        completeness: ringCompleteness,
        neatness: ringNeatness,
        lineSmoothness: ringNeatness,
        radius: 200,
        overdrawAmount: 0,
        center: { x: 0, y: 0 },
        strokeIds: ["s1"]
      }
    ],
    primarySigil: {
      id: "fire",
      element: "fire",
      confidence: 0.9,
      neatness: primaryNeatness,
      sizeNorm: 0.2,
      semantic: {}
    },
    signs: [],
    candidates: Array.from({ length: candidateCount }, (_, i) => ({
      candidateId: `c${i}`,
      strokeIds: [`s${i}`]
    })),
    unknowns: [],
    globalMetrics: {
      neatness: ringNeatness,
      radialSymmetry: globalSymmetry,
      instability: 0.2
    },
    warnings: []
  };
}

const CLEAN_METRICS = computeQualityMetrics(
  buildAst({ ringComplete: true, ringNeatness: 0.95, primaryNeatness: 0.94, globalSymmetry: 0.9, candidateCount: 3 })
);
const MESSY_METRICS = computeQualityMetrics(
  buildAst({
    ringComplete: false,
    ringNeatness: 0.3,
    ringCompleteness: 0.4,
    primaryNeatness: 0.32,
    globalSymmetry: 0.4,
    candidateCount: 3
  })
);

test("cleanliness ranking is stable when each sub-weight is perturbed by ±0.05", () => {
  for (const key of Object.keys(CLEANLINESS_WEIGHTS)) {
    for (const delta of [-0.05, +0.05]) {
      const perturbed = perturb(CLEANLINESS_WEIGHTS, key, delta);
      const clean = cleanlinessWith(CLEAN_METRICS, perturbed);
      const messy = cleanlinessWith(MESSY_METRICS, perturbed);
      assert.ok(
        clean > messy,
        `cleanliness ranking flipped at ${key}=${perturbed[key].toFixed(3)} (clean=${clean.toFixed(
          3
        )} messy=${messy.toFixed(3)})`
      );
    }
  }
});

test("power ranking is stable when CLEANLINESS_POWER_WEIGHT is perturbed by ±0.05", () => {
  for (const delta of [-0.05, +0.05]) {
    const cleanW = CLEANLINESS_POWER_WEIGHT + delta;
    const cleanPower = powerWith(CLEAN_METRICS, cleanW, LENGTH_POWER_WEIGHT);
    const messyPower = powerWith(MESSY_METRICS, cleanW, LENGTH_POWER_WEIGHT);
    assert.ok(
      cleanPower > messyPower,
      `power ranking flipped at cleanlinessW=${cleanW.toFixed(3)} (clean=${cleanPower.toFixed(
        4
      )} messy=${messyPower.toFixed(4)})`
    );
  }
});

test("power ranking is stable when LENGTH_POWER_WEIGHT is perturbed by ±0.05", () => {
  for (const delta of [-0.05, +0.05]) {
    const lengthW = LENGTH_POWER_WEIGHT + delta;
    const cleanPower = powerWith(CLEAN_METRICS, CLEANLINESS_POWER_WEIGHT, lengthW);
    const messyPower = powerWith(MESSY_METRICS, CLEANLINESS_POWER_WEIGHT, lengthW);
    assert.ok(
      cleanPower > messyPower,
      `power ranking flipped at lengthW=${lengthW.toFixed(3)} (clean=${cleanPower.toFixed(
        4
      )} messy=${messyPower.toFixed(4)})`
    );
  }
});

test("LENGTH_CAP prevents runaway power even at length = 100", () => {
  // Canon: spirals must not blow up the spell. computeSpellPower caps length
  // at LENGTH_CAP (2.5), so even an absurd length of 100 contributes at most
  // 2.5 × 0.2 = 0.5 to power. Without the cap, this would be 100 × 0.2 = 20.
  const runaway = computeSpellPower({ cleanliness: 1, length: 100 });
  const capped = computeSpellPower({ cleanliness: 1, length: LENGTH_CAP });
  assert.ok(
    Math.abs(runaway - capped) < 1e-9,
    `LENGTH_CAP not enforced: runaway=${runaway}, capped=${capped}`
  );
  // And the absolute power must stay bounded: with cleanliness=1, length=cap
  // → 1 × (1 + 0.4 + 0.5) = 1.9. Anything higher means the cap is broken.
  assert.ok(runaway <= 1.9 + 1e-9, `power exceeded cap-bound 1.9 → ${runaway}`);
});

test("documented weights still match the production module (regression guard)", () => {
  // If anyone tweaks the production weights, this test catches it so they
  // can add a sensitivity report. Acceptable values are the documented
  // canon weights — change them deliberately.
  assert.equal(CLEANLINESS_WEIGHTS.strokeSmoothness, 0.4);
  assert.equal(CLEANLINESS_WEIGHTS.strokeContinuity, 0.25);
  assert.equal(CLEANLINESS_WEIGHTS.closurePrecision, 0.2);
  assert.equal(CLEANLINESS_WEIGHTS.symmetry, 0.15);
  assert.equal(CLEANLINESS_POWER_WEIGHT, 0.4);
  assert.equal(LENGTH_POWER_WEIGHT, 0.2);
});
