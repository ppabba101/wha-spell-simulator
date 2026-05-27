/**
 * Worker-routed normalised client.
 *
 * Talks to `POST /api/judge` and returns the SSE stream **already in the
 * Worker's uniform shape**: `{ kind: 'token-delta' | 'done' | 'error', text?, reason?, provider, source? }`.
 *
 * Per Architect T3 (Option Set B2): the client never branches on provider
 * SSE dialect — the Worker handles that. We just parse the `data: <json>` SSE
 * frames and emit the embedded normalised events.
 */

/**
 * Send a judge request to the Worker proxy. Returns an async iterator over
 * normalised events.
 *
 * @param {object} args
 * @param {string} args.proxyUrl       e.g. "/api/judge"
 * @param {string} args.mode           'fast' | 'deep' | 'parallel'
 * @param {string} args.image          base64-encoded PNG, no `data:` prefix
 * @param {string} args.prompt         system prompt (assembled by streamingJudge)
 * @param {object} args.settings       opaque settings forwarded to Worker
 * @param {AbortSignal} [args.signal]  cancellation signal
 * @param {object} [args.headers]      additional fetch headers (X-Region, etc.)
 * @returns {Promise<{ stream: AsyncIterable<NormalisedEvent>, response: Response }>}
 */
export async function postJudge({ proxyUrl, mode, image, prompt, settings, signal, headers = {} }) {
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify({
      mode,
      image,
      prompt,
      settings: settings ?? {}
    }),
    signal
  });

  if (!response.ok && response.status !== 200) {
    // 503 from breaker-open still carries an SSE event body; we surface it.
    if (response.status === 429 || response.status === 503) {
      // Allow the caller to read the SSE error frame.
    } else {
      throw new Error(`judge proxy returned ${response.status}`);
    }
  }

  if (!response.body) {
    throw new Error("judge proxy returned no body");
  }

  return { stream: parseNormalisedSseStream(response.body, signal), response };
}

/**
 * Iterate over `data: <json>\n\n` SSE frames and yield the embedded normalised
 * event objects. Frames that aren't valid JSON are silently dropped (the
 * Worker has already validated upstream syntax; nothing else legitimately
 * reaches us).
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {AbortSignal} [signal]
 */
export async function* parseNormalisedSseStream(body, signal) {
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
        const ev = parseDataFrame(frame);
        if (ev) yield ev;
      }
    }
    // Final flush.
    const tail = buffer.trim();
    if (tail) {
      const ev = parseDataFrame(tail);
      if (ev) yield ev;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseDataFrame(frame) {
  const line = frame.trim();
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
