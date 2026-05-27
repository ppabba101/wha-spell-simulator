/**
 * Regression test for the legacy `spellQuality` + `spellBuilder` scalars
 * across the M0 fixture corpus.
 *
 * Principle 5 enforcement: when M5 introduces the new explicit
 * `qualityMetrics` block, the legacy fields (`quality`, `stability`,
 * `duration`, `neatness`) must NOT silently drift. This test asserts equality
 * against the JSON snapshot at `tests/__baselines__/spellQuality.v0.json`
 * within ±1e-6.
 *
 * To update the baseline (only when an intentional formula change is
 * accompanied by a sensitivity report), run:
 *   node tests/spellQualityBaseline.fixture.js --write
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { computeBaselineAll, BASELINE_PATH } from "./spellQualityBaseline.fixture.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOLERANCE = 1e-6;

function loadBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

test("legacy spellQuality + spellBuilder scalars match the v0 baseline (M5 Principle 5)", () => {
  const baseline = loadBaseline();
  const current = computeBaselineAll();

  assert.equal(current.length, baseline.records.length, "fixture count must match");

  const byPath = new Map(baseline.records.map((record) => [record.path, record]));
  const drifted = [];

  for (const actual of current) {
    const expected = byPath.get(actual.path);
    if (!expected) {
      drifted.push({ path: actual.path, reason: "missing in baseline" });
      continue;
    }
    for (const key of ["legacyQuality", "legacyStability", "irQuality", "irStability", "irDuration", "irNeatness"]) {
      const delta = Math.abs((actual[key] ?? 0) - (expected[key] ?? 0));
      if (delta > TOLERANCE) {
        drifted.push({ path: actual.path, key, expected: expected[key], actual: actual[key], delta });
      }
    }
  }

  assert.equal(
    drifted.length,
    0,
    `Legacy spell quality fields drifted on ${drifted.length} fixture(s). Update the baseline only with a sensitivity report. First few: ${JSON.stringify(drifted.slice(0, 5))}`
  );
});
