import assert from "node:assert/strict";
import test from "node:test";

import { createProgressiveJsonParser } from "../src/parser/llmJudge/progressiveJsonParser.js";
import { WHA_DSL_SCHEMA } from "../src/parser/llmJudge/dsl.js";

const FULL = {
  primitives: [
    { type: "Ring", cx: 100, cy: 100, r: 50, completeness: 0.9 },
    { type: "Dot", cx: 110, cy: 110 }
  ],
  guess: { glyphId: "fire", confidence: 0.8 },
  critique: { score: 4 }
};

function chunked(s, size) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

test("emits final on a clean, single-shot feed", () => {
  const parser = createProgressiveJsonParser({ schema: WHA_DSL_SCHEMA });
  let finalSeen = null;
  parser.onFinal((v) => {
    finalSeen = v;
  });
  parser.feed(JSON.stringify(FULL));
  const final = parser.end();
  assert.deepEqual(final, FULL);
  assert.deepEqual(finalSeen, FULL);
});

test("emits final when input is chunked tightly (2-byte chunks)", () => {
  const parser = createProgressiveJsonParser();
  let finalSeen = null;
  parser.onFinal((v) => {
    finalSeen = v;
  });
  const chunks = chunked(JSON.stringify(FULL), 2);
  for (const c of chunks) parser.feed(c);
  parser.end();
  assert.deepEqual(finalSeen, FULL);
});

test("emits at least one partial as primitives accumulate", () => {
  const parser = createProgressiveJsonParser();
  const partials = [];
  parser.onPartial((v) => partials.push(v));
  // Feed primitive-by-primitive in JSON form.
  parser.feed('{"primitives":[');
  parser.feed('{"type":"Ring","cx":1,"cy":2,"r":3}');
  // After first primitive, balancer can close array+object: should emit.
  assert.ok(partials.length >= 1, "expected at least one partial after one primitive");
  parser.feed(',{"type":"Dot","cx":4,"cy":5}');
  parser.feed('],"guess":{"glyphId":"fire","confidence":0.5},"critique":{"score":4}}');
  parser.end();
  assert.ok(partials.length >= 2, "expected more partials as more primitives arrive");
});

test("strips markdown fence pre-amble", () => {
  const parser = createProgressiveJsonParser();
  let final = null;
  parser.onFinal((v) => {
    final = v;
  });
  parser.feed("```json\n");
  parser.feed(JSON.stringify(FULL));
  parser.feed("\n```");
  parser.end();
  assert.deepEqual(final, FULL);
});

test("end() returns null on unparseable garbage", () => {
  const parser = createProgressiveJsonParser();
  parser.feed("not even close to json");
  const final = parser.end();
  assert.equal(final, null);
});

test("end() rejects strict-invalid output via onError and returns null", () => {
  const parser = createProgressiveJsonParser();
  const errors = [];
  parser.onError((e) => errors.push(e));
  // Missing critique — strict validation will reject.
  const partial = JSON.stringify({
    primitives: [],
    guess: { glyphId: "fire", confidence: 0.5 }
  });
  parser.feed(partial);
  const final = parser.end();
  assert.equal(final, null);
  assert.equal(errors.length, 1);
});
