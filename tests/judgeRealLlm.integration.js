/**
 * M8 — Real-LLM judge E2E integration (opt-in, env-gated).
 *
 * Fires 5 real judge calls (one per primary sigil element) against the
 * SambaNova endpoint defined in `worker/wha-llm-proxy/.dev.vars`. Each
 * response is run through `validateDsl` to catch upstream API drift.
 *
 * This test is NEVER part of `npm test` or `npm run test:integration`. It
 * only runs via `npm run test:integration:llm`, which sources `.dev.vars`
 * to expose `SAMBANOVA_KEY`. When the env var is missing the test self-skips
 * so a fresh checkout without secrets can still pass `npm test`.
 *
 * Endpoint + payload shape are extracted from the SambaNova provider client
 * (`src/parser/llmJudge/providers/sambanova.js`).
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateDsl } from "../src/parser/llmJudge/dslValidator.js";
import { systemPromptFor } from "../src/parser/llmJudge/prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const FIXTURE_DIR = resolve(__dirname, "judge-fixtures");

const SAMBANOVA_KEY = process.env.SAMBANOVA_KEY ?? "";
const SAMBANOVA_URL = process.env.SAMBANOVA_URL ?? "https://api.sambanova.ai/v1/chat/completions";
const MODEL_ID = process.env.SAMBANOVA_MODEL ?? "Llama-4-Maverick-17B-128E-Instruct";
const REQUEST_TIMEOUT_MS = 30_000;

const dictionary = {
  sigils: JSON.parse(readFileSync(resolve(REPO_ROOT, "src/dictionary/sigils.json"), "utf8")),
  signs: JSON.parse(readFileSync(resolve(REPO_ROOT, "src/dictionary/signs.json"), "utf8"))
};

function loadFixture(name) {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), "utf8"));
}

function imageDataUrl(pngPath) {
  const buf = readFileSync(resolve(REPO_ROOT, pngPath));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function callSambanova({ systemPrompt, imageUrl, model }) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Identify this glyph and return strict WHA-DSL JSON." },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ],
    temperature: 0,
    response_format: { type: "json_object" }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(SAMBANOVA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SAMBANOVA_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`SambaNova HTTP ${resp.status}: ${text.slice(0, 400)}`);
    }
    const payload = await resp.json();
    return payload?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract the first JSON object from a markdown-fenced reply.
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try {
        return JSON.parse(fence[1]);
      } catch {
        // fall through
      }
    }
    return null;
  }
}

const skip = !SAMBANOVA_KEY;

if (skip) {
  test("judgeRealLlm integration skipped: SAMBANOVA_KEY not set", () => {
    // Self-skipping no-op so a developer running this file without secrets
    // sees an explicit reason rather than a missing test.
  });
} else {
  const fixtureNames = [
    "fire_clean_001.json",
    "water_clean_001.json",
    "wind_directs_air_clean_001.json",
    "earth_clean_001.json",
    "light_clean_001.json"
  ];

  for (const name of fixtureNames) {
    test(`SambaNova real judge: ${name} returns schema-valid WHA-DSL`, async () => {
      const fixture = loadFixture(name);
      const pngPath = resolve(REPO_ROOT, fixture.image.path);
      if (!existsSync(pngPath)) {
        // M0 corpus missing — bail out softly so the suite stays useful in
        // partial checkouts.
        return;
      }
      const systemPrompt = systemPromptFor(fixture.prompt.id, dictionary);
      const text = await callSambanova({
        systemPrompt,
        imageUrl: imageDataUrl(fixture.image.path),
        model: fixture.model.id ?? MODEL_ID
      });
      assert.ok(text && typeof text === "string", "empty completion content");
      const parsed = safeParseJson(text);
      assert.ok(parsed, `model did not return parseable JSON: ${text.slice(0, 200)}`);
      const validated = validateDsl(parsed);
      if (!validated.ok) {
        throw new assert.AssertionError({
          message: `real judge response failed strict WHA-DSL validation: ${JSON.stringify(validated.errors ?? []).slice(0, 400)}`,
          actual: validated,
          expected: { ok: true },
          operator: "validateDsl"
        });
      }
    });
  }
}
