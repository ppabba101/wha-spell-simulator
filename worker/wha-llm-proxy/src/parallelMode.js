/**
 * Parallel-double-request orchestrator (Architect T1).
 *
 * When `mode === 'parallel'` the Worker fans out to Groq (fast first-hint) and
 * SambaNova (deep critique) simultaneously. Their normalised SSE streams are
 * multiplexed back to the client with a `source: 'fast' | 'deep'` tag.
 *
 * Cost-saving 60ms Groq head-start guard: if Groq's `done` event arrives
 * within 60ms of stroke-end with a complete short response, the SambaNova
 * leg is aborted. (The client also requests this — Worker-side enforcement
 * is defence in depth.)
 */

const GROQ_HEADSTART_MS = 60;

/**
 * Build a multiplexed SSE stream from the fast (Groq) and deep (SambaNova)
 * provider streams. Each event from the upstream provider is re-emitted with
 * a `source` tag added.
 *
 * @param {object} body  judge request body
 * @param {object} env   Worker bindings
 * @param {number} startedAt timestamp in ms
 * @param {(provider:string, body:object, env:object, startedAt:number) => Promise<Response>} streamFromProvider
 */
export async function handleParallelMode(body, env, startedAt, streamFromProvider) {
  const encoder = new TextEncoder();

  const fastPromise = streamFromProvider("groq", { ...body, mode: "fast" }, env, startedAt);
  const deepPromise = streamFromProvider("sambanova", { ...body, mode: "deep" }, env, startedAt);

  const out = new ReadableStream({
    async start(controller) {
      let fastResp;
      let deepResp;
      try {
        [fastResp, deepResp] = await Promise.all([fastPromise, deepPromise]);
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ kind: "error", reason: String(err), source: "n/a" })}\n\n`)
        );
        controller.close();
        return;
      }

      const fastReader = fastResp.body?.getReader();
      const deepReader = deepResp.body?.getReader();
      const decoder = new TextDecoder();

      let fastDoneAt = null;
      let deepAborted = false;

      async function pump(reader, source, onDone) {
        if (!reader) {
          onDone();
          return;
        }
        let buffer = "";
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const segments = buffer.split("\n\n");
            buffer = segments.pop() ?? "";
            for (const seg of segments) {
              const line = seg.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                const obj = JSON.parse(payload);
                obj.source = source;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
                if (obj.kind === "done" && source === "fast") {
                  fastDoneAt = Date.now();
                  // 60ms head-start cost-saver: if Groq finished within 60ms of stroke-end,
                  // skip the SambaNova call. In normal practice this never trips because
                  // network latency exceeds 60ms; but guard preserves the architectural intent.
                  if (fastDoneAt - startedAt <= GROQ_HEADSTART_MS && !deepAborted) {
                    deepAborted = true;
                    try {
                      await deepReader?.cancel("groq-headstart");
                    } catch {
                      // ignore
                    }
                  }
                }
              } catch {
                // Malformed event — ignore.
              }
            }
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ kind: "error", reason: String(err), source })}\n\n`)
          );
        } finally {
          onDone();
        }
      }

      await new Promise((resolve) => {
        let remaining = 2;
        const tickDown = () => {
          remaining -= 1;
          if (remaining === 0) resolve();
        };
        pump(fastReader, "fast", tickDown);
        pump(deepReader, "deep", tickDown);
      });

      controller.close();
    }
  });

  return new Response(out, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
