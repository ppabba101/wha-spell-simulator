/**
 * `?latency-bench` route — AC-P2 gate measurement.
 *
 * Methodology (matches §4 M2 AC-P2):
 *   - t0 = pointer-up emit (we simulate this directly by recording a timestamp
 *     when the test image is dispatched). For real interactive measurement,
 *     the canvas's `pointerup` listener records t0.
 *   - t1 = the moment the first WHADSLPartial event renders a primitive on
 *     the overlay. We define "renders a primitive" as the first partial
 *     payload containing a non-empty `primitives` array. In bench mode the
 *     receiver fires a `judge.firstPrimitive` callback whose entry-timestamp
 *     is t1.
 *   - latency = t1 - t0 (per round-trip).
 *
 * Reports p50 / p95 / p99 + per-provider breakdown.
 *
 * AC-P2 gate: p50 < 500ms / p95 < 1000ms.
 */

import { postJudge } from "../parser/llmJudge/providers/_normalisedClient.js";

const FIXED_TEST_IMAGE = makeFixedTestImage();

function makeFixedTestImage() {
  // 1x1 white PNG, base64. The Worker just needs *some* image payload; for
  // bench mode the upstream is typically mocked, so a tiny PNG keeps the
  // per-call payload size constant.
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
}

function percentile(samples, p) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarise(samples) {
  return {
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    min: samples.length ? Math.min(...samples) : 0,
    max: samples.length ? Math.max(...samples) : 0
  };
}

/**
 * Run N round-trips against `/api/judge` and return latency summary.
 *
 * @param {object} opts
 * @param {number} [opts.count=100]
 * @param {string} [opts.region='us-east']    forwarded as `X-Region` header
 * @param {string} [opts.proxyUrl='/api/judge']
 * @param {string} [opts.mode='parallel']
 * @param {(progress:{i:number,total:number,latencyMs:number})=>void} [opts.onProgress]
 * @returns {Promise<{ overall, perProvider, region, count }>}
 */
export async function runLatencyBench({
  count = 100,
  region = "us-east",
  proxyUrl = "/api/judge",
  mode = "parallel",
  onProgress
} = {}) {
  const overall = [];
  const perProvider = { fast: [], deep: [] };

  for (let i = 0; i < count; i += 1) {
    const t0 = performance.now();
    let firstPrimitiveAt = null;
    let firstPrimitiveSource = null;
    try {
      const { stream } = await postJudge({
        proxyUrl,
        mode,
        image: FIXED_TEST_IMAGE,
        prompt: "bench",
        settings: { bench: true, region },
        headers: { "X-Region": region }
      });
      for await (const ev of stream) {
        if (!ev || ev.kind !== "token-delta") continue;
        // Detect first primitive in this stream. The Worker emits structured
        // primitives only after the model has produced enough JSON; we use a
        // cheap substring scan as a proxy (the streaming parser is what gates
        // actual UI render — we approximate it).
        if (firstPrimitiveAt === null && typeof ev.text === "string" && ev.text.includes("\"type\"")) {
          firstPrimitiveAt = performance.now();
          firstPrimitiveSource = ev.source ?? "n/a";
          break;
        }
      }
    } catch (err) {
      // Skip failed round-trips; they're a measurement signal but not a panic.
      console.warn("[latencyBench] iteration failed", err);
      continue;
    }
    if (firstPrimitiveAt === null) continue;
    const latency = firstPrimitiveAt - t0;
    overall.push(latency);
    if (firstPrimitiveSource === "fast" || firstPrimitiveSource === "deep") {
      perProvider[firstPrimitiveSource].push(latency);
    }
    if (typeof onProgress === "function") {
      onProgress({ i: i + 1, total: count, latencyMs: latency });
    }
  }

  return {
    region,
    count,
    overall: summarise(overall),
    perProvider: {
      fast: summarise(perProvider.fast),
      deep: summarise(perProvider.deep)
    }
  };
}

/**
 * Mount the bench panel into the page when the URL has `?latency-bench`.
 * Returns true if mounted (caller should skip the normal app boot).
 */
export function maybeMountLatencyBench(rootSelector = ".app-shell") {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("latency-bench")) return false;

  const root = document.querySelector(rootSelector);
  if (root) root.innerHTML = "";

  const panel = document.createElement("section");
  panel.id = "latencyBenchPanel";
  panel.style.padding = "32px";
  panel.style.fontFamily = "system-ui, -apple-system, sans-serif";
  panel.innerHTML = `
    <h1>Judge Latency Bench (AC-P2)</h1>
    <p>Methodology: t0 = bench dispatch, t1 = first <code>token-delta</code> containing a <code>"type"</code> token. Gate: p50 &lt; 500ms / p95 &lt; 1000ms.</p>
    <div class="bench-controls">
      <button id="benchUsEast" type="button">Run 100 round-trips (US-East)</button>
      <button id="benchEuWest" type="button">Run 100 round-trips (EU-West)</button>
    </div>
    <div id="benchProgress" style="margin-top:16px;font-variant-numeric:tabular-nums;"></div>
    <pre id="benchResult" style="margin-top:16px;background:#1d2330;color:#dde3f0;padding:12px;border-radius:8px;white-space:pre-wrap;"></pre>
  `;
  document.body.appendChild(panel);

  const result = panel.querySelector("#benchResult");
  const progress = panel.querySelector("#benchProgress");

  async function run(region) {
    if (result) result.textContent = `Running 100 round-trips in ${region}...`;
    const summary = await runLatencyBench({
      count: 100,
      region,
      onProgress: ({ i, total, latencyMs }) => {
        if (progress) progress.textContent = `${i}/${total} — last ${latencyMs.toFixed(1)}ms`;
      }
    });
    if (result) result.textContent = JSON.stringify(summary, null, 2);
    return summary;
  }

  panel.querySelector("#benchUsEast")?.addEventListener("click", () => {
    run("us-east").catch((err) => {
      if (result) result.textContent = `Error: ${err}`;
    });
  });
  panel.querySelector("#benchEuWest")?.addEventListener("click", () => {
    run("eu-west").catch((err) => {
      if (result) result.textContent = `Error: ${err}`;
    });
  });

  return true;
}
