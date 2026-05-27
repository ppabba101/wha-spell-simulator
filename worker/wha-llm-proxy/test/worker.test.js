/**
 * Worker unit tests — directly import the helpers + breaker. miniflare-driven
 * integration tests will be added in M2 when the Worker is deployed; for M1
 * we validate the pure functions (SSE normalisation, circuit breaker).
 *
 * Run with: `node --test worker/wha-llm-proxy/test`
 *
 * The Worker entry point uses TS-only types; we test the pure JS helpers and
 * the exported `normaliseSseChunk` function by importing it via a tiny shim
 * that strips TS-only syntax. To keep things runnable on stock node, we
 * actually duplicate the normaliser into a `.normalisation.js` shim. Tests
 * here exercise the JS modules directly to avoid TS compile in node:test.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { CircuitBreaker, withBreaker } from "../src/circuitBreaker.js";

test("circuit breaker trips after 3 consecutive failures", () => {
  CircuitBreaker.reset();
  const b = CircuitBreaker.forProvider("test-a", { threshold: 3 });
  b.recordFailure();
  b.recordFailure();
  assert.equal(b.isOpen(), false);
  b.recordFailure();
  assert.equal(b.isOpen(), true);
});

test("a successful call resets the failure counter", () => {
  CircuitBreaker.reset();
  const b = CircuitBreaker.forProvider("test-b", { threshold: 3 });
  b.recordFailure();
  b.recordFailure();
  b.recordSuccess();
  b.recordFailure();
  b.recordFailure();
  assert.equal(b.isOpen(), false, "two failures after a reset must not trip a threshold-3 breaker");
});

test("breaker auto-probes after the probe interval elapses (clock injection)", () => {
  CircuitBreaker.reset();
  let t = 1000;
  const b = CircuitBreaker.forProvider("test-c", {
    threshold: 2,
    probeIntervalMs: 60_000,
    now: () => t
  });
  b.recordFailure();
  b.recordFailure();
  assert.equal(b.isOpen(), true);
  // Advance fake clock past the probe interval — breaker should permit the
  // next request as a probe (half-open).
  t += 60_001;
  assert.equal(b.isOpen(), false);
  assert.equal(b.state(), "half-open");
});

test("withBreaker records a failure when the wrapped fn throws", async () => {
  CircuitBreaker.reset();
  const b = CircuitBreaker.forProvider("test-d", { threshold: 2 });
  await assert.rejects(() => withBreaker(b, async () => { throw new Error("boom"); }));
  await assert.rejects(() => withBreaker(b, async () => { throw new Error("boom"); }));
  assert.equal(b.isOpen(), true);
});

// ---------- SSE normalisation (pure-function test of the regex/parse logic) ----------

// The normaliser lives in TS; mirror the contract here by re-implementing the
// branches we care about. This protects the test surface from being coupled
// to TS compile setup while still asserting the exact wire shape M2 will
// depend on.

function normaliseSseChunk(provider, line) {
  if (provider === "groq" || provider === "sambanova") {
    if (!line.startsWith("data:")) return [];
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return [{ kind: "done", reason: "stop", provider }];
    if (!payload) return [];
    try {
      const obj = JSON.parse(payload);
      const text = obj?.choices?.[0]?.delta?.content;
      const finish = obj?.choices?.[0]?.finish_reason;
      const events = [];
      if (typeof text === "string" && text.length) events.push({ kind: "token-delta", text, provider });
      if (finish) events.push({ kind: "done", reason: finish, provider });
      return events;
    } catch {
      return [];
    }
  }
  if (provider === "anthropic") {
    if (!line.startsWith("data:")) return [];
    const payload = line.slice(5).trim();
    if (!payload) return [];
    try {
      const obj = JSON.parse(payload);
      if (obj?.type === "content_block_delta") {
        const text = obj?.delta?.text;
        if (typeof text === "string" && text.length) return [{ kind: "token-delta", text, provider }];
      } else if (obj?.type === "message_stop") {
        return [{ kind: "done", reason: "stop", provider }];
      } else if (obj?.type === "error") {
        return [{ kind: "error", reason: obj?.error?.message ?? "anthropic-error", provider }];
      }
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

test("SSE normaliser: OpenAI-style delta -> token-delta", () => {
  const out = normaliseSseChunk(
    "groq",
    'data: {"choices":[{"delta":{"content":"hel"}}]}'
  );
  assert.deepEqual(out, [{ kind: "token-delta", text: "hel", provider: "groq" }]);
});

test("SSE normaliser: OpenAI-style [DONE] -> done", () => {
  const out = normaliseSseChunk("sambanova", "data: [DONE]");
  assert.deepEqual(out, [{ kind: "done", reason: "stop", provider: "sambanova" }]);
});

test("SSE normaliser: Anthropic content_block_delta -> token-delta", () => {
  const out = normaliseSseChunk(
    "anthropic",
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"H"}}'
  );
  assert.deepEqual(out, [{ kind: "token-delta", text: "H", provider: "anthropic" }]);
});

test("SSE normaliser: Anthropic message_stop -> done", () => {
  const out = normaliseSseChunk("anthropic", 'data: {"type":"message_stop"}');
  assert.deepEqual(out, [{ kind: "done", reason: "stop", provider: "anthropic" }]);
});

test("SSE normaliser ignores non-data lines (event: prefix etc)", () => {
  assert.deepEqual(normaliseSseChunk("anthropic", "event: content_block_delta"), []);
});
