import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONFIG } from "../src/config.js";
import {
  boundsForStrokes,
  centerOfBounds,
  endpointClosedness,
  pathLength
} from "../src/utils/geometry.js";
import { recognizeCandidates } from "../src/parser/symbolRecognizer.js";

/**
 * M6 — Recognition smoke tests for the five new signs.
 *
 * Each sign must:
 *   (a) be present in `signs.json` with the M6 schema (template + semantic
 *       + manifestation),
 *   (b) self-match: a candidate built directly from the template strokes
 *       must classify as the same sign.
 *   (c) declare its M6 paired-inversion partner where the canon defines
 *       one (dispersion ↔ convergence; window ↔ diamond).
 */
const realDictionary = {
  sigils: JSON.parse(readFileSync(new URL("../src/dictionary/sigils.json", import.meta.url), "utf8")),
  signs: JSON.parse(readFileSync(new URL("../src/dictionary/signs.json", import.meta.url), "utf8"))
};

function stroke(id, points) {
  return { id, points };
}

function candidate(strokes, overrides = {}) {
  const bounds = boundsForStrokes(strokes);
  const center = centerOfBounds(bounds);
  const length = strokes.reduce((sum, item) => sum + pathLength(item.points), 0);
  const size = Math.max(bounds.width, bounds.height, 1);
  const compactPerimeter = Math.max(1, (bounds.width + bounds.height) * 2);
  const overdrawAmount = Math.max(0, Math.min(1, length / compactPerimeter - 0.72));

  return {
    candidateId: overrides.candidateId ?? "c1",
    strokeIds: strokes.map((item) => item.id),
    rawStrokeCount: strokes.length,
    cleanedStrokeCount: strokes.length,
    bounds,
    center,
    radiusNorm: overrides.radiusNorm ?? 0.78,
    angleDeg: overrides.angleDeg ?? 270,
    layer: overrides.layer ?? "outer",
    nearBoundary: false,
    sizeNorm: size / 300,
    lengthNorm: length / 900,
    orientationDeg: 90,
    directedOrientationDeg: 90,
    radialFacing: "outward",
    closedness: endpointClosedness(strokes, size),
    overdrawAmount,
    neatness: Math.max(0, Math.min(1, 0.92 - overdrawAmount * 0.28)),
    strokes
  };
}

function candidateFromTemplate(entry, options = {}) {
  const scale = options.scale ?? 200;
  const origin = options.origin ?? 100;
  const strokes = entry.strokeTemplate.strokes.map((templateStroke, index) =>
    stroke(
      `s${index + 1}`,
      templateStroke.map((point) => ({
        x: origin + point.x * scale,
        y: origin + point.y * scale
      }))
    )
  );
  return candidate(strokes, options);
}

const NEW_SIGNS = ["dispersion", "direction", "window", "diamond", "repetition"];
const FLIP_PAIRS = {
  dispersion: "convergence",
  convergence: "dispersion",
  window: "diamond",
  diamond: "window"
};

for (const id of NEW_SIGNS) {
  test(`M6 dictionary contains the ${id} sign with a stroke template`, () => {
    const entry = realDictionary.signs.find((sign) => sign.id === id);
    assert.ok(entry, `signs.json must contain ${id}`);
    assert.ok(entry.displayName, `${id} must have displayName`);
    assert.ok(entry.strokeTemplate?.strokes?.length, `${id} must have at least one template stroke`);
    assert.ok(entry.semantic, `${id} must have a semantic block`);
    assert.equal(entry.semantic?.manifestation, id, `${id} semantic.manifestation must equal its id`);
  });

  test(`M6 ${id} self-matches when its template is drawn back at the bottom of the ring`, () => {
    const entry = realDictionary.signs.find((sign) => sign.id === id);
    const drawn = candidateFromTemplate(entry, { layer: "outer", angleDeg: 270 });

    const [recognition] = recognizeCandidates([drawn], realDictionary, CONFIG);

    assert.equal(recognition.kind, "sign", `${id} candidate should be classified as a sign`);
    assert.equal(recognition.id, id, `${id} candidate should self-match (got ${recognition.id})`);
    assert.ok(
      recognition.confidence >= CONFIG.recognition.minConfidence,
      `${id} confidence ${recognition.confidence} below recognition floor`
    );
  });
}

test("M6 declares paired-inversion flipPair for dispersion↔convergence", () => {
  const dispersion = realDictionary.signs.find((sign) => sign.id === "dispersion");
  const convergence = realDictionary.signs.find((sign) => sign.id === "convergence");
  assert.equal(dispersion?.flipPair, FLIP_PAIRS.dispersion);
  assert.equal(convergence?.flipPair, FLIP_PAIRS.convergence);
});

test("M6 declares paired-inversion flipPair for window↔diamond", () => {
  const windowSign = realDictionary.signs.find((sign) => sign.id === "window");
  const diamondSign = realDictionary.signs.find((sign) => sign.id === "diamond");
  assert.equal(windowSign?.flipPair, FLIP_PAIRS.window);
  assert.equal(diamondSign?.flipPair, FLIP_PAIRS.diamond);
});

test("M6 signs without canonical pair do not declare flipPair", () => {
  const direction = realDictionary.signs.find((sign) => sign.id === "direction");
  const repetition = realDictionary.signs.find((sign) => sign.id === "repetition");
  assert.equal(direction?.flipPair, undefined, "direction has no canonical flip pair");
  assert.equal(repetition?.flipPair, undefined, "repetition has no canonical flip pair");
});
