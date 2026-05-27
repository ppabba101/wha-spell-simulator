/**
 * Top-level mirror of `worker/wha-llm-proxy/test/worker.test.js` so the
 * default `npm test` invocation (which scans `tests/`) covers the Worker's
 * pure-function surface. M2 will add miniflare-driven integration tests that
 * exercise the full POST /api/judge handler.
 */

export * from "../worker/wha-llm-proxy/test/worker.test.js";
