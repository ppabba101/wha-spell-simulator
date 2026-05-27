/**
 * Prompt definitions for the streaming judge.
 *
 * `FAST_SYSTEM_PROMPT` is short, closed-set classification only; used by the
 * Groq fast leg whose job is to ship a primitives + guess payload in <500ms.
 *
 * `DEEP_SYSTEM_PROMPT` is the full rubric (closure / cleanliness / continuity
 * / recognizability / score) with hints; used by the SambaNova deep leg.
 *
 * Both prompts reference the WHA-DSL JSON schema directly so the model
 * cannot leak its own idiom into the response.
 */

import { WHA_DSL_SCHEMA, GLYPH_IDS } from "./dsl.js";

const GLYPH_SET = GLYPH_IDS.join(", ");

export const FAST_SYSTEM_PROMPT = [
  "You are the Witch Hat Atelier glyph judge (fast leg).",
  "",
  `Of {${GLYPH_SET}}, which is this glyph closest to?`,
  "Return ONLY a strict JSON object matching the WHA-DSL schema with:",
  "  - primitives: list of Ring | Line | Arc | Dot | Symmetry",
  "  - guess: { glyphId, confidence } using ONLY the closed set above",
  "  - critique: { score: 1..5 } (one-number rubric, no sub-scores in fast mode)",
  "",
  "No prose, no markdown fences, no extra keys. JSON only."
].join("\n");

export const DEEP_SYSTEM_PROMPT = [
  "You are the Witch Hat Atelier glyph judge (deep leg).",
  "",
  `Of {${GLYPH_SET}}, which is this glyph closest to?`,
  "Return ONLY a strict JSON object matching the WHA-DSL schema with:",
  "  - primitives: full list of Ring | Line | Arc | Dot | Symmetry (parents indexed)",
  "  - guess: { glyphId, confidence }",
  "  - alternatives: up to 2 also-rans { glyphId, confidence }",
  "  - critique: { closure, cleanliness, continuity, length, recognizability, score } each in 1..5",
  "  - hint: optional one-sentence corrective tip in plain text",
  "",
  "Scoring rubric (each axis 1..5). In your `critique`, score cleanliness AND",
  "length explicitly (1..5) and report your reasoning briefly in `hint`:",
  "  - closure: how cleanly the outer ring closes (5 = perfect, 1 = gaping).",
  "    Anchor: a fire seal whose outer ring meets at the dot scores 5; a ring",
  "    with a visible hairline gap scores 3; a horseshoe scores 1.",
  "  - cleanliness: line steadiness / lack of jitter (5 = ruled, 1 = scribbled).",
  "    Anchor: a perfect circle + 3 straight fire-rays scores 5; a wavy ring",
  "    with shaky rays scores 3; a heavily-overdrawn doodle scores 1.",
  "  - continuity: stroke flow / few pen-lifts (5 = one-shot, 1 = many segments).",
  "  - length: total inked length relative to the outer ring (5 = ink ≥ full ring",
  "    perimeter, i.e. ratio ≥ 1.0×; 3 ≈ half perimeter; 1 = tiny stub).",
  "    Anchor: a complete ring plus 8 long light-rays scores 5; a closed ring",
  "    with one short tick scores 3; a half-arc scores 1.",
  "  - recognizability: distance to canonical glyph template (5 = textbook).",
  "  - score: overall, weighted across the above.",
  "",
  "No prose outside the JSON, no markdown fences, no extra top-level keys."
].join("\n");

/**
 * Build few-shot anchors from the dictionary. Each anchor names a sigil + the
 * primary primitive shape its template traces. We deliberately do NOT inline
 * stroke coordinates — that's the model's job to recover from the rendered
 * image — but we do anchor the closed-set vocabulary.
 *
 * @param {object[]} sigils - from `src/dictionary/sigils.json`
 * @param {object[]} signs  - from `src/dictionary/signs.json`
 * @returns {string} few-shot text appended after the system prompt
 */
export function buildFewShotAnchors(sigils, signs) {
  const lines = ["Few-shot anchors (closed-set vocabulary):"];

  if (Array.isArray(sigils)) {
    lines.push("Sigils (center of seal):");
    for (const s of sigils) {
      if (!s?.id || !s?.element) continue;
      lines.push(`  - ${s.displayName ?? s.id} → element=${s.element}`);
    }
  }

  if (Array.isArray(signs)) {
    lines.push("Signs (outer band modifiers):");
    for (const s of signs) {
      if (!s?.id) continue;
      lines.push(`  - ${s.displayName ?? s.id}`);
    }
  }

  return lines.join("\n");
}

/**
 * Strict-JSON tool definition (OpenAI-style function-calling shape).
 * Providers that support tool-calling can attach this to force schema
 * adherence; providers that don't simply receive it as a hint in-prompt.
 */
export const WHA_DSL_TOOL = Object.freeze({
  type: "function",
  function: {
    name: "report_glyph",
    description: "Report the recognised glyph and critique in strict WHA-DSL JSON.",
    parameters: WHA_DSL_SCHEMA
  }
});

/**
 * Convenience: assemble the final system prompt for a given mode.
 */
export function systemPromptFor(mode, dictionary) {
  const base = mode === "deep" ? DEEP_SYSTEM_PROMPT : FAST_SYSTEM_PROMPT;
  if (!dictionary) return base;
  return base + "\n\n" + buildFewShotAnchors(dictionary.sigils, dictionary.signs);
}
