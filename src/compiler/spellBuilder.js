import { GLYPH_WARNINGS } from "../parser/glyphWarnings.js";
import { getOuterRing, walkRings } from "../parser/ringTree.js";
import { clamp } from "../utils/geometry.js";
import {
  aggregateManifestations,
  aggregateSemanticDeltas,
  combineSignDirection,
  signInfluence
} from "./semanticRules.js";
import { directionFromSurfaceVector } from "./spellDirection.js";
import { calculateSpellQuality, calculateSpellStability } from "./spellQuality.js";

/**
 * Walk the nested-ring tree (M4). Returns a SpellIR fragment describing the
 * composition:
 *   compositionMode  — 'single' (no inner rings), 'nested' (≥1 child)
 *   rootRingId       — index of the outer activation ring (always 0 from the
 *                      detector ordering)
 *   coreElement      — innermost-ring element if any; else null (resolved
 *                      against the primarySigil semantic later)
 *   modifierLayers   — [{ ringId, depth, signs }] from outer→inner
 *   ringCount        — total ring nodes
 *
 * Sign attribution heuristic: a sign attaches to the smallest ring whose disc
 * fully contains the sign centroid (closest annulus). The detector currently
 * does not stamp signs onto ring nodes directly, so we keep the heuristic
 * here for backward compatibility. When `glyphAST.signs` is the only source,
 * we attribute them all to the outer ring.
 */
function composeNestedRings(glyphAST) {
  const rings = Array.isArray(glyphAST?.rings) ? glyphAST.rings : [];
  const tree = rings.length ? rings : glyphAST?.ring ? [glyphAST.ring] : [];

  let ringCount = 0;
  const layers = [];
  let innermost = null;

  for (const { ring, depth } of walkRings(tree)) {
    ringCount += 1;
    layers.push({
      ringId: ringCount - 1,
      depth,
      ringComplete: Boolean(ring.complete),
      ringRadius: ring.radius,
      // Signs attached to this specific ring (M4 step: detector does not yet
      // attribute signs per ring, so this stays empty by default and the
      // overall sign list lives on glyphAST.signs).
      signs: []
    });
    if (!innermost || depth > innermost.depth) {
      innermost = { ring, depth };
    }
  }

  // Attribute every sign to the innermost ring whose disc contains its
  // centroid. We use the sign's radial position on the outer ring as a proxy
  // since the parser already normalises to the outer ring.
  const allSigns = glyphAST?.signs ?? [];
  const outerRing = getOuterRing(glyphAST);
  if (outerRing && layers.length) {
    for (const sign of allSigns) {
      const radiusNorm = sign.radiusNorm ?? 1;
      // Map radiusNorm (0 inside ring → 1 at boundary of outer ring) to the
      // ring whose normalised radius bracket it falls into. For a nested
      // tree, depth-N ring lives roughly at radiusNorm ≤ depth-N inner cap.
      let chosenIndex = 0;
      // Walk in increasing depth and pick the deepest ring whose proportional
      // radius (child.radius / outer.radius) is ≥ radiusNorm; that means the
      // sign sits inside that ring's disc.
      for (let i = 0; i < layers.length; i += 1) {
        const node = layers[i];
        const proportion = node.ringRadius / Math.max(1, outerRing.radius);
        if (proportion >= radiusNorm) {
          chosenIndex = i;
        }
      }
      layers[chosenIndex].signs.push(sign);
    }
  } else if (layers.length) {
    // No outer ring metadata: dump everything onto the outermost layer.
    layers[0].signs.push(...allSigns);
  }

  return {
    compositionMode: layers.length > 1 ? "nested" : "single",
    rootRingId: 0,
    coreElement: innermost?.ring?.element ?? null,
    modifierLayers: layers,
    ringCount
  };
}

const PRIMARY_SIGIL_AMBIGUITY_GAP = 0.05;

const SUPPORTED_ELEMENTS = new Set(["fire", "water", "wind", "earth", "light"]);

const SPELL_PARAMETER_TUNING = {
  focusBase: 0.46,
  focusQuality: 0.2,
  spreadBase: 0.32,
  spreadInverseFocus: 0.28,
  forceBase: 0.34,
  forceSignPower: 0.34,
  forceQuality: 0.18,
  rangeBase: 0.42,
  rangeSignPower: 0.18,
  durationMinSeconds: 0.65,
  durationMaxSeconds: 8.5,
  durationSecondsScale: 6.4,
  durationQualityWeight: 0.35,
  durationNeatnessWeight: 0.65,
  durationCurve: 1.45
};

