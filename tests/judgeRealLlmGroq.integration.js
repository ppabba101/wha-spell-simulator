/**
 * M8 — Real-LLM judge E2E integration for Groq (opt-in, env-gated).
 *
 * Mirrors `judgeRealLlm.integration.js` (SambaNova) but targets the Groq
 * `meta-llama/llama-4-scout-17b-16e-instruct` VLM. The same fixtures and
 * the same WHA-DSL schema validation; only the provider endpoint, model,
 * and key differ.
 *
 * Gated by `GROQ_KEY` — self-skips when unset so a fresh checkout without
 * secrets still passes `npm test`. Run via `npm run test:integration:llm:groq`,
 * which sources `worker/wha-llm-proxy/.dev.vars`.
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

const GROQ_KEY = process.env.GROQ_KEY ?? "";
const GROQ_URL = process.env.GROQ_URL ?? "https://api.groq.com/openai/v1/chat/completions";
const MODEL_ID = process.env.GROQ_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";
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

async function callGroq({ systemPrompt, imageUrl, model }) {
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
    const resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Groq HTTP ${resp.status}: ${text.slice(0, 400)}`);
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

const skip = !GROQ_KEY;

if (skip) {
  test("judgeRealLlmGroq integration skipped: GROQ_KEY not set", () => {
    // Self-skipping no-op so a developer running without secrets sees an
    // explicit reason rather than a missing test.
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
    test(`Groq real judge: ${name} returns schema-valid WHA-DSL`, async () => {
      const fixture = loadFixture(name);
      const pngPath = resolve(REPO_ROOT, fixture.image.path);
      if (!existsSync(pngPath)) {
        return;
      }
      const systemPrompt = systemPromptFor(fixture.prompt.id, dictionary);
      const text = await callGroq({
        systemPrompt,
        imageUrl: imageDataUrl(fixture.image.path),
        model: MODEL_ID
      });
      assert.ok(text && typeof text === "string", "empty completion content");
      const parsed = safeParseJson(text);
      assert.ok(parsed, `model did not return parseable JSON: ${text.slice(0, 200)}`);
      const validated = validateDsl(parsed);
      if (!validated.ok) {
        throw new assert.AssertionError({
          message: `Groq judge response failed strict WHA-DSL validation: ${JSON.stringify(validated.errors ?? []).slice(0, 400)}`,
          actual: validated,
          expected: { ok: true },
          operator: "validateDsl"
        });
      }
    });
  }
}
