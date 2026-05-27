/**
 * Baseline regression fixture for the line-quality formula (M5).
 *
 * Principle 5: magic numbers get sensitivity tests BEFORE they change. This
 * module captures the *pre-edit* output of:
 *   - `calculateSpellQuality(glyphAST)`
 *   - `calculateSpellStability(glyphAST, config)`
 *   - `compileSpell({ glyphAST, config }).{ quality, stability, duration, neatness }`
 * for every M0 stroke fixture, then snapshots them to a JSON file under
 * `tests/__baselines__/spellQuality.v0.json`.
 *
 * Workflow:
 *   1. Before any edit to `spellQuality.js` or `spellBuilder.js`, run:
 *        `node tests/spellQualityBaseline.fixture.js --write`
 *      which writes the JSON.
 *   2. The companion test `tests/spellQuality.regression.test.js` re-runs the
 *      same computation against current code and asserts equality to the
 *      JSON within ±1e-6. With pre-edit code that test passes.
 *   3. After edits, the legacy fields (`quality`, `stability`, `duration`,
 *      `neatness`) MUST continue to match — they are preserved by the M5
 *      change spec for backward compatibility. New fields (`cleanliness`,
 *      `length`, `closurePrecision`, `symmetry`) are added separately and
 *      checked by `tests/spellQuality.test.js`.
 *
 * The fixture corpus is M0's procedural set; AC-P1 measurement happens on
 * `split: 'test'` only via `bench/recognize.js`. Here we use ALL fixtures so
 * the baseline covers the widest behavioural surface.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { CONFIG } from "../src/config.js";
import { classifyDrawing } from "../src/parser/drawingClassifier.js";
import { compileSpell } from "../src/compiler/spellBuilder.js";
import { calculateSpellQuality, calculateSpellStability } from "../src/compiler/spellQuality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_ROOT = resolve(__dirname, "fixtures/glyphs");
const BASELINE_PATH = resolve(__dirname, "__baselines__/spellQuality.v0.json");

const realDictionary = {
  sigils: JSON.parse(readFileSync(resolve(__dirname, "../src/dictionary/sigils.json"), "utf8")),
  signs: JSON.parse(readFileSync(resolve(__dirname, "../src/dictionary/signs.json"), "utf8"))
};

function loadIndex() {
  return JSON.parse(readFileSync(resolve(FIXTURE_ROOT, "INDEX.json"), "utf8"));
}

export function loadFixtureStrokes(strokesPath) {
  const raw = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, strokesPath), "utf8"));
  // The fixture stores points as `[x, y, t, pressure?]` tuples; the parser
  // pipeline expects `{ x, y }` objects.
  return raw.strokes.map((stroke) => ({
    id: stroke.id,
    points: stroke.points.map(([x, y]) => ({ x, y }))
  }));
}

function round(value, digits = 6) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return Number(value.toFixed(digits));
}

/**
 * Compute the baseline payload for one fixture entry. The payload is the
 * *legacy* quality/stability scalars plus four spell-IR scalars that the M5
 * formula change must not regress (they are preserved for back-compat).
 */
export function computeBaselineFor(entry) {
  const strokes = loadFixtureStrokes(entry.strokes_path);
  const pipeline = classifyDrawing({
    strokes,
    previousRing: null,
    dictionary: realDictionary,
    config: CONFIG
  });
  const ast = pipeline.glyphAST;
  const ir = compileSpell({ glyphAST: ast, dictionary: realDictionary, config: CONFIG });

  return {
    path: entry.path,
    legacyQuality: round(calculateSpellQuality(ast)),
    legacyStability: round(calculateSpellStability(ast, CONFIG)),
    irQuality: round(ir.quality),
    irStability: round(ir.stability),
    irDuration: round(ir.duration),
    irNeatness: round(ir.neatness)
  };
}

export function computeBaselineAll() {
  const index = loadIndex();
  return index.fixtures.map((entry) => computeBaselineFor(entry));
}

function writeBaseline() {
  const records = computeBaselineAll();
  if (!existsSync(dirname(BASELINE_PATH))) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  }
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        notice:
          "Pre-edit (M5) baseline of legacy spellQuality + spellBuilder scalars. The legacy fields are preserved by M5; new qualityMetrics live alongside. Update this file ONLY when you intentionally change the legacy formula and have a sensitivity report to justify it.",
        records
      },
      null,
      2
    ) + "\n"
  );
  return records.length;
}

// Allow invocation as a script: `node tests/spellQualityBaseline.fixture.js --write`.
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    const count = writeBaseline();
    process.stdout.write(`spellQualityBaseline: wrote ${count} records → ${BASELINE_PATH}\n`);
  } else {
    process.stdout.write("Usage: node tests/spellQualityBaseline.fixture.js --write\n");
  }
}

export { BASELINE_PATH };
