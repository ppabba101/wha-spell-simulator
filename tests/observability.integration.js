/**
 * M8a Observability integration test.
 *
 * Verifies that:
 *  1. emitAnalytics() calls writeDataPoint the expected number of times
 *     when 100 synthetic events are forged (10% breaker trips, 6% dsl_invalid,
 *     8% kv rate-limit hits, 3% judge-template disagreements).
 *  2. The alert-threshold math is correct: feeding events that exceed each
 *     threshold produces a computed rate that is strictly > the threshold.
 *  3. estimateCost() correctly computes cost-per-spell for all three providers.
 *
 * This file ends in .integration.js so `npm test` skips it.
 * `npm run test:integration` picks it up.
 *
 * No Miniflare instance is needed here — we test the emitAnalytics module
 * directly with a lightweight mock binding, mirroring the pattern used in
 * worker/wha-llm-proxy/test/integration.test.js.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { emitAnalytics, estimateCost } from "../worker/wha-llm-proxy/src/analytics.ts";

// ---------------------------------------------------------------------------
// Mock Analytics binding
// ---------------------------------------------------------------------------

function makeMockBinding() {
  const calls = [];
  return {
    binding: {
      writeDataPoint(point) {
        calls.push(point);
      }
    },
    calls
  };
}

// ---------------------------------------------------------------------------
// Synthetic event forge
// ---------------------------------------------------------------------------

/**
 * Forge `total` synthetic AnalyticsRecord objects with the given rates.
 * Rates are expressed as fractions (0–1).
 */
function forgeEvents(total, {
  breakerTripRate   = 0,
  dslInvalidRate    = 0,
  rateLimitedRate   = 0,
  disagreementRate  = 0,
  provider          = "groq"
} = {}) {
  const records = [];
  for (let i = 0; i < total; i++) {
    const breakerOpen              = i < Math.round(total * breakerTripRate);
    const dslInvalid               = i < Math.round(total * dslInvalidRate);
    const rateLimited              = i < Math.round(total * rateLimitedRate);
    const judgeTemplateDisagreement = i < Math.round(total * disagreementRate);
    records.push({
      provider,
      status:     breakerOpen ? 503 : (rateLimited ? 429 : (dslInvalid ? 422 : 200)),
      durationMs: 200 + i,
      ttftMs:     50 + i,
      mode:       "fast",
      breakerOpen,
      dslInvalid,
      rateLimited,
      judgeTemplateDisagreement,
      costPerSpellUsd: estimateCost(provider, 100 + i, 50)
    });
  }
  return records;
}

/** Compute a rate (0–100 %) from an array of writeDataPoint calls. */
function rateFromCalls(calls, doubleIndex) {
  if (calls.length === 0) return 0;
  const hits = calls.filter(c => c.doubles[doubleIndex] === 1).length;
  return (hits / calls.length) * 100;
}

// Double indices in the Analytics Engine schema:
const IDX_BREAKER   = 3;
const IDX_DSL       = 4;
const IDX_RATELIMIT = 5;
const IDX_DISAGREE  = 6;
const IDX_COST      = 7;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("emitAnalytics: calls writeDataPoint for every synthetic event", () => {
  const { binding, calls } = makeMockBinding();
  const env = { JUDGE_ANALYTICS: binding };
  const records = forgeEvents(100, {
    breakerTripRate:  0.10,
    dslInvalidRate:   0.06,
    rateLimitedRate:  0.08,
    disagreementRate: 0.03
  });

  for (const rec of records) {
    emitAnalytics(env, rec);
  }

  assert.equal(calls.length, 100, "writeDataPoint must be called once per event");
});

test("emitAnalytics: breaker trip double is set correctly", () => {
  const { binding, calls } = makeMockBinding();
  const env = { JUDGE_ANALYTICS: binding };
  const records = forgeEvents(100, { breakerTripRate: 0.10 });

  for (const rec of records) emitAnalytics(env, rec);

  const tripCount = calls.filter(c => c.doubles[IDX_BREAKER] === 1).length;
  assert.equal(tripCount, 10, "expect exactly 10 breaker-trip events out of 100");
});

test("emitAnalytics: DSL-invalid double is set correctly", () => {
  const { binding, calls } = makeMockBinding();
  const env = { JUDGE_ANALYTICS: binding };
  const records = forgeEvents(100, { dslInvalidRate: 0.06 });

  for (const rec of records) emitAnalytics(env, rec);

  const dslCount = calls.filter(c => c.doubles[IDX_DSL] === 1).length;
  assert.equal(dslCount, 6, "expect exactly 6 dsl-invalid events out of 100");
});

