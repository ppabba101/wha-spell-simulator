/**
 * SambaNova provider adapter. Worker-routed only; CORS blocks browser-direct.
 */

import { postJudge } from "./_normalisedClient.js";

export const SAMBANOVA_DEFAULTS = Object.freeze({
  model: "Llama-4-Maverick-17B-128E-Instruct"
});

export async function callSambaNova({
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
    console.warn(
      "[llmJudge/sambanova] User-key direct calls to api.sambanova.ai are blocked by CORS. " +
        "Falling back to the Worker proxy."
    );
  }
  return postJudge({
    proxyUrl,
    mode,
    image,
    prompt,
    settings: { provider: "sambanova", model: SAMBANOVA_DEFAULTS.model, ...settings },
    signal,
    headers
  });
}
