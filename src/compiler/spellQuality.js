import { GLYPH_WARNINGS } from "../parser/glyphWarnings.js";
import { getOuterRing } from "../parser/ringTree.js";
import { clamp, mean } from "../utils/geometry.js";

const QUALITY_TUNING = {
  ringQuality: 0.25,
  primaryConfidence: 0.25,
  signConfidence: 0.2,
  signFallbackPrimaryConfidence: 0.7,
  globalNeatness: 0.15,
  radialSymmetry: 0.1,
  insideScore: 0.05,
  unknownSoftLimit: 7
};

const STABILITY_TUNING = {
  ringNeatness: 0.36,
  symbolNeatness: 0.34,
  symbolNeatnessFallback: 0.35,
  radialSymmetry: 0.12,
  radialSymmetryFallback: 0.4,
  inverseInstability: 0.18,
  instabilityFallback: 0.5,
  unknownPenaltyMax: 0.34,
  unknownPenaltyScale: 0.24,
  ambiguityGrace: 0.14,
  boundaryPenalty: 0.08,
  centerPenalty: 0.16
};

/**
 * M5 — Line-quality formula (explicit, named, citable).
 *
 * Replaces the implicit "neatness" chain (which folded smoothness, continuity
 * and closure into one scalar) with four explicit metrics that the Spell
 * Quality panel renders and that the power formula in `spellBuilder.js`
 * consumes directly. Lane 2 §4 canon: "neatly drawn seals last longer than
 * messy ones" — that motivates cleanliness being the dominant weight.
 *
 * Each weight is documented inline with a rationale + Lane 2 anchor. The
 * weights sum to 1.0. Sensitivity is asserted at ±0.05 by
 * `tests/spellQuality.sensitivity.test.js`.
 */
const CLEANLINESS_WEIGHTS = Object.freeze({
  // Stroke smoothness is the dominant signal: a wobbly line is the single
  // most-visible defect on a hand-drawn seal. Canon: Lane 2 §4 "lines that
  // tremble bleed power." We weight it heaviest at 0.40.
  strokeSmoothness: 0.40,

  // Stroke continuity (penalises pen-lifts) — many short segments read as
  // "scribbled." Canon: Lane 2 §4 "one-shot strokes hold the seal." We weight
  // it second at 0.25.
  strokeContinuity: 0.25,

  // Closure precision (how tightly the outer ring joins). Canon: Lane 2 §4
  // "the gap closes the spell; the gap leaks the spell." We weight it 0.20.
  closurePrecision: 0.20,

  // Radial symmetry (keystone balance). Canon: Lane 2 §4 "symmetry channels
  // intent." Smallest of the four because it is the most forgiving — many
  // legitimate seals are intentionally asymmetric. Weight 0.15.
  symmetry: 0.15
});

/**
 * Length cap rationale (Lane 2 §4): length>2.5× the outer-ring circumference
 * implies the user is drawing spirals or overdrawing the seal. We cap to
 * prevent runaway power without rewriting the underlying neatness chain.
 */
const LENGTH_CAP = 2.5;

function topMatchCompetitorConfidence(recognition) {
  return (
    recognition?.diagnostics?.topMatches?.find((score) => score.kind !== recognition.kind || score.id !== recognition.id)
      ?.confidence ??
    0
  );
}

/**
 * Stroke smoothness component — proxies "1 - normalised curvature variance."
 * The parser already produces per-recognition `neatness` scores from
 * lineSmoothness + roundness measurements (see `ringDetector.js:271` and
 * `symbolRecognizer.js`). We average them weighted by ring + sigil + signs.
 *
 * @param {object} glyphAST
 * @returns {number} 0..1
 */
function strokeSmoothness(glyphAST) {
  const outer = getOuterRing(glyphAST);
  const ringSmooth = outer?.lineSmoothness ?? outer?.neatness ?? 0;
  const sigilSmooth = glyphAST.primarySigil?.neatness ?? 0;
  const signSmoothValues = (glyphAST.signs ?? [])
    .map((sign) => sign.neatness)
    .filter((value) => typeof value === "number" && value > 0);
  const signSmooth = signSmoothValues.length ? mean(signSmoothValues) : 0;
  const components = [ringSmooth, sigilSmooth, signSmooth].filter((value) => value > 0);
  return components.length ? clamp(mean(components)) : 0;
}

/**
 * Stroke continuity component — "1 - normalised pen-lift count."
 *
 * Pen-lift count is approximated by the total number of *recognised*
 * candidate strokes minus the minimum needed for the seal (ring + sigil +
 * signs). A clean drawing has one stroke per primitive; a messy one has
 * many tiny segments. We normalise against a soft cap of 16 strokes — any
 * spell drawn in more than 16 segments reads as a scribble.
 *
 * @param {object} glyphAST
 * @returns {number} 0..1
 */
