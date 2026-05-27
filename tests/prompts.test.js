/**
 * Smoke tests for prompt builders.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  FAST_SYSTEM_PROMPT,
  DEEP_SYSTEM_PROMPT,
  buildFewShotAnchors,
  systemPromptFor,
  WHA_DSL_TOOL
} from "../src/parser/llmJudge/prompts.js";

test("FAST_SYSTEM_PROMPT references the closed glyph set", () => {
  for (const g of ["fire", "water", "wind", "earth", "light", "none"]) {
    assert.ok(FAST_SYSTEM_PROMPT.includes(g), `FAST prompt missing glyph "${g}"`);
  }
});

test("DEEP_SYSTEM_PROMPT names all five rubric axes", () => {
  for (const axis of ["closure", "cleanliness", "continuity", "recognizability", "score"]) {
    assert.ok(DEEP_SYSTEM_PROMPT.includes(axis), `DEEP prompt missing axis "${axis}"`);
  }
});

test("buildFewShotAnchors handles missing dictionary inputs gracefully", () => {
  const txt = buildFewShotAnchors(null, undefined);
  assert.ok(typeof txt === "string");
});

test("buildFewShotAnchors names sigils + signs", () => {
  const txt = buildFewShotAnchors(
    [{ id: "fire", displayName: "Fire", element: "fire" }],
    [{ id: "column", displayName: "Column" }]
  );
  assert.ok(txt.includes("Fire"));
  assert.ok(txt.includes("Column"));
  assert.ok(txt.includes("fire"));
});

test("systemPromptFor('fast') falls back to FAST when dictionary absent", () => {
  assert.equal(systemPromptFor("fast"), FAST_SYSTEM_PROMPT);
});

test("systemPromptFor('deep') appends few-shot anchors when dictionary present", () => {
  const dict = { sigils: [{ id: "fire", element: "fire" }], signs: [{ id: "column" }] };
  const out = systemPromptFor("deep", dict);
  assert.ok(out.startsWith(DEEP_SYSTEM_PROMPT));
  assert.ok(out.includes("fire"));
});

test("WHA_DSL_TOOL exports a function-style tool definition referencing the schema", () => {
  assert.equal(WHA_DSL_TOOL.type, "function");
  assert.equal(WHA_DSL_TOOL.function.name, "report_glyph");
  assert.equal(WHA_DSL_TOOL.function.parameters.type, "object");
});
