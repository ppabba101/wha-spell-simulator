/**
 * WHA-DSL — the universal contract between the LLM judge and every downstream module.
 *
 * Principle 1: every judge response, canonical glyph definition, nested-ring composition rule,
 * and renderer hand-off serialises through THIS schema. The DSL is the only coupling between
 * the LLM and downstream code; never let any model's idiom leak past this boundary.
 *
 * Primitive union:   Ring | Line | Arc | Dot | Symmetry
 * Closed glyph set:  fire | water | wind | earth | light | none
 */

export const GLYPH_IDS = Object.freeze(["fire", "water", "wind", "earth", "light", "none"]);

export const PRIMITIVE_TYPES = Object.freeze(["Ring", "Line", "Arc", "Dot", "Symmetry"]);

/**
 * Ajv strict-mode compatible JSON Schema for the full WHA-DSL response.
 */
export const WHA_DSL_SCHEMA = {
  $id: "https://wha-spell-simulator/schemas/wha-dsl.json",
  type: "object",
  required: ["primitives", "guess", "critique"],
  additionalProperties: false,
  properties: {
    primitives: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            required: ["type", "cx", "cy", "r"],
            additionalProperties: false,
            properties: {
              type: { const: "Ring" },
              cx: { type: "number" },
              cy: { type: "number" },
              r: { type: "number" },
              completeness: { type: "number", minimum: 0, maximum: 1 },
              parent: { type: ["integer", "null"], minimum: 0 }
            }
          },
          {
            type: "object",
            required: ["type", "a1", "a2", "length"],
            additionalProperties: false,
            properties: {
              type: { const: "Line" },
              a1: { type: "number" },
              a2: { type: "number" },
              length: { type: "number" },
              parent: { type: ["integer", "null"], minimum: 0 }
            }
          },
          {
            type: "object",
            required: ["type", "cx", "cy", "r", "startAngle", "endAngle"],
            additionalProperties: false,
            properties: {
              type: { const: "Arc" },
              cx: { type: "number" },
              cy: { type: "number" },
              r: { type: "number" },
              startAngle: { type: "number" },
              endAngle: { type: "number" },
              parent: { type: ["integer", "null"], minimum: 0 }
            }
          },
          {
            type: "object",
            required: ["type", "cx", "cy"],
            additionalProperties: false,
            properties: {
              type: { const: "Dot" },
              cx: { type: "number" },
              cy: { type: "number" },
              r: { type: "number" },
              parent: { type: ["integer", "null"], minimum: 0 }
            }
          },
          {
            type: "object",
            required: ["type", "n", "centerX", "centerY"],
            additionalProperties: false,
            properties: {
              type: { const: "Symmetry" },
              n: { type: "integer", minimum: 2 },
              centerX: { type: "number" },
              centerY: { type: "number" },
              parent: { type: ["integer", "null"], minimum: 0 }
            }
          }
        ]
      }
    },
    guess: {
      type: "object",
      required: ["glyphId", "confidence"],
      additionalProperties: false,
      properties: {
        glyphId: { enum: ["fire", "water", "wind", "earth", "light", "none"] },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        required: ["glyphId", "confidence"],
        additionalProperties: false,
        properties: {
          glyphId: { enum: ["fire", "water", "wind", "earth", "light", "none"] },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    critique: {
      type: "object",
      required: ["score"],
      additionalProperties: false,
      properties: {
        closure: { type: "number", minimum: 1, maximum: 5 },
        cleanliness: { type: "number", minimum: 1, maximum: 5 },
        continuity: { type: "number", minimum: 1, maximum: 5 },
        recognizability: { type: "number", minimum: 1, maximum: 5 },
        score: { type: "number", minimum: 1, maximum: 5 }
      }
    },
    errors: { type: "array", items: { type: "string" } },
    hint: { type: "string" }
  }
};

/**
 * A tolerant variant of the full schema used for partial-stream validation.
 * `primitives`, `guess`, and `critique` are still well-typed when present
 * but no longer required, and the top-level object accepts unknown keys
 * because progressive parsing may yield half-emitted objects.
 */
export const WHA_DSL_PARTIAL_SCHEMA = {
  $id: "https://wha-spell-simulator/schemas/wha-dsl-partial.json",
  type: "object",
  additionalProperties: true,
  properties: {
    primitives: WHA_DSL_SCHEMA.properties.primitives,
    guess: {
      type: "object",
      additionalProperties: false,
      properties: WHA_DSL_SCHEMA.properties.guess.properties
    },
    alternatives: WHA_DSL_SCHEMA.properties.alternatives,
    critique: {
      type: "object",
      additionalProperties: false,
      properties: WHA_DSL_SCHEMA.properties.critique.properties
    },
    errors: WHA_DSL_SCHEMA.properties.errors,
    hint: WHA_DSL_SCHEMA.properties.hint
  }
};

// ---- Named primitive constructors (defensive copies; integer-clamping where the schema requires it).

export function Ring({ cx, cy, r, completeness, parent } = {}) {
  const out = { type: "Ring", cx: Number(cx), cy: Number(cy), r: Number(r) };
  if (completeness !== undefined) out.completeness = Number(completeness);
  if (parent !== undefined && parent !== null) out.parent = parent | 0;
  return out;
}

export function Line({ a1, a2, length, parent } = {}) {
  const out = { type: "Line", a1: Number(a1), a2: Number(a2), length: Number(length) };
  if (parent !== undefined && parent !== null) out.parent = parent | 0;
  return out;
}

export function Arc({ cx, cy, r, startAngle, endAngle, parent } = {}) {
  const out = {
    type: "Arc",
    cx: Number(cx),
    cy: Number(cy),
    r: Number(r),
    startAngle: Number(startAngle),
    endAngle: Number(endAngle)
  };
  if (parent !== undefined && parent !== null) out.parent = parent | 0;
  return out;
}

export function Dot({ cx, cy, r, parent } = {}) {
  const out = { type: "Dot", cx: Number(cx), cy: Number(cy) };
  if (r !== undefined) out.r = Number(r);
  if (parent !== undefined && parent !== null) out.parent = parent | 0;
  return out;
}

export function Symmetry({ n, centerX, centerY, parent } = {}) {
  const out = { type: "Symmetry", n: n | 0, centerX: Number(centerX), centerY: Number(centerY) };
  if (parent !== undefined && parent !== null) out.parent = parent | 0;
  return out;
}

export const PRIMITIVE_CONSTRUCTORS = Object.freeze({
  Ring,
  Line,
  Arc,
  Dot,
  Symmetry
});
