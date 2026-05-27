import assert from "node:assert/strict";
import test from "node:test";

import { astToDsl, dslToAst, roundTrip, ringTreesEqual } from "../src/parser/llmJudge/astDslMapper.js";

function ring(cx, cy, r, completeness, children = []) {
  return { cx, cy, r, completeness, children };
}

test("astToDsl flattens a single root ring", () => {
  const ast = { rings: [ring(100, 100, 50, 0.9)] };
  const dsl = astToDsl(ast);
  assert.equal(dsl.primitives.length, 1);
  assert.equal(dsl.primitives[0].type, "Ring");
  assert.equal(dsl.primitives[0].cx, 100);
  assert.equal(dsl.primitives[0].r, 50);
  assert.equal(dsl.primitives[0].completeness, 0.9);
  assert.equal(dsl.primitives[0].parent, undefined);
});

test("astToDsl flattens nested ring (depth 2) and assigns parent indexes", () => {
  const ast = { rings: [ring(0, 0, 100, 1, [ring(0, 0, 40, 0.95)])] };
  const dsl = astToDsl(ast);
  assert.equal(dsl.primitives.length, 2);
  assert.equal(dsl.primitives[0].parent, undefined);
  assert.equal(dsl.primitives[1].parent, 0);
});

test("astToDsl flattens three-deep nesting in pre-order", () => {
  const ast = {
    rings: [ring(0, 0, 100, 1, [ring(0, 0, 60, 1, [ring(0, 0, 30, 1)])])]
  };
  const dsl = astToDsl(ast);
  assert.equal(dsl.primitives.length, 3);
  assert.equal(dsl.primitives[0].parent, undefined);
  assert.equal(dsl.primitives[1].parent, 0);
  assert.equal(dsl.primitives[2].parent, 1);
});

test("astToDsl detects a cycle in the ring tree", () => {
  const self = { cx: 0, cy: 0, r: 10, children: [] };
  self.children.push(self);
  const ast = { rings: [self] };
  assert.throws(() => astToDsl(ast), /cycle/);
});

test("astToDsl rejects depth above the safety limit", () => {
  let head = ring(0, 0, 200, 1);
  let cursor = head;
  for (let i = 0; i < 12; i += 1) {
    const next = ring(0, 0, 200 - i, 1);
    cursor.children.push(next);
    cursor = next;
  }
  assert.throws(() => astToDsl({ rings: [head] }), /depth/);
});

test("dslToAst rebuilds nested tree from parent indexes", () => {
  const dsl = {
    primitives: [
      { type: "Ring", cx: 0, cy: 0, r: 100, completeness: 1 },
      { type: "Ring", cx: 0, cy: 0, r: 40, completeness: 0.95, parent: 0 }
    ]
  };
  const ast = dslToAst(dsl);
  assert.equal(ast.rings.length, 1);
  assert.equal(ast.rings[0].r, 100);
  assert.equal(ast.rings[0].children.length, 1);
  assert.equal(ast.rings[0].children[0].r, 40);
});

test("dslToAst rejects reverse parent (cycle)", () => {
  const dsl = {
    primitives: [
      { type: "Ring", cx: 0, cy: 0, r: 10, parent: 1 },
      { type: "Ring", cx: 0, cy: 0, r: 5 }
    ]
  };
  assert.throws(() => dslToAst(dsl), /cycle/);
});

test("round-trip preserves single ring", () => {
  const ast = { rings: [ring(50, 60, 80, 0.9)] };
  const ast2 = roundTrip(ast);
  assert.equal(ringTreesEqual(ast, ast2), true);
});

test("round-trip preserves nested rings (3 deep)", () => {
  const ast = {
    rings: [
      ring(0, 0, 200, 1, [
        ring(0, 0, 120, 0.95, [ring(0, 0, 60, 0.9)]),
        ring(40, 40, 50, 0.8)
      ])
    ]
  };
  const ast2 = roundTrip(ast);
  assert.equal(ringTreesEqual(ast, ast2), true);
});

test("round-trip preserves attached non-ring primitives at the top level", () => {
  const ast = {
    rings: [ring(0, 0, 100, 1)],
    lines: [{ a1: 0, a2: 1.5, length: 50 }],
    arcs: [{ cx: 0, cy: 0, r: 90, startAngle: 0, endAngle: 1 }],
    dots: [{ cx: 5, cy: 5, r: 2 }],
    symmetries: [{ n: 5, centerX: 0, centerY: 0 }]
  };
  const dsl = astToDsl(ast);
  // 1 ring + 4 attached = 5 primitives
  assert.equal(dsl.primitives.length, 5);
  const ast2 = dslToAst(dsl);
  assert.equal(ast2.rings.length, 1);
  assert.equal(ast2.lines.length, 1);
  assert.equal(ast2.arcs.length, 1);
  assert.equal(ast2.dots.length, 1);
  assert.equal(ast2.symmetries.length, 1);
});

test("legacy single-ring AST (ring: {...}) is supported", () => {
  const ast = { ring: ring(10, 10, 30, 0.7) };
  const dsl = astToDsl(ast);
  assert.equal(dsl.primitives.length, 1);
  const ast2 = dslToAst(dsl);
  assert.equal(ast2.rings.length, 1);
  assert.equal(ast2.rings[0].r, 30);
});

test("ringTreesEqual returns false on geometry mismatch", () => {
  const a = { rings: [ring(0, 0, 100, 1)] };
  const b = { rings: [ring(0, 0, 99, 1)] };
  assert.equal(ringTreesEqual(a, b), false);
});

test("ringTreesEqual returns false on topology mismatch", () => {
  const a = { rings: [ring(0, 0, 100, 1, [ring(0, 0, 40, 1)])] };
  const b = { rings: [ring(0, 0, 100, 1)] };
  assert.equal(ringTreesEqual(a, b), false);
});