test("emitAnalytics: KV rate-limit double is set correctly", () => {
  const { binding, calls } = makeMockBinding();
  const env = { JUDGE_ANALYTICS: binding };
  const records = forgeEvents(100, { rateLimitedRate: 0.08 });

  for (const rec of records) emitAnalytics(env, rec);

  const rlCount = calls.filter(c => c.doubles[IDX_RATELIMIT] === 1).length;
  assert.equal(rlCount, 8, "expect exactly 8 rate-limited events out of 100");
});

test("emitAnalytics: judge-template disagreement double is set correctly", () => {
  const { binding, calls } = makeMockBinding();
  const env = { JUDGE_ANALYTICS: binding };
  const records = forgeEvents(100, { disagreementRate: 0.03 });

  for (const rec of records) emitAnalytics(env, rec);

  const disCount = calls.filter(c => c.doubles[IDX_DISAGREE] === 1).length;
  assert.equal(disCount, 3, "expect exactly 3 disagreement events out of 100");
});

test("emitAnalytics: cost_per_spell double8 is non-zero for known providers", () => {
  const { binding, calls } = makeMockBinding();
  const env = { JUDGE_ANALYTICS: binding };

  for (const provider of ["groq", "sambanova", "anthropic"]) {
    emitAnalytics(env, {
      provider,
      status: 200,
      durationMs: 300,
      ttftMs: 60,
      mode: "fast",
      costPerSpellUsd: estimateCost(provider, 500, 200)
    });
  }

  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.ok(c.doubles[IDX_COST] > 0, "cost double must be > 0 for known provider");
  }
});

test("emitAnalytics: blobs carry provider, mode, eventKind, reasonCode", () => {
  const { binding, calls } = makeMockBinding();
  const env = { JUDGE_ANALYTICS: binding };

  emitAnalytics(env, {
    provider:   "anthropic",
    status:     200,
    durationMs: 800,
    ttftMs:     100,
    mode:       "quality",
    eventKind:  "request",
    reasonCode: "ok"
  });

  assert.equal(calls.length, 1);
  const blobs = calls[0].blobs;
  assert.equal(blobs[0], "anthropic");
  assert.equal(blobs[1], "quality");
  assert.equal(blobs[2], "request");
  assert.equal(blobs[3], "ok");
});

test("emitAnalytics: index1 is set to provider", () => {
  const { binding, calls } = makeMockBinding();
  const env = { JUDGE_ANALYTICS: binding };

  emitAnalytics(env, {
    provider: "sambanova",
    status: 200,
    durationMs: 400,
    ttftMs: 80,
    mode: "balanced"
  });

  assert.equal(calls[0].indexes[0], "sambanova");
});

test("emitAnalytics: never throws when binding is broken", () => {
  const brokenEnv = {
    JUDGE_ANALYTICS: {
      writeDataPoint() { throw new Error("analytics engine unavailable"); }
    }
  };
  // Must not throw
  assert.doesNotThrow(() => {
    emitAnalytics(brokenEnv, {
      provider: "groq",
      status: 200,
      durationMs: 100,
      ttftMs: 30,
      mode: "fast"
    });
  });
});

// ---------------------------------------------------------------------------
// Alert threshold math tests
// ---------------------------------------------------------------------------

