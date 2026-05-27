/**
 * Anthropic provider adapter.
 *
 * Two modes:
 *
 *   1. Worker-routed (default): wraps `postJudge` with Anthropic-specific
 *      defaults; Worker handles the event-typed SSE dialect.
 *
 *   2. User-key direct (escape-hatch): when `userKey` is provided, we call
 *      api.anthropic.com directly with `anthropic-dangerous-direct-browser-access: true`.
 *      Anthropic's SSE is event-typed (`event: content_block_delta\ndata: {...}`),
 *      not delta-typed — we adapt it locally to the same `{kind, text?, reason?}`
 *      shape the Worker emits, so the progressive parser stays dialect-agnostic.
 */

import { postJudge, parseNormalisedSseStream } from "./_normalisedClient.js";

export const ANTHROPIC_DEFAULTS = Object.freeze({
  model: "claude-3-5-sonnet-latest",
  apiBase: "https://api.anthropic.com/v1/messages",
  apiVersion: "2023-06-01"
});

/**
 * Public entry. Routes Worker-side unless `userKey` is supplied.
 */
export async function callAnthropic({
  proxyUrl,
  mode,
  image,
  prompt,
  settings = {},
  userKey,
  signal,
  headers
}) {
  if (userKey) {
    return callAnthropicDirect({ image, prompt, mode, userKey, signal, settings });
  }
  return postJudge({
    proxyUrl,
    mode,
    image,
    prompt,
    settings: { provider: "anthropic", model: ANTHROPIC_DEFAULTS.model, ...settings },
    signal,
    headers
  });
}

/**
 * Browser-direct call to api.anthropic.com using the user's own key.
 * Returns an async iterator over the SAME normalised event shape the Worker
 * would emit, so downstream parsing is identical.
 *
 * NOTE: This requires `dangerous-direct-browser-access: true`. Anthropic
 * documents this header explicitly for browser apps that handle their own
 * key custody. The settings panel (M3) shows a disclosure before persisting
 * the key.
 */
export async function callAnthropicDirect({ image, prompt, mode, userKey, signal, settings = {} }) {
  const model = settings.model ?? ANTHROPIC_DEFAULTS.model;
  const apiBase = settings.apiBase ?? ANTHROPIC_DEFAULTS.apiBase;
  const apiVersion = settings.apiVersion ?? ANTHROPIC_DEFAULTS.apiVersion;

  const body = {
    model,
    max_tokens: mode === "deep" ? 1024 : 256,
    stream: true,
    system: prompt ?? "",
    messages: [
      {
        role: "user",
        content: image
          ? [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: stripDataUriPrefix(image) }
              }
            ]
          : [{ type: "text", text: "describe the glyph" }]
      }
    ]
  };

  const response = await fetch(apiBase, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": userKey,
      "anthropic-version": apiVersion,
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`anthropic direct returned ${response.status}`);
  }

  return { stream: adaptAnthropicEventSse(response.body, signal), response };
}

function stripDataUriPrefix(image) {
  if (typeof image !== "string") return image;
  const m = image.match(/^data:image\/[a-zA-Z]+;base64,(.+)$/);
  return m ? m[1] : image;
}

/**
 * Convert Anthropic's event-typed SSE into the Worker's uniform event shape.
 * Anthropic emits:
 *   event: message_start\ndata: {...}\n\n
 *   event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}\n\n
 *   event: message_stop\ndata: {...}\n\n
 *
 * We reuse `parseNormalisedSseStream` to chop frames, then re-shape each one.
 */
async function* adaptAnthropicEventSse(body, signal) {
  // We can't use parseNormalisedSseStream directly because Anthropic's `data:`
  // line carries Anthropic-typed JSON. Instead, parse frames manually here.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const norm = adaptAnthropicFrame(frame);
        if (norm) yield norm;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function adaptAnthropicFrame(frame) {
  const lines = frame.split("\n");
  let dataLine = null;
  for (const ln of lines) {
    if (ln.startsWith("data:")) {
      dataLine = ln.slice(5).trim();
      break;
    }
  }
  if (!dataLine) return null;
  try {
    const obj = JSON.parse(dataLine);
    if (obj?.type === "content_block_delta") {
      const text = obj?.delta?.text;
      if (typeof text === "string" && text.length) {
        return { kind: "token-delta", text, provider: "anthropic" };
      }
    } else if (obj?.type === "message_stop") {
      return { kind: "done", reason: "stop", provider: "anthropic" };
    } else if (obj?.type === "error") {
      return {
        kind: "error",
        reason: obj?.error?.message ?? "anthropic-error",
        provider: "anthropic"
      };
    }
    return null;
  } catch {
    return null;
  }
}
