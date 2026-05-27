import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONFIG } from "../src/config.js";
import { classifyDrawing } from "../src/parser/drawingClassifier.js";
import { compileSpell } from "../src/compiler/spellBuilder.js";
import { detectRing } from "../src/parser/ringDetector.js";
import {
  buildRingTree,
  flattenRings,
  getInnermostRing,
  getOuterRing,
  walkRings
} from "../src/parser/ringTree.js";
import { astToDsl, dslToAst, ringTreesEqual, roundTrip } from "../src/parser/llmJudge/astDslMapper.js";

const realDictionary = {
  sigils: JSON.parse(readFileSync(new URL("../src/dictionary/sigils.json", import.meta.url), "utf8")),
  signs: JSON.parse(readFileSync(new URL("../src/dictionary/signs.json", import.meta.url), "utf8"))
};

function loadFixture(name) {
  const data = JSON.parse(
    readFileSync(new URL(`./fixtures/glyphs/nested/${name}.strokes.json`, import.meta.url), "utf8")
  );
  // The fixture format stores points as [x, y, t, pressure] tuples. The
  // parser pipeline takes {x, y} objects on each stroke, so unpack them.
  return data.strokes.map((stroke) => ({
    id: stroke.id,
    points: stroke.points.map(([x, y]) => ({ x, y }))
  }));
}

test("buildRingTree nests a ring whose centre lies inside another", () => {
  const inner = { center: { x: 100, y: 100 }, radius: 30 };
  const outer = { center: { x: 100, y: 100 }, radius: 90 };

  const tree = buildRingTree([outer, inner]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].radius, 90);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].radius, 30);
});

test("buildRingTree keeps non-overlapping rings as siblings", () => {
  const a = { center: { x: 50, y: 50 }, radius: 30 };
  const b = { center: { x: 300, y: 50 }, radius: 30 };

  const tree = buildRingTree([a, b]);

  // Non-overlapping circles — both should remain at the top level (siblings).
  assert.equal(tree.length, 2);
  assert.equal(tree[0].children.length, 0);
  assert.equal(tree[1].children.length, 0);
});

test("buildRingTree chooses the smallest enclosing parent for three-deep nesting", () => {
  const tiny = { center: { x: 100, y: 100 }, radius: 10 };
  const mid = { center: { x: 100, y: 100 }, radius: 40 };
  const huge = { center: { x: 100, y: 100 }, radius: 90 };

  const tree = buildRingTree([huge, mid, tiny]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].radius, 90);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].radius, 40);
  assert.equal(tree[0].children[0].children.length, 1);
  assert.equal(tree[0].children[0].children[0].radius, 10);
});

test("classifyDrawing on a clean ring produces glyphAST.rings[0].found === true (regression: summarizeRingNode dropped `found`)", () => {
  // Synthesize a clean 32-segment ring inside a typical 1200x800 canvas.
  // This is the exact failure path users hit: ring drawn, ring detected
  // internally, but summarizeRingNode stripped `found: true` from the
  // public glyphAST.rings[] nodes, so compileSpell's
  // `if (!outerRing?.found) return invalidSpell("No ring detected")`
  // tripped on every spell.
  const cx = 600;
  const cy = 400;
  const radius = 180;
  const points = [];
  for (let i = 0; i <= 64; i += 1) {
    const t = (i / 64) * Math.PI * 2;
    points.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius });
  }
  const strokes = [{ id: "ring", points }];
  const pipeline = classifyDrawing({
    strokes,
    previousRing: null,
    dictionary: realDictionary,
    config: CONFIG
  });
  assert.ok(pipeline.glyphAST, "classifyDrawing should produce a glyphAST");
  assert.ok(
    Array.isArray(pipeline.glyphAST.rings) && pipeline.glyphAST.rings.length >= 1,
    "rings[] should contain the detected ring"
  );
  // The fix: every node in glyphAST.rings must carry found: true.
  for (const ring of pipeline.glyphAST.rings) {
    assert.equal(
      ring.found,
      true,
      `ring node missing found:true — compileSpell would return "No ring detected"`
    );
  }
  // The integrated guard: spellBuilder.compileSpell receives this AST and
  // must NOT return the invalid-spell status that the bug produced.
  const ir = compileSpell({ glyphAST: pipeline.glyphAST, config: CONFIG });
  assert.notEqual(
    ir.status,
    "No ring detected",
    "compileSpell hit the !outerRing?.found guard on a clean ring — regression"
  );
});

test("getOuterRing returns the outermost ring on a tree AST", () => {
  const ast = {
    rings: [
      { center: { x: 1, y: 1 }, radius: 100, children: [{ center: { x: 1, y: 1 }, radius: 20, children: [] }] }
    ]
  };
  const outer = getOuterRing(ast);
  assert.equal(outer.radius, 100);
});

test("getOuterRing falls back to .ring on legacy AST shape", () => {
  const ast = { ring: { center: { x: 5, y: 5 }, radius: 50 } };
  assert.equal(getOuterRing(ast).radius, 50);
});

test("getInnermostRing walks to the deepest leaf on the deepest branch", () => {
  const rings = buildRingTree([
    { center: { x: 100, y: 100 }, radius: 90 },
    { center: { x: 100, y: 100 }, radius: 40 },
    { center: { x: 100, y: 100 }, radius: 8 }
  ]);
  const innermost = getInnermostRing(rings);
  assert.equal(innermost.radius, 8);
});