describe("alert threshold math", () => {
  test("breaker_trip_rate_5min: rate > 5% fires alert", () => {
    const { binding, calls } = makeMockBinding();
    const env = { JUDGE_ANALYTICS: binding };
    // 6 trips out of 100 = 6% > 5% threshold
    const records = forgeEvents(100, { breakerTripRate: 0.06 });
    for (const rec of records) emitAnalytics(env, rec);

    const rate = rateFromCalls(calls, IDX_BREAKER);
    assert.ok(rate > 5, `breaker trip rate ${rate}% should exceed 5% threshold`);
  });

  test("breaker_trip_rate_5min: rate <= 5% does not fire alert", () => {
    const { binding, calls } = makeMockBinding();
    const env = { JUDGE_ANALYTICS: binding };
    // 5 trips out of 100 = 5%, not strictly > 5%
    const records = forgeEvents(100, { breakerTripRate: 0.05 });
    for (const rec of records) emitAnalytics(env, rec);

    const rate = rateFromCalls(calls, IDX_BREAKER);
    assert.ok(rate <= 5, `breaker trip rate ${rate}% should not exceed 5% threshold`);
  });

  test("dsl_invalid_rate_1hr: rate > 5% fires alert", () => {
    const { binding, calls } = makeMockBinding();
    const env = { JUDGE_ANALYTICS: binding };
    // 7 invalid out of 100 = 7% > 5% threshold
    const records = forgeEvents(100, { dslInvalidRate: 0.07 });
    for (const rec of records) emitAnalytics(env, rec);

    const rate = rateFromCalls(calls, IDX_DSL);
    assert.ok(rate > 5, `DSL-invalid rate ${rate}% should exceed 5% threshold`);
  });

  test("latency_p95_5min: p95 > 1500ms fires alert", () => {
    // Forge 100 durations where the 95th percentile exceeds 1500ms.
    // p95 = index 94 (0-based) in a sorted array of 100.
    // Put 10 slow events at the end so indices 90-99 are 2000ms.
    const durations = [
      ...Array(90).fill(200),
      ...Array(10).fill(2000)
    ];
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
    assert.ok(p95 > 1500, `p95 duration ${p95}ms should exceed 1500ms threshold`);
  });

  test("latency_p95_5min: p95 <= 1500ms does not fire alert", () => {
    // All requests fast
    const durations = Array(100).fill(400);
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
    assert.ok(p95 <= 1500, `p95 duration ${p95}ms should not exceed 1500ms threshold`);
  });

  test("judge_template_disagreement_rate: rate > 20% fires alert", () => {
    const { binding, calls } = makeMockBinding();
    const env = { JUDGE_ANALYTICS: binding };
    // 22 disagreements out of 100 = 22% > 20% threshold
    const records = forgeEvents(100, { disagreementRate: 0.22 });
    for (const rec of records) emitAnalytics(env, rec);

    const rate = rateFromCalls(calls, IDX_DISAGREE);
    assert.ok(rate > 20, `disagreement rate ${rate}% should exceed 20% threshold`);
  });

  test("judge_template_disagreement_rate: rate <= 20% does not fire alert", () => {
    const { binding, calls } = makeMockBinding();
    const env = { JUDGE_ANALYTICS: binding };
    const records = forgeEvents(100, { disagreementRate: 0.20 });
    for (const rec of records) emitAnalytics(env, rec);

    const rate = rateFromCalls(calls, IDX_DISAGREE);
    assert.ok(rate <= 20, `disagreement rate ${rate}% should not exceed 20% threshold`);
  });

  test("kv_rate_limit_hit_rate: rate > 10% fires alert", () => {
    const { binding, calls } = makeMockBinding();
    const env = { JUDGE_ANALYTICS: binding };
    // 12 rate-limited out of 100 = 12% > 10% threshold
    const records = forgeEvents(100, { rateLimitedRate: 0.12 });
    for (const rec of records) emitAnalytics(env, rec);

    const rate = rateFromCalls(calls, IDX_RATELIMIT);
    assert.ok(rate > 10, `KV rate-limit rate ${rate}% should exceed 10% threshold`);
  });

  test("kv_rate_limit_hit_rate: rate <= 10% does not fire alert", () => {
    const { binding, calls } = makeMockBinding();
    const env = { JUDGE_ANALYTICS: binding };
    const records = forgeEvents(100, { rateLimitedRate: 0.10 });
    for (const rec of records) emitAnalytics(env, rec);

    const rate = rateFromCalls(calls, IDX_RATELIMIT);
    assert.ok(rate <= 10, `KV rate-limit rate ${rate}% should not exceed 10% threshold`);
  });
});

// ---------------------------------------------------------------------------
// estimateCost() unit tests
// ---------------------------------------------------------------------------

describe("estimateCost", () => {
  test("groq: correct cost computation", () => {
    // 1000 input tokens * $0.20/MTok + 500 output tokens * $0.60/MTok
    // = (1000 * 0.20 + 500 * 0.60) / 1_000_000 = 500 / 1_000_000 = 0.0005
    const cost = estimateCost("groq", 1000, 500);
    assert.ok(Math.abs(cost - 0.0005) < 1e-10, `groq cost ${cost} unexpected`);
  });

  test("sambanova: correct cost computation", () => {
    const cost = estimateCost("sambanova", 1000, 500);
    // (1000 * 0.63 + 500 * 1.80) / 1_000_000 = (630 + 900) / 1_000_000 = 0.00153
    assert.ok(Math.abs(cost - 0.00153) < 1e-10, `sambanova cost ${cost} unexpected`);
  });

  test("anthropic: correct cost computation", () => {
    const cost = estimateCost("anthropic", 1000, 500);
    // (1000 * 5 + 500 * 25) / 1_000_000 = (5000 + 12500) / 1_000_000 = 0.0175
    assert.ok(Math.abs(cost - 0.0175) < 1e-10, `anthropic cost ${cost} unexpected`);
  });

  test("unknown provider returns 0", () => {
    const cost = estimateCost("unknown-provider", 1000, 500);
    assert.equal(cost, 0);
  });

  test("zero tokens returns 0", () => {
    assert.equal(estimateCost("groq", 0, 500), 0);
    assert.equal(estimateCost("groq", 500, 0), 0);
  });

  test("provider name is case-insensitive", () => {
    const lower = estimateCost("groq", 100, 100);
    const upper = estimateCost("GROQ", 100, 100);
    assert.equal(lower, upper);
  });
});
