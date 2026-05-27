/**
 * WHA LLM Proxy Worker — Principle 4 enforcement point.
 *
 * Normalises three SSE dialects (OpenAI-style Groq, OpenAI-style SambaNova,
 * Anthropic event-typed) into ONE uniform shape so the client never branches
 * on provider. Implements per-IP rate limiting, circuit breakers per provider,
 * and emits an Analytics Engine event for every request.
 *
 * Public surface:
 *   POST /api/judge
 *     body: { provider, mode, model, image, prompt, settings }
 *     response: text/event-stream of
 *       data: {"kind":"token-delta","text":"...","provider":"groq"}\n\n
 *       data: {"kind":"done","reason":"stop","provider":"groq"}\n\n
 *       data: {"kind":"error","reason":"...","provider":"groq"}\n\n
 *
 *   GET /api/health
 *     -> { ok: true, breaker: {...} }
 */

import { emitAnalytics } from "./analytics";
import { CircuitBreaker, getBreakerState, withBreaker } from "./circuitBreaker.js";
import { handleParallelMode } from "./parallelMode.js";

export interface Env {
  GROQ_KEY: string;
  SAMBANOVA_KEY: string;
  ANTHROPIC_KEY: string;
  RATELIMIT: KVNamespace;
  JUDGE_ANALYTICS: AnalyticsEngineDataset;
  PROVIDER_GROQ_URL: string;
  PROVIDER_SAMBANOVA_URL: string;
  PROVIDER_ANTHROPIC_URL: string;
  RATE_LIMIT_PER_MIN: string;
  BREAKER_TRIP_THRESHOLD: string;
  BREAKER_PROBE_INTERVAL_MS: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

interface AnalyticsEngineDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

interface JudgeRequestBody {
  provider?: "groq" | "sambanova" | "anthropic";
  mode?: "fast" | "deep" | "parallel";
  model?: string;
  image?: string;
  prompt?: string;
  settings?: Record<string, unknown>;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    ...CORS_HEADERS
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

function sseEvent(payload: Record<string, unknown>): Uint8Array {
  const enc = new TextEncoder();
  return enc.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

async function rateLimit(env: Env, ip: string): Promise<{ ok: boolean; remaining: number }> {
  const limit = parseInt(env.RATE_LIMIT_PER_MIN ?? "10", 10);
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl:${ip}:${minute}`;
  const raw = await env.RATELIMIT.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return { ok: false, remaining: 0 };
  await env.RATELIMIT.put(key, String(count + 1), { expirationTtl: 90 });
  return { ok: true, remaining: limit - count - 1 };
}

/**
 * Decide which upstream endpoint + payload shape to call.
 */
function buildUpstreamRequest(provider: string, body: JudgeRequestBody, env: Env): { url: string; init: RequestInit } {
  if (provider === "groq") {
    return {
      url: env.PROVIDER_GROQ_URL,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.GROQ_KEY}`
        },
        body: JSON.stringify({
          model: body.model ?? "llama-3.2-90b-vision-preview",
          stream: true,
          messages: [
            { role: "system", content: body.prompt ?? "" },
            {
              role: "user",
              content: body.image
                ? [{ type: "image_url", image_url: { url: body.image } }]
                : "describe the glyph"
            }
          ]
        })
      }
    };
  }
  if (provider === "sambanova") {
    return {
      url: env.PROVIDER_SAMBANOVA_URL,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.SAMBANOVA_KEY}`
        },
        body: JSON.stringify({
          model: body.model ?? "Llama-4-Maverick-17B-128E-Instruct",
          stream: true,
          messages: [
            { role: "system", content: body.prompt ?? "" },
            {
              role: "user",
              content: body.image
                ? [{ type: "image_url", image_url: { url: body.image } }]
                : "describe the glyph"
            }
          ]
        })
      }
    };
  }
  if (provider === "anthropic") {
    return {
      url: env.PROVIDER_ANTHROPIC_URL,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": env.ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: body.model ?? "claude-3-5-sonnet-latest",
          max_tokens: 1024,
          stream: true,
          system: body.prompt ?? "",
          messages: [
            {
              role: "user",
              content: body.image
                ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: body.image } }]
                : [{ type: "text", text: "describe the glyph" }]
            }
          ]
        })
      }
    };
  }
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Provider-specific SSE chunk -> normalised token-delta extractor.
 */
export function normaliseSseChunk(provider: string, line: string): Array<Record<string, unknown>> {
  // OpenAI-style providers (Groq, SambaNova) emit `data: { choices: [{ delta: { content: ... } }] }`.
  if (provider === "groq" || provider === "sambanova") {
    if (!line.startsWith("data:")) return [];
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return [{ kind: "done", reason: "stop", provider }];
    if (!payload) return [];
    try {
      const obj = JSON.parse(payload);
      const text = obj?.choices?.[0]?.delta?.content;
      const finish = obj?.choices?.[0]?.finish_reason;
      const events: Array<Record<string, unknown>> = [];
      if (typeof text === "string" && text.length) {
        events.push({ kind: "token-delta", text, provider });
      }
      if (finish) {
        events.push({ kind: "done", reason: finish, provider });
      }
      return events;
    } catch {
      return [];
    }
  }
  // Anthropic emits `event: content_block_delta\ndata: {...}` pairs.
  if (provider === "anthropic") {
    if (!line.startsWith("data:")) return [];
    const payload = line.slice(5).trim();
    if (!payload) return [];
    try {
      const obj = JSON.parse(payload);
      if (obj?.type === "content_block_delta") {
        const text = obj?.delta?.text;
        if (typeof text === "string" && text.length) {
          return [{ kind: "token-delta", text, provider }];
        }
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

/**
 * Streams a normalised SSE response from one upstream provider.
 * Wraps the upstream call in a circuit breaker.
 */
export async function streamFromProvider(
  provider: string,
  body: JudgeRequestBody,
  env: Env,
  startedAt: number
): Promise<Response> {
  const breaker = CircuitBreaker.forProvider(provider, {
    threshold: parseInt(env.BREAKER_TRIP_THRESHOLD ?? "3", 10),
    probeIntervalMs: parseInt(env.BREAKER_PROBE_INTERVAL_MS ?? "60000", 10)
  });

  if (breaker.isOpen()) {
    emitAnalytics(env, {
      provider,
      status: 503,
      durationMs: 0,
      ttftMs: 0,
      mode: body.mode ?? "fast",
      breakerOpen: true,
      dslInvalid: false
    });
    return new Response(
      sseEvent({ kind: "error", reason: "breaker-open", provider }),
      { status: 503, headers: sseHeaders() }
    );
  }

  let upstream: Response;
  try {
    const { url, init } = buildUpstreamRequest(provider, body, env);
    upstream = await withBreaker(breaker, () => fetch(url, init));
  } catch (err) {
    emitAnalytics(env, {
      provider,
      status: 502,
      durationMs: Date.now() - startedAt,
      ttftMs: 0,
      mode: body.mode ?? "fast",
      breakerOpen: false,
      dslInvalid: false
    });
    return new Response(
      sseEvent({ kind: "error", reason: `upstream-failure: ${String(err)}`, provider }),
      { status: 502, headers: sseHeaders() }
    );
  }

  if (!upstream.ok || !upstream.body) {
    breaker.recordFailure();
    emitAnalytics(env, {
      provider,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
      ttftMs: 0,
      mode: body.mode ?? "fast",
      breakerOpen: false,
      dslInvalid: false
    });
    return new Response(
      sseEvent({ kind: "error", reason: `upstream-status-${upstream.status}`, provider }),
      { status: upstream.status, headers: sseHeaders() }
    );
  }

  breaker.recordSuccess();

  // Re-emit upstream SSE as normalised events.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let firstByteAt: number | null = null;

  const out = new ReadableStream({
    async start(controller) {
      let buffer = "";
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstByteAt === null) firstByteAt = Date.now();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            for (const ev of normaliseSseChunk(provider, line)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
            }
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "done", reason: "stop", provider })}\n\n`));
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ kind: "error", reason: String(err), provider })}\n\n`)
        );
      } finally {
        emitAnalytics(env, {
          provider,
          status: 200,
          durationMs: Date.now() - startedAt,
          ttftMs: firstByteAt ? firstByteAt - startedAt : 0,
          mode: body.mode ?? "fast",
          breakerOpen: false,
          dslInvalid: false
        });
        controller.close();
      }
    }
  });

  return new Response(out, { status: 200, headers: sseHeaders() });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse({ ok: true, breaker: getBreakerState() });
    }

    if (req.method !== "POST" || url.pathname !== "/api/judge") {
      return jsonResponse({ error: "not-found" }, 404);
    }

    const ip =
      req.headers.get("CF-Connecting-IP") ??
      req.headers.get("X-Forwarded-For") ??
      "anon";
    const rl = await rateLimit(env, ip).catch(() => ({ ok: true, remaining: -1 }));
    if (!rl.ok) {
      emitAnalytics(env, {
        provider: "n/a",
        status: 429,
        durationMs: 0,
        ttftMs: 0,
        mode: "fast",
        breakerOpen: false,
        dslInvalid: false,
        rateLimited: true
      });
      return jsonResponse({ error: "rate-limited" }, 429);
    }

    let body: JudgeRequestBody;
    try {
      body = (await req.json()) as JudgeRequestBody;
    } catch {
      return jsonResponse({ error: "invalid-json" }, 400);
    }

    const startedAt = Date.now();

    if (body.mode === "parallel") {
      return handleParallelMode(body, env, startedAt, streamFromProvider);
    }

    const provider = body.provider ?? "groq";
    return streamFromProvider(provider, body, env, startedAt);
  }
};