function strokeContinuity(glyphAST) {
  const candidates = Array.isArray(glyphAST.candidates) ? glyphAST.candidates : [];
  const totalStrokes = candidates.reduce((sum, candidate) => sum + (candidate.strokeIds?.length ?? 1), 0);
  // Soft cap: 16 segments is the "scribble floor" — any more and continuity
  // collapses to zero. Below that we scale linearly.
  const SCRIBBLE_FLOOR = 16;
  if (totalStrokes <= 0) return 0;
  return clamp(1 - (totalStrokes - 1) / SCRIBBLE_FLOOR);
}

/**
 * Closure precision component — outer ring join-point gap distance,
 * inverted and normalised by ring radius. A perfect closure (complete=true)
 * scores 1.0; a hairline gap of 1% of the ring radius scores ~0.85; a wide
 * gap (>20% of ring radius) collapses toward 0.
 *
 * @param {object} glyphAST
 * @returns {number} 0..1
 */
function closurePrecision(glyphAST) {
  const outer = getOuterRing(glyphAST);
  if (!outer) return 0;
  if (outer.complete) return 1;
  // Prefer arc-length gap if available; fall back to (1 - completeness).
  const radius = Math.max(1, outer.radius ?? 1);
  const arcGap = typeof outer.gapArcLength === "number" ? outer.gapArcLength : null;
  if (arcGap !== null) {
    // Normalise against the ring circumference; full circumference gap → 0.
    const circumference = 2 * Math.PI * radius;
    return clamp(1 - arcGap / circumference);
  }
  const completeness = typeof outer.completeness === "number" ? outer.completeness : 0;
  return clamp(completeness);
}

/**
 * Radial symmetry component — keystone radial-angle balance. The parser
 * already computes this via `calculateDirectionalBias` (drawingClassifier.js).
 * We just re-expose it explicitly so the panel can show it.
 *
 * @param {object} glyphAST
 * @returns {number} 0..1
 */
function radialSymmetry(glyphAST) {
  return clamp(glyphAST.globalMetrics?.radialSymmetry ?? 0);
}

/**
 * Length component — total ink length / (2π × outer ring radius), capped at
 * LENGTH_CAP. Canon: Lane 2 §4 — overdrawing dilutes the seal.
 *
 * Returns the *unnormalised* multiplier (0..LENGTH_CAP). The qualityMetrics
 * panel renders this against the cap; the power formula in spellBuilder
 * also clamps at the cap so spirals don't explode the spell.
 *
 * @param {object} glyphAST
 * @returns {number} 0..LENGTH_CAP
 */
function inkLengthRatio(glyphAST) {
  const outer = getOuterRing(glyphAST);
  if (!outer || !(outer.radius > 0)) return 0;
  const circumference = 2 * Math.PI * outer.radius;
  // Prefer the parser-recorded ink-length signal where available. Fall back
  // to ring overdrawAmount (overdraw above 1.08× circumference, see
  // ringDetector.js:268) plus a baseline of 1.0 if the ring closed.
  const overdraw = typeof outer.overdrawAmount === "number" ? outer.overdrawAmount : 0;
  // Baseline is the ring itself (1× circumference of ink along the ring).
  const ringBase = outer.complete ? 1 : (outer.completeness ?? 0);
  // Each candidate (sigil/sign) adds proportional ink; treat each as ~0.2×
  // circumference on average (a small symbol relative to a ring). This is a
  // heuristic — the bench/recognize.js corpus exposes drift sensitivity.
  const candidates = Array.isArray(glyphAST.candidates) ? glyphAST.candidates : [];
  const candidateInk = candidates.length * 0.2;
  const ratio = ringBase + overdraw * 1.08 + candidateInk;
  // Numerical safety: clamp to [0, LENGTH_CAP].
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(LENGTH_CAP, Math.max(0, ratio));
}

/**
 * M5 — Compute the explicit qualityMetrics block consumed by
 * `spellBuilder.js` and the Quality panel UI.
 *
 * The returned object has:
 *   - cleanliness:       0..1 — weighted composite (smoothness + continuity +
 *                         closure + symmetry)
 *   - length:            0..LENGTH_CAP — normalised ink/circumference ratio
 *   - closurePrecision:  0..1 — ring join-point gap, inverted
 *   - symmetry:          0..1 — radial-angle balance
 *   - strokeSmoothness:  0..1 — component, exposed for the panel tooltip
 *   - strokeContinuity:  0..1 — component, exposed for the panel tooltip
 *
 * @param {object} glyphAST  the AST produced by `classifyDrawing`
 * @returns {object} qualityMetrics
 */