const PHYSICS_TUNING = {
  levitationGravityScale: 0.42
};

function sameKindAlternateConfidence(recognition) {
  return (
    recognition.diagnostics?.topMatches?.find((score) => score.kind === recognition.kind && score.id !== recognition.id)?.confidence ??
    0
  );
}

function invalidSpell(status, glyphAST, warnings = []) {
  const outer = getOuterRing(glyphAST);
  const ringComplete = Boolean(outer?.complete);
  const combinedWarnings = [...new Set([...(glyphAST.warnings ?? []), ...warnings])];
  const composition = composeNestedRings(glyphAST);
  return {
    type: "SpellIR",
    active: false,
    prepared: false,
    valid: false,
    status,
    activatedAt: null,
    element: null,
    elementConfidence: 0,
    primarySizeNorm: 0,
    effectScale: 1,
    primaryManifestation: "none",
    manifestations: {},
    direction: { x: 0, y: 0, z: 1, xTiltDeg: 0, yTiltDeg: 0, tiltFromZDeg: 0 },
    directionCoherence: 0,
    gravity: 1,
    force: 0,
    spread: 0,
    focus: 0,
    range: 0,
    duration: 0,
    stability: 0,
    quality: 0,
    compositionMode: composition.compositionMode,
    rootRingId: composition.rootRingId,
    coreElement: composition.coreElement,
    modifierLayers: composition.modifierLayers,
    ringCount: composition.ringCount,
    neatness: glyphAST.globalMetrics?.neatness ?? 0,
    warnings: combinedWarnings,
    signature: `invalid:${status}:${ringComplete}:${outer?.completeness ?? 0}`
  };
}

function calculateSpellGravity(manifestationInfluence) {
  return clamp(1 - (manifestationInfluence.levitation ?? 0) * PHYSICS_TUNING.levitationGravityScale);
}

function manifestationSignature(manifestations) {
  return Object.entries(manifestations)
    .map(([id, manifestation]) => {
      const point = manifestation.point
        ? `.p${Math.round(manifestation.point.x * 100)}.${Math.round(manifestation.point.y * 100)}`
        : "";
      const radius = manifestation.radius === undefined ? "" : `.r${Math.round(manifestation.radius * 100)}`;
      return `${id}.${Math.round((manifestation.strength ?? 0) * 100)}${point}${radius}`;
    })
    .sort()
    .join(",");
}

function calculateSpellDuration({ primarySemantic, deltas, quality, neatness }) {
  const durationScore = clamp(
    quality * SPELL_PARAMETER_TUNING.durationQualityWeight +
      neatness * SPELL_PARAMETER_TUNING.durationNeatnessWeight +
      (primarySemantic.lifetimeBias ?? 0) +
      deltas.lifetimeBias
  );

  return clamp(
    SPELL_PARAMETER_TUNING.durationMinSeconds +
      Math.pow(durationScore, SPELL_PARAMETER_TUNING.durationCurve) * SPELL_PARAMETER_TUNING.durationSecondsScale,
    SPELL_PARAMETER_TUNING.durationMinSeconds,
    SPELL_PARAMETER_TUNING.durationMaxSeconds
  );
}

