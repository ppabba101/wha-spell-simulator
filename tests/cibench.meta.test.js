/**
 * M8 — CI bench gate meta-test.
 *
 * Proves the recognition gate at `bench/recognize.js` actually fires when
 * accuracy degrades: we build a temporary fixture index where every
 * ground-truth label is mutated, point the bench at it via `--index`, and
 * assert the bench exits non-zero under a strict threshold.
 *
 * Without this test the bench could silently regress to 0% accuracy and
 * still "pass" if someone weakened the threshold by mistake. The meta-test
 * pins the contract: under a 0.5 threshold, mutated labels MUST fail.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "..");
const BENCH_SCRIPT = resolve(REPO_ROOT, "bench/recognize.js");
const ORIGINAL_INDEX = resolve(REPO_ROOT, "tests/fixtures/glyphs/INDEX.json");

function copyFixtureFiles(entry, srcRoot, dstRoot) {
  for (const rel of [entry.strokes_path, entry.path]) {
    if (!rel) continue;
    const src = resolve(srcRoot, rel);
    const dst = resolve(dstRoot, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
}

function buildMutatedIndex({ mutateGroundTruth }) {
  const index = JSON.parse(readFileSync(ORIGINAL_INDEX, "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "wha-bench-meta-"));
  const fixturesDir = join(tmp, "fixtures");
  mkdirSync(fixturesDir, { recursive: true });

  for (const entry of index.fixtures) {
    copyFixtureFiles(entry, dirname(ORIGINAL_INDEX), fixturesDir);
  }
  const mutated = {
    ...index,
    fixtures: index.fixtures.map((entry) => ({
      ...entry,
      ground_truth: mutateGroundTruth(entry)
    }))
  };
  const indexPath = join(fixturesDir, "INDEX.json");
  writeFileSync(indexPath, JSON.stringify(mutated, null, 2));
  return { tmp, indexPath };
}

function runBench(indexPath, env = {}) {
  const result = spawnSync(
    process.execPath,
    [BENCH_SCRIPT, "--index", indexPath],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 60_000
    }
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

test("bench:recognize gate fails when ground-truth labels are mutated", () => {
  const { tmp, indexPath } = buildMutatedIndex({
    mutateGroundTruth: (entry) => {
      // Flip every label to something that cannot match: empty glyph + an
      // obviously-wrong sign. With a 0.5 threshold the bench MUST exit
      // non-zero because accuracy will be 0 % against these mutated labels.
      return {
        ...entry.ground_truth,
        glyph: "__mutated_glyph_should_never_match__",
        signs: ["__mutated_sign_should_never_match__"]
      };
    }
  });

  try {
    const { status, stdout, stderr } = runBench(indexPath, { WHA_BENCH_THRESHOLD: "0.5" });
    assert.notEqual(
      status,
      0,
      `bench should exit non-zero on mutated labels with threshold=0.5. stdout=${stdout}\nstderr=${stderr}`
    );
    assert.ok(
      stdout.includes("FAIL") || stdout.includes("Result: FAIL"),
      `bench output should report FAIL. Got: ${stdout.slice(-400)}`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("bench:recognize gate passes on the real fixture index at the documented baseline", () => {
  // Sanity: with the default (degradation-aware) threshold, the production
  // fixture index must still pass. This guards against a future change to
  // the bench that flips its baseline pass condition.
  const { status, stdout } = runBench(ORIGINAL_INDEX);
  assert.equal(
    status,
    0,
    `bench should pass on the real fixture index at the documented baseline. stdout tail=${stdout.slice(-600)}`
  );
});
