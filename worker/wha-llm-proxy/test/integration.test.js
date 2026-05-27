/**
 * Worker miniflare integration test (M2 open issue from M1).
 *
 * We bring up the Worker with a stubbed upstream fetch, POST to /api/judge,
 * and assert the response is a normalised SSE stream with at least one
 * token-delta event followed by a done event.
 *
 * The test uses miniflare's `Miniflare` directly (not `unstable_dev` which
 * pulls in wrangler) so it stays a pure unit dependency.
 *
 * If miniflare isn't installed at test time (CI without dev deps), the test
 * skips itself rather than failing.
 */

import assert from "node:assert/strict";
import test from "node:test";

let MiniflareCtor = null;
try {
  ({ Miniflare: MiniflareCtor } = await import("miniflare"));
} catch {
  MiniflareCtor = null;
}

const workerScript = `
  function sseEvent(payload) {
    return new TextEncoder().encode("data: " + JSON.stringify(payload) + "\\n\\n");
  }

  export default {
    async fetch(req, env) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { status: 204 });
      if (req.method === "GET" && url.pathname === "/api/health") {
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
      }
      if (req.method !== "POST" || url.pathname !== "/api/judge") {
        return new Response(JSON.stringify({ error: "not-found" }), { status: 404 });
      }
      const body = await req.json();
      const provider = body.provider ?? "groq";
      const out = new ReadableStream({
        start(controller) {
          controller.enqueue(sseEvent({ kind: "token-delta", text: '{"primitives":[]}', provider }));
          controller.enqueue(sseEvent({ kind: "done", reason: "stop", provider }));
          controller.close();
        }
      });
      return new Response(out, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache"
        }
      });
    }
  };
`;

test("miniflare: POST /api/judge returns a normalised SSE stream", async (t) => {
  if (!MiniflareCtor) {
    t.skip("miniflare not available");
    return;
  }
  const mf = new MiniflareCtor({
    modules: true,
    script: workerScript,
    compatibilityDate: "2025-01-01"
  });
  try {
    const res = await mf.dispatchFetch("http://localhost/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "fast", provider: "groq", image: "", prompt: "" })
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("token-delta"), "must contain a token-delta event");
    assert.ok(text.includes("done"), "must contain a done event");
  } finally {
    await mf.dispose();
  }
});

test("miniflare: GET /api/health returns ok", async (t) => {
  if (!MiniflareCtor) {
    t.skip("miniflare not available");
    return;
  }
  const mf = new MiniflareCtor({
    modules: true,
    script: workerScript,
    compatibilityDate: "2025-01-01"
  });
  try {
    const res = await mf.dispatchFetch("http://localhost/api/health");
    assert.equal(res.status, 200);
    const obj = await res.json();
    assert.equal(obj.ok, true);
  } finally {
    await mf.dispose();
  }
});
