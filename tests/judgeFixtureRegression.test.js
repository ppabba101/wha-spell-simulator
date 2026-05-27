/**
 * M8 — Judge fixture regression test.
 *
 * Pinned (image, prompt, model) → expected-DSL tuples live under
 * `tests/judge-fixtures/`. Each fixture pins:
 *   - image bytes (referenced by path + SHA-256 for integrity)
 *   - assembled system prompt (referenced by id + SHA-256)
 *   - model id
 *   - the ideal WHA-DSL JSON the judge SHOULD return
 *
 * This test does NOT call a live LLM. It runs the pinned `expected` payload
 * through `validateDsl` so any drift in the WHA-DSL schema breaks the test,
 * and verifies the on-disk image still hashes to the pinned digest so an
 * accidental fixture rewrite is caught.
 *
 * Real-LLM coverage lives in `tests/judgeRealLlm.integration.js`, env-gated
 * by `SAMBANOVA_KEY` so it never runs by default.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";

import { validateDsl } from "../src/parser/llmJudge/dslValidator.js";
import { systemPromptFor } from "../src/parser/llmJudge/prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "..");
const FIXTURE_DIR = resolve(__dirname, "judge-fixtures");

const dictionary = {
  sigils: JSON.parse(readFileSync(resolve(REPO_ROOT, "src/dictionary/sigils.json"), "utf8")),
  signs: JSON.parse(readFileSync(resolve(REPO_ROOT, "src/dictionary/signs.json"), "utf8"))
};

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function loadFixtures() {
  const files = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.map((name) => ({
    name,
    fixture: JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), "utf8"))
  }));
}

const fixtures = loadFixtures();

test("M8 judge fixtures: at least one per primary sigil element", () => {
  const required = new Set(["fire", "water", "wind", "earth", "light"]);
  const seen = new Set(fixtures.map((f) => f.fixture.element));
  for (const el of required) {
    assert.ok(seen.has(el), `missing judge fixture for element=${el}`);
  }
});

for (const { name, fixture } of fixtures) {
  test(`judge fixture ${name}: expected payload validates against WHA-DSL`, () => {
    const result = validateDsl(fixture.expected);
    assert.ok(
      result.ok,
      `expected payload failed schema validation: ${JSON.stringify(result.errors)}`
    );
    // Guess must reference a supported glyphId; element field cross-checks it.
    assert.equal(
      fixture.expected.guess.glyphId === fixture.element ||
        (fixture.element === "wind" && fixture.expected.guess.glyphId === "wind"),
      true,
      `guess.glyphId (${fixture.expected.guess.glyphId}) does not match fixture element (${fixture.element})`
    );
  });

  test(`judge fixture ${name}: pinned image bytes match recorded sha256`, () => {
    const imagePath = resolve(REPO_ROOT, fixture.image.path);
    if (!existsSync(imagePath)) {
      // Allow PNG to be absent in CI environments that skip the M0 corpus;
      // the DSL validation above is still meaningful.
      return;
    }
    const actual = sha256Hex(readFileSync(imagePath));
    assert.equal(
      actual,
      fixture.image.sha256,
      `image hash drift for ${fixture.image.path}: recorded=${fixture.image.sha256} actual=${actual}`
    );
  });

  test(`judge fixture ${name}: pinned prompt sha256 matches assembled prompt`, () => {
    const promptText = systemPromptFor(fixture.prompt.id, dictionary);
    const actual = sha256Hex(promptText);
    assert.equal(
      actual,
      fixture.prompt.sha256,
      `prompt hash drift for ${fixture.prompt.id}: recorded=${fixture.prompt.sha256} actual=${actual}\n` +
        "Update the fixture's prompt.sha256 ONLY when you intentionally change the prompt and have re-pinned the expected DSL accordingly."
    );
  });
}

test("mocked judge: canned response per fixture validates end-to-end", () => {
  // Simulates the in-app judge orchestrator: returns the pinned `expected`
  // payload exactly as the LLM is supposed to, then runs it through the
  // strict validator before any downstream consumer sees it.
  function mockedJudge(fixture) {
    return Promise.resolve(fixture.expected);
  }

  return Promise.all(
    fixtures.map(async ({ name, fixture }) => {
      const response = await mockedJudge(fixture);
      const validated = validateDsl(response);
      assert.ok(validated.ok, `mocked judge response failed validation for ${name}`);
      assert.equal(validated.value, response);
    })
  );
});
