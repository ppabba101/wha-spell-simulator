/**
 * Strict Ajv-backed validator for WHA-DSL responses.
 *
 * Defence-in-depth: every judge output is parsed against `WHA_DSL_SCHEMA` before any
 * downstream module sees it. Tolerant `validatePartial` lets the progressive-JSON
 * parser emit half-formed payloads without false negatives.
 *
 * Ajv is imported lazily so node:test / fast-check unit tests don't pay the
 * compile cost for fixtures that bypass the validator.
 */

import Ajv from "ajv";

import { WHA_DSL_SCHEMA, WHA_DSL_PARTIAL_SCHEMA } from "./dsl.js";

let compiledStrict = null;
let compiledPartial = null;

function getStrictValidator() {
  if (!compiledStrict) {
    const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
    compiledStrict = ajv.compile(WHA_DSL_SCHEMA);
  }
  return compiledStrict;
}

function getPartialValidator() {
  if (!compiledPartial) {
    const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
    compiledPartial = ajv.compile(WHA_DSL_PARTIAL_SCHEMA);
  }
  return compiledPartial;
}

function shapeErrors(errors) {
  if (!errors || !errors.length) return [];
  return errors.map((err) => ({
    path: err.instancePath || "/",
    keyword: err.keyword,
    message: err.message,
    params: err.params
  }));
}

/**
 * Strict validation: full WHA-DSL object must be present, well-typed,
 * and contain no extra keys (no model idioms leaking through).
 * @param {unknown} obj
 * @returns {{ ok: true, value: object } | { ok: false, errors: Array }}
 */
export function validateDsl(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: [{ path: "/", keyword: "type", message: "must be an object" }] };
  }
  const validator = getStrictValidator();
  const ok = validator(obj);
  if (ok) return { ok: true, value: obj };
  return { ok: false, errors: shapeErrors(validator.errors) };
}

/**
 * Tolerant validation for progressive parsing: every present key still validates
 * but no top-level key is required. Unknown keys are allowed because the model
 * may emit incomplete objects mid-stream.
 * @param {unknown} obj
 * @returns {{ ok: true, value: object } | { ok: false, errors: Array }}
 */
export function validatePartial(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: [{ path: "/", keyword: "type", message: "must be an object" }] };
  }
  const validator = getPartialValidator();
  const ok = validator(obj);
  if (ok) return { ok: true, value: obj };
  return { ok: false, errors: shapeErrors(validator.errors) };
}

/**
 * Helper for tests + the Worker side: validate ONE primitive object against the
 * `primitives[]` member schema (each oneOf branch).
 */
export function validatePrimitive(prim) {
  return validatePartial({ primitives: [prim] });
}
