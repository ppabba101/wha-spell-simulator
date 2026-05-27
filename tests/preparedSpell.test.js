import assert from "node:assert/strict";
import test from "node:test";

import {
  STORAGE_KEY,
  appendPreparedSpell,
  buildPreparedEntry,
  loadPreparedSpells,
  removePreparedSpell,
  ringGapPosition,
  savePreparedSpells,
  strokesForFiring,
  synthesiseClosingDot
} from "../src/ui/preparedSpells.js";

/** Tiny localStorage stub for tests. */
function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    _inspect() {
      return Object.fromEntries(store);
    }
  };
}

const samplePipeline = {
  ring: {
    found: true,
    complete: false,
    completeness: 0.82,
    center: { x: 400, y: 300 },
    radius: 180,
    gap: { startAngle: 350, endAngle: 380, sizeDegrees: 30 }
  },
  glyphAST: {
    type: "GlyphAST",
    ring: {
      found: true,
      complete: false,
      completeness: 0.82,
      center: { x: 400, y: 300 },
      radius: 180,
      gap: { startAngle: 350, endAngle: 380, sizeDegrees: 30 }
    },
    rings: [],
    primarySigil: { id: "fire", element: "fire", confidence: 0.91 },
    signs: [],
    unknowns: [],
    globalMetrics: { neatness: 0.78 },
    warnings: []
  }
};

test("ringGapPosition returns null when ring is closed or missing", () => {
  assert.equal(ringGapPosition(null), null);
  assert.equal(ringGapPosition({ found: true, complete: true }), null);
  assert.equal(ringGapPosition({ found: false }), null);
});

test("ringGapPosition resolves to the gap-arc midpoint in canvas pixels", () => {
  const gapPos = ringGapPosition(samplePipeline.ring);
  assert.ok(gapPos);
  assert.equal(typeof gapPos.x, "number");
  assert.equal(typeof gapPos.y, "number");
  assert.equal(typeof gapPos.arcMidpointDeg, "number");
});

test("buildPreparedEntry throws when the ring is missing or closed", () => {
  assert.throws(() =>
    buildPreparedEntry({
      pipeline: { ring: { found: true, complete: true }, glyphAST: { ring: { complete: true } } },
      strokes: []
    })
  );
});

test("buildPreparedEntry produces a saveable record from an open-ring pipeline", () => {
  const entry = buildPreparedEntry({
    pipeline: samplePipeline,
    strokes: [{ id: "s1", points: [{ x: 0, y: 0 }] }],
    name: "My Prep"
  });
  assert.equal(entry.name, "My Prep");
  assert.equal(typeof entry.id, "string");
  assert.ok(entry.glyphAst);
  assert.ok(entry.ringGapPosition);
  assert.ok(Array.isArray(entry.strokes));
  assert.equal(entry.strokes.length, 1);
});

test("save → reload → fire produces a SpellIR-equivalent input stroke set", () => {
  const storage = makeStorage();
  const entry = buildPreparedEntry({
    pipeline: samplePipeline,
    strokes: [{ id: "s1", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]
  });
  appendPreparedSpell(entry, storage);

  // Reload from storage as if the page had refreshed.
  const reloaded = loadPreparedSpells(storage);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, entry.id);
  assert.equal(reloaded[0].name, entry.name);
  assert.deepEqual(reloaded[0].strokes, entry.strokes);

  // Synthesise the closing dot — it must produce a non-empty stroke.
  const closingDot = synthesiseClosingDot(reloaded[0]);
  assert.ok(closingDot);
  assert.ok(closingDot.points.length >= 1);

  // strokesForFiring composes the saved strokes + closing dot.
  const fired = strokesForFiring(reloaded[0]);
  assert.equal(fired.length, entry.strokes.length + 1);
  // The last stroke (the closing dot) sits at the gap arc midpoint.
  const last = fired[fired.length - 1];
  const gap = entry.ringGapPosition;
  assert.ok(Math.abs(last.points[0].x - gap.x) < 5);
  assert.ok(Math.abs(last.points[0].y - gap.y) < 5);
});

test("removePreparedSpell filters by id and persists", () => {
  const storage = makeStorage();
  const a = buildPreparedEntry({ pipeline: samplePipeline, strokes: [], name: "A" });
  const b = buildPreparedEntry({ pipeline: samplePipeline, strokes: [], name: "B" });
  savePreparedSpells([a, b], storage);

  removePreparedSpell(a.id, storage);
  const remaining = loadPreparedSpells(storage);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].name, "B");
});

test("loadPreparedSpells tolerates missing / malformed storage", () => {
  assert.deepEqual(loadPreparedSpells(null), []);
  const bogus = makeStorage({ [STORAGE_KEY]: "not json" });
  assert.deepEqual(loadPreparedSpells(bogus), []);
});