test("walkRings yields depth annotations outer-to-inner", () => {
  const rings = buildRingTree([
    { center: { x: 100, y: 100 }, radius: 90 },
    { center: { x: 100, y: 100 }, radius: 40 },
    { center: { x: 100, y: 100 }, radius: 8 }
  ]);
  const depths = [...walkRings(rings)].map((entry) => entry.depth);
  assert.deepEqual(depths, [0, 1, 2]);
});

function arcStroke(id, centerX, centerY, radius, startDeg, endDeg, steps) {
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const deg = startDeg + (endDeg - startDeg) * (index / steps);
    const radians = (deg * Math.PI) / 180;
    points.push({
      x: centerX + Math.cos(radians) * radius,
      y: centerY + Math.sin(radians) * radius
    });
  }
  return { id, points };
}

test("detectRing emits a rings tree for concentric outer + inner rings", () => {
  const outerRing = arcStroke("outer", 400, 400, 240, 0, 360, 256);
  const innerRing = arcStroke("inner", 400, 400, 100, 0, 360, 160);

  const detected = detectRing([outerRing, innerRing], null, CONFIG);

  assert.equal(detected.found, true);
  assert.ok(Array.isArray(detected.rings));
  assert.equal(detected.rings.length, 1);
  assert.equal(detected.rings[0].children.length, 1);
  // The inner ring should NOT be reported as an unsupported sibling.
  assert.equal(detected.unsupportedMultipleRings.length, 0);
});

test("compiler reports compositionMode: 'nested' when an inner ring is present", () => {
  const outerRing = arcStroke("outer", 400, 400, 240, 0, 360, 256);
  const innerRing = arcStroke("inner", 400, 400, 100, 0, 360, 160);
  // Place a fire sigil inside the inner ring so the compiler has a primary.
  const sigilStem = arcStroke("stem", 400, 400, 1, 0, 360, 8);

  const pipeline = classifyDrawing({
    strokes: [outerRing, innerRing, sigilStem],
    previousRing: null,
    dictionary: realDictionary,
    config: CONFIG
  });

  // Outer ring should be the activation gate and the AST should expose the tree.
  assert.ok(Array.isArray(pipeline.glyphAST.rings));
  assert.equal(pipeline.glyphAST.rings.length, 1);
  assert.equal(pipeline.glyphAST.rings[0].children.length, 1);

  // We may or may not have a recognised primary; the SpellIR must still
  // carry compositionMode and modifierLayers regardless.
  const spellIR = compileSpell({ glyphAST: pipeline.glyphAST, dictionary: realDictionary, config: CONFIG });
  assert.equal(spellIR.compositionMode, "nested");
  assert.equal(spellIR.ringCount, 2);
  assert.ok(Array.isArray(spellIR.modifierLayers));
  assert.equal(spellIR.modifierLayers.length, 2);
});

test("compiler keeps single-ring AST as compositionMode: 'single'", () => {
  const ring = arcStroke("r", 400, 400, 180, 0, 360, 256);

  const pipeline = classifyDrawing({
    strokes: [ring],
    previousRing: null,
    dictionary: realDictionary,
    config: CONFIG
  });
  const spellIR = compileSpell({ glyphAST: pipeline.glyphAST, dictionary: realDictionary, config: CONFIG });

  assert.equal(spellIR.compositionMode, "single");
  assert.equal(spellIR.ringCount, 1);
});

test("AST↔DSL round-trip preserves a synthetic nested-ring tree", () => {
  const ast = {
    rings: [
      {
        id: "outer",
        cx: 100,
        cy: 100,
        r: 90,
        completeness: 1,
        children: [
          { id: "inner", cx: 100, cy: 100, r: 30, completeness: 1, children: [] }
        ]
      }
    ]
  };

  const dsl = astToDsl(ast);
  assert.equal(dsl.primitives.filter((p) => p.type === "Ring").length, 2);
  const rebuilt = dslToAst(dsl);
  assert.ok(ringTreesEqual(ast, rebuilt));
  // roundTrip helper convenience.
  const r2 = roundTrip(ast);
  assert.ok(ringTreesEqual(ast, r2));
});

// Fixture-driven smoke test: ensure each nested fixture loads, the parser
// produces ≥2 rings (when stroke data justifies it), and the AST↔DSL
// round-trip is consistent on the parser output. These fixtures are
// procedurally generated (see INDEX.json `degradation_notice`), so we
// assert structural properties, not exact recognition outcomes.
const fixtures = [
  "memory-erasure_001",
  "sylph-shoes_001",
  "light-reducing_001"
];

for (const name of fixtures) {
  test(`nested fixture survives parse → compile → AST↔DSL round-trip: ${name}`, () => {
    const strokes = loadFixture(name);
    const pipeline = classifyDrawing({
      strokes,
      previousRing: null,
      dictionary: realDictionary,
      config: CONFIG
    });

    // The detector must always emit a rings array, even if empty.
    assert.ok(Array.isArray(pipeline.glyphAST.rings));

    // Round-trip the parser AST through the DSL mapper. We rebuild from DSL
    // and check structural equality on rings.
    const dsl = astToDsl({ rings: pipeline.glyphAST.rings });
    const rebuilt = dslToAst(dsl);
    assert.ok(ringTreesEqual({ rings: pipeline.glyphAST.rings }, rebuilt));
  });
}
