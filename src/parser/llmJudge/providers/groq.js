/**
 * Groq provider adapter.
 *
 * For Worker-routed calls (default): wraps `postJudge` with Groq-specific
 * defaults (model id). The Worker handles the SSE dialect.
 *
 * For user-key direct calls: rejected with a warning — CORS blocks
 * browser-direct calls to api.groq.com. Users wanting a direct path must
 * use the Anthropic adapter (which supports `dangerous-direct-browser-access`)
 * or proxy through the Worker.
 */

import { postJudge } from "./_normalisedClient.js";

export const GROQ_DEFAULTS = Object.freeze({
  // Groq deprecated `llama-3.2-90b-vision-preview` in early 2026; only
  // llama-4-scout remains as a maintained vision endpoint on /openai/v1.
  model: "meta-llama/llama-4-scout-17b-16e-instruct"
});

/**
 * @param {object} args
 * @param {string} args.proxyUrl
 * @param {string} args.mode      'fast' | 'deep' | 'parallel'
 * @param {string} args.image     base64 PNG
 * @param {string} args.prompt    system prompt
 * @param {object} [args.settings]
 * @param {string} [args.userKey] direct-call key (NOT supported for Groq; warned)
 * @param {AbortSignal} [args.signal]
 */
export async function callGroq({ proxyUrl, mode, image, prompt, settings = {}, userKey, signal, headers }) {
  if (userKey) {
    console.warn(
      "[llmJudge/groq] User-key direct calls to api.groq.com are blocked by CORS. " +
        "Falling back to the Worker proxy."
    );
  }
  return postJudge({
    proxyUrl,
    mode,
    image,
    prompt,
    settings: { provider: "groq", model: GROQ_DEFAULTS.model, ...settings },
    signal,
    headers
  });
}