export function compileSpell({ glyphAST, config }) {
  const outerRing = getOuterRing(glyphAST);
  if (!outerRing?.found) {
    return invalidSpell("No ring detected", glyphAST ?? { globalMetrics: {} });
  }

  // M4: nested rings are no longer rejected — only true sibling rings sitting
  // at the same top level are still listed as unsupportedMultipleRings by the
  // detector. We continue to reject those because cross-ring linkage will be
  // handled by a later milestone.
  if (outerRing.unsupportedMultipleRings?.length) {
    return invalidSpell("Multiple rings detected", glyphAST, [GLYPH_WARNINGS.unsupportedMultipleRings]);
  }

  if (glyphAST.unsupportedMultipleSigils?.length) {
    return invalidSpell("Multiple sigils detected", glyphAST, [GLYPH_WARNINGS.unsupportedMultipleSigils]);
  }

  const primary = glyphAST.primarySigil;
  if (!primary) {
    return invalidSpell("Invalid spell", glyphAST, [GLYPH_WARNINGS.missingPrimarySigil]);
  }

  if (primary.confidence < config.compiler.minimumPrimarySigilConfidence) {
    return invalidSpell("Invalid spell", glyphAST, [GLYPH_WARNINGS.primarySigilConfidenceLow]);
  }

  const confidenceGap = primary.confidence - sameKindAlternateConfidence(primary);
  if (confidenceGap < PRIMARY_SIGIL_AMBIGUITY_GAP) {
    return invalidSpell("Ambiguous sigil", glyphAST, [GLYPH_WARNINGS.primarySigilAmbiguous]);
  }

  if (!primary.element) {
    return invalidSpell("Unsupported element", glyphAST, [GLYPH_WARNINGS.primaryElementMissing]);
  }

  if (!SUPPORTED_ELEMENTS.has(primary.element)) {
    return invalidSpell("Unsupported element", glyphAST, [GLYPH_WARNINGS.primaryElementUnsupported]);
  }

  const signs = glyphAST.signs ?? [];
  const quality = calculateSpellQuality(glyphAST);
  const stability = calculateSpellStability(glyphAST, config);
  const neatness = glyphAST.globalMetrics?.neatness ?? quality;
  const { primaryManifestation, manifestations, manifestationInfluence } = aggregateManifestations(signs);
  const deltas = aggregateSemanticDeltas(signs);
  const surfaceDirection = signs.length ? combineSignDirection(signs) : { x: 0, y: 0, strength: 0 };
  const directionCoherence = surfaceDirection.strength ?? 0;
  const signPower = signs.reduce((sum, sign) => sum + signInfluence(sign), 0);
  const active = Boolean(outerRing.complete);
  const prepared = !active;
  const composition = composeNestedRings(glyphAST);
  const primarySemantic = primary.semantic ?? {};
  const effectScale = clamp(
    config.renderer.effectSize.baseScale + primary.sizeNorm * config.renderer.effectSize.sigilSizeInfluence,
    config.renderer.effectSize.minScale,
    config.renderer.effectSize.maxScale
  );

  const focus = clamp(
    SPELL_PARAMETER_TUNING.focusBase +
      (primarySemantic.focus ?? 0) +
      deltas.focus +
      quality * SPELL_PARAMETER_TUNING.focusQuality
  );
  const spread = clamp(
    SPELL_PARAMETER_TUNING.spreadBase +
      (primarySemantic.spread ?? 0) +
      deltas.spread +
      (1 - focus) * SPELL_PARAMETER_TUNING.spreadInverseFocus
  );

  const force = clamp(
    SPELL_PARAMETER_TUNING.forceBase +
      (primarySemantic.force ?? 0) +
      signPower * SPELL_PARAMETER_TUNING.forceSignPower +
      deltas.force +
      quality * SPELL_PARAMETER_TUNING.forceQuality
  );
  const range = clamp(
    SPELL_PARAMETER_TUNING.rangeBase +
      (primarySemantic.range ?? 0) +
      deltas.range +
      signPower * SPELL_PARAMETER_TUNING.rangeSignPower
  );
  const duration = calculateSpellDuration({ primarySemantic, deltas, quality, neatness });
  const direction = directionFromSurfaceVector(surfaceDirection, force);
  const gravity = calculateSpellGravity(manifestationInfluence);

  return {
    type: "SpellIR",
    active,
    prepared,
    valid: true,
    status: active ? "Active spell" : "Prepared spell",
    activatedAt: active ? performance.now() : null,
    element: primary.element,
    elementConfidence: primary.confidence,
    primarySizeNorm: primary.sizeNorm,
    effectScale,
    primaryManifestation,
    manifestations,
    direction,
    directionCoherence,
    gravity,
    force,
    spread,
    focus,
    range,
    duration,
    stability,
    quality,
    compositionMode: composition.compositionMode,
    rootRingId: composition.rootRingId,
    coreElement: composition.coreElement ?? primary.element,
    modifierLayers: composition.modifierLayers,
    ringCount: composition.ringCount,
    neatness,
    warnings: glyphAST.warnings ?? [],
    signature: `${primary.id}:${manifestationSignature(manifestations)}:${active}:${Math.round(effectScale * 100)}:${Math.round(
      force * 100
    )}:${Math.round(spread * 100)}:${Math.round(duration * 100)}:${Math.round(direction.xTiltDeg)}:${Math.round(
      direction.yTiltDeg
    )}:${Math.round(directionCoherence * 100)}:${Math.round(gravity * 100)}:${Math.round(
      quality * 100
    )}:${Math.round(stability * 100)}`
  };
}