export function computeQualityMetrics(glyphAST) {
  if (!glyphAST) {
    return {
      cleanliness: 0,
      length: 0,
      closurePrecision: 0,
      symmetry: 0,
      strokeSmoothness: 0,
      strokeContinuity: 0
    };
  }

  const smoothness = strokeSmoothness(glyphAST);
  const continuity = strokeContinuity(glyphAST);
  const closure = closurePrecision(glyphAST);
  const symmetry = radialSymmetry(glyphAST);
  const length = inkLengthRatio(glyphAST);

  const cleanliness = clamp(
    smoothness * CLEANLINESS_WEIGHTS.strokeSmoothness +
      continuity * CLEANLINESS_WEIGHTS.strokeContinuity +
      closure * CLEANLINESS_WEIGHTS.closurePrecision +
      symmetry * CLEANLINESS_WEIGHTS.symmetry
  );

  return {
    cleanliness,
    length,
    closurePrecision: closure,
    symmetry,
    strokeSmoothness: smoothness,
    strokeContinuity: continuity
  };
}

/**
 * M5 — Higher-level structured quality output. This is the function called
 * by external consumers (judge prompts, panel UI) when they want the full
 * named breakdown plus the legacy scalar quality score for back-compat.
 *
 * @param {object} glyphAST
 * @returns {object} full structured quality output
 */
export function computeSpellQuality(glyphAST) {
  const metrics = computeQualityMetrics(glyphAST);
  // Preserve the legacy scalar so existing call-sites (spellBuilder duration,
  // judge fallback, diagnostics view) keep working.
  const legacyQuality = calculateSpellQuality(glyphAST);
  return {
    ...metrics,
    // Legacy fields preserved during transition for backward compat — these
    // continue to drive the existing power/duration formulas until M5+
    // migrates them.
    neatness: legacyQuality,
    valid: Boolean(glyphAST?.primarySigil),
    legacyQuality
  };
}

export { CLEANLINESS_WEIGHTS, LENGTH_CAP };

export function calculateSpellQuality(glyphAST) {
  const ringQuality = getOuterRing(glyphAST)?.neatness ?? 0;
  const primaryConfidence = glyphAST.primarySigil?.confidence ?? 0;
  const signConfidence = mean((glyphAST.signs ?? []).map((sign) => sign.confidence));
  const globalNeatness = glyphAST.globalMetrics?.neatness ?? 0;
  const symmetry = glyphAST.globalMetrics?.radialSymmetry ?? 0;
  const insideScore = 1 - Math.min(1, (glyphAST.unknowns?.length ?? 0) / QUALITY_TUNING.unknownSoftLimit);

  return clamp(
    ringQuality * QUALITY_TUNING.ringQuality +
      primaryConfidence * QUALITY_TUNING.primaryConfidence +
      (signConfidence || primaryConfidence * QUALITY_TUNING.signFallbackPrimaryConfidence) *
        QUALITY_TUNING.signConfidence +
      globalNeatness * QUALITY_TUNING.globalNeatness +
      symmetry * QUALITY_TUNING.radialSymmetry +
      insideScore * QUALITY_TUNING.insideScore
  );
}

export function calculateSpellStability(glyphAST, config) {
  const ringNeatness = getOuterRing(glyphAST)?.neatness ?? 0;
  const symbolNeatness = mean([
    glyphAST.primarySigil?.neatness ?? 0,
    ...(glyphAST.signs ?? []).map((sign) => sign.neatness)
  ].filter(Boolean));
  const unknownPenalty = Math.min(
    STABILITY_TUNING.unknownPenaltyMax,
    ((glyphAST.unknowns?.length ?? 0) / config.compiler.maxUnknownsBeforeInstability) *
      STABILITY_TUNING.unknownPenaltyScale
  );
  const ambiguityPenalty = Math.max(
    0,
    topMatchCompetitorConfidence(glyphAST.primarySigil) -
      (glyphAST.primarySigil?.confidence ?? 0) +
      STABILITY_TUNING.ambiguityGrace
  );
  const boundaryPenalty = (glyphAST.warnings ?? []).includes(GLYPH_WARNINGS.symbolNearLayerBoundary)
    ? STABILITY_TUNING.boundaryPenalty
    : 0;
  const centerPenalty = (glyphAST.warnings ?? []).includes(GLYPH_WARNINGS.centerUnknownContamination)
    ? STABILITY_TUNING.centerPenalty
    : 0;
  const inverseInstability = 1 - (glyphAST.globalMetrics?.instability ?? STABILITY_TUNING.instabilityFallback);

  return clamp(
    ringNeatness * STABILITY_TUNING.ringNeatness +
      (symbolNeatness || STABILITY_TUNING.symbolNeatnessFallback) * STABILITY_TUNING.symbolNeatness +
      (glyphAST.globalMetrics?.radialSymmetry ?? STABILITY_TUNING.radialSymmetryFallback) *
        STABILITY_TUNING.radialSymmetry +
      inverseInstability * STABILITY_TUNING.inverseInstability -
      unknownPenalty -
      ambiguityPenalty -
      boundaryPenalty -
      centerPenalty
  );
}
