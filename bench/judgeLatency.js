/**
 * Judge latency bench — compares Groq vs SambaNova on the 5 clean fixtures.
 *
 * Measures the user-perceived metrics:
 *   - TTFT (time to first token): wall-clock from request start to the first
 *     SSE delta chunk containing non-empty content.
 *   - Total wall time: request start → final chunk (`[DONE]` / stop reason).
 *   - Completion tokens (from the final usage block when emitted).
 *   - TPS (tokens per second post-TTFT): completion tokens / (total - TTFT).
 *
 * Both providers stream via OpenAI-compatible SSE on the same endpoints used
 * by the Worker proxy — no proxy involved here so this isolates raw provider
 * latency. Run with `npm run bench:judge`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { systemPromptFor } from "../src/parser/llmJudge/prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const sigils = JSON.parse(readFileSync(resolve(REPO, "src/dictionary/sigils.json"), "utf8"));
const signs = JSON.parse(readFileSync(resolve(REPO, "src/dictionary/signs.json"), "utf8"));
const SYSTEM_PROMPT = systemPromptFor("deep", { sigils, signs });

const FIXTURES = [
  { name: "fire", path: "tests/fixtures/glyphs/clean/fire_clean_001.png" },
  { name: "water", path: "tests/fixtures/glyphs/clean/water_clean_001.png" },
  { name: "wind", path: "tests/fixtures/glyphs/clean/wind_directs_air_clean_001.png" },
  { name: "earth", path: "tests/fixtures/glyphs/clean/earth_clean_001.png" },
  { name: "light", path: "tests/fixtures/glyphs/clean/light_clean_001.png" }
];

const PROVIDERS = [
  {
    label: "Groq · llama-4-scout-17b",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_KEY",
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    // Groq doesn't accept response_format=json_object reliably for all VLMs;
    // omit so the bench measures the same call shape the Worker fast-leg uses.
    extraBody: {}
  },
  {
    label: "SambaNova · Llama-4-Maverick-17B",
    url: "https://api.sambanova.ai/v1/chat/completions",
    keyEnv: "SAMBANOVA_KEY",
    model: "Llama-4-Maverick-17B-128E-Instruct",
    extraBody: { response_format: { type: "json_object" } }
  }
];

const TIMEOUT_MS = 60_000;

function imageDataUrl(p) {
  return `data:image/png;base64,${readFileSync(resolve(REPO, p)).toString("base64")}`;
}

async function runStreamed({ url, key, model, extraBody, imageUrl }) {
  const body = {
    model,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Identify this glyph and return strict WHA-DSL JSON." },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ],
    ...extraBody
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const t0 = performance.now();
  let ttftMs = null;
  let totalMs = null;
  let completionTokens = null;
  let promptTokens = null;
  let receivedChars = 0;
  let firstContent = null;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE: events separated by blank lines
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          receivedChars += delta.length;
          if (ttftMs === null) {
            ttftMs = performance.now() - t0;
            firstContent = delta.slice(0, 60);
          }
        }
        if (chunk?.usage?.completion_tokens != null) {
          completionTokens = chunk.usage.completion_tokens;
        }
        if (chunk?.usage?.prompt_tokens != null) {
          promptTokens = chunk.usage.prompt_tokens;
        }
      }
    }
    totalMs = performance.now() - t0;
  } finally {
    clearTimeout(timer);
  }

  // Throughput math:
  //   post-TTFT TPS = completion_tokens / (total - ttft)  — generation-only rate
  //   end-to-end TPS = completion_tokens / total          — UX-relevant rate
  // SambaNova's SSE batches the entire body into one chunk, so post-TTFT
  // TPS divides by a near-zero denominator and explodes (1M+ TPS is bogus).
  // We report both, and let the median in the markdown report use end-to-end.
  const tokensForTps = completionTokens ?? Math.round(receivedChars / 4);
  const generationMs = Math.max(totalMs - (ttftMs ?? 0), 1);
  const postTtftTps = tokensForTps / (generationMs / 1000);
  const endToEndTps = tokensForTps / (totalMs / 1000);
  // Clamp the post-TTFT figure when streaming was essentially one big chunk.
  // < 50ms generation window = effectively non-streamed; not a meaningful rate.
  const streamedRealistically = generationMs >= 50;
  return {
    ttftMs: ttftMs ?? totalMs,
    totalMs,
    completionTokens: completionTokens ?? null,
    promptTokens: promptTokens ?? null,
    receivedChars,
    postTtftTps: streamedRealistically ? postTtftTps : null,
    endToEndTps,
    firstContent
  };
}

function fmt(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

(async () => {
  const results = {};
  for (const provider of PROVIDERS) {
    const key = process.env[provider.keyEnv];
    if (!key) {
      console.log(`[skip] ${provider.label} — ${provider.keyEnv} not set`);
      continue;
    }
    results[provider.label] = [];
    for (const fixture of FIXTURES) {
      const imageUrl = imageDataUrl(fixture.path);
      try {
        const r = await runStreamed({
          url: provider.url,
          key,
          model: provider.model,
          extraBody: provider.extraBody,
          imageUrl
        });
        console.log(
          `[ok]   ${provider.label.padEnd(36)} ${fixture.name.padEnd(6)} ` +
            `TTFT=${fmt(r.ttftMs)}ms  Total=${fmt(r.totalMs)}ms  ` +
            `Tokens=${fmt(r.completionTokens)}  ` +
            `E2E_TPS=${fmt(r.endToEndTps, 1)} ` +
            `gen_TPS=${r.postTtftTps !== null ? fmt(r.postTtftTps, 1) : "batched"}`
        );
        results[provider.label].push({ fixture: fixture.name, ...r });
      } catch (e) {
        console.log(`[err]  ${provider.label} ${fixture.name}: ${e.message.slice(0, 100)}`);
        results[provider.label].push({ fixture: fixture.name, error: e.message });
      }
      // Brief pause to dodge per-minute token-rate limits on Groq.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Markdown comparison table to bench/judgeLatency-report.md
  const lines = [];
  lines.push("# Judge Latency Bench — Groq vs SambaNova");
  lines.push("");
  lines.push(`Captured: ${new Date().toISOString()}`);
  lines.push(`Prompt: deep system (${SYSTEM_PROMPT.length} chars), 5 fixtures, streamed via OpenAI-compatible SSE.`);
  lines.push("");

  for (const provider of PROVIDERS) {
    if (!results[provider.label]) continue;
    lines.push(`## ${provider.label}`);
    lines.push("");
    lines.push("| Fixture | TTFT (ms) | Total (ms) | Prompt tok | Completion tok | E2E TPS | Gen TPS |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const r of results[provider.label]) {
      if (r.error) {
        const reason = r.error.includes("429") ? "rate-limited" : r.error.slice(0, 40);
        lines.push(`| ${r.fixture} | — | — | — | — | — | ${reason} |`);
      } else {
        lines.push(
          `| ${r.fixture} | ${fmt(r.ttftMs)} | ${fmt(r.totalMs)} | ${fmt(r.promptTokens)} | ${fmt(r.completionTokens)} | ${fmt(r.endToEndTps, 1)} | ${r.postTtftTps !== null ? fmt(r.postTtftTps, 1) : "batched"} |`
        );
      }
    }
    const numeric = results[provider.label].filter((r) => !r.error);
    if (numeric.length) {
      const avg = (key) =>
        numeric.reduce((s, r) => s + (r[key] ?? 0), 0) / numeric.length;
      lines.push(
        `| **median** | ${fmt(median(numeric.map((r) => r.ttftMs)))} | ${fmt(
          median(numeric.map((r) => r.totalMs))
        )} | ${fmt(avg("promptTokens"))} | ${fmt(avg("completionTokens"))} | ${fmt(median(numeric.map((r) => r.endToEndTps)), 1)} | ${
          numeric.some((r) => r.postTtftTps !== null)
            ? fmt(median(numeric.filter((r) => r.postTtftTps !== null).map((r) => r.postTtftTps)), 1)
            : "batched"
        } |`
      );
    }
    lines.push("");
  }

  // Head-to-head if both ran
  const labels = Object.keys(results).filter((l) => results[l].filter((r) => !r.error).length > 0);
  if (labels.length === 2) {
    lines.push("## Head-to-head (median across 5 fixtures)");
    lines.push("");
    lines.push("| Metric | " + labels.join(" | ") + " | Faster provider |");
    lines.push("|---|---:|---:|---|");
    for (const metric of ["ttftMs", "totalMs", "endToEndTps"]) {
      const cells = labels.map((l) => {
        const vals = results[l].filter((r) => !r.error).map((r) => r[metric]);
        return median(vals);
      });
      const lowerIsBetter = !metric.includes("Tps");
      const winnerIdx = lowerIsBetter
        ? cells[0] < cells[1] ? 0 : 1
        : cells[0] > cells[1] ? 0 : 1;
      lines.push(
        `| ${metric} | ${fmt(cells[0], metric.includes("Tps") ? 1 : 0)} | ${fmt(
          cells[1],
          metric.includes("Tps") ? 1 : 0
        )} | ${labels[winnerIdx]} |`
      );
    }
    lines.push("");
  }

  const outPath = resolve(REPO, "bench/judgeLatency-report.md");
  writeFileSync(outPath, lines.join("\n"));
  console.log(`\nReport: ${outPath}`);
})();

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
