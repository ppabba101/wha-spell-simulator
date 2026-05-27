/**
 * Streaming judge orchestrator (M2).
 *
 * Coordinates:
 *  - canvas pointer events (stroke-end debounce + idle-tick)
 *  - dHash diff-gate (skip submissions when canvas hasn't changed)
 *  - AbortController-based cancellation of in-flight requests
 *  - normalised SSE stream from the Worker proxy
 *  - progressive JSON parsing into WHADSLPartial events
 *  - conflict-precedence: deep `guess` overrides fast `guess`
 *  - circuit breaker UX (3 consecutive failures -> trip + auto-probe)
 *
 * Public factory: `createStreamingJudge({ canvas, proxyUrl, ... })`.
 */

import { dHash, hammingDistance } from "./perceptualHash.js";
import { postJudge } from "./providers/_normalisedClient.js";
import { systemPromptFor } from "./prompts.js";

// Ajv is heavy (~120KB). Load the progressive parser dynamically so the entry
// chunk doesn't include it until the judge is actually enabled. (M2 open issue.)
let _progressiveParserModule = null;
async function loadProgressiveParser() {
  if (!_progressiveParserModule) {
    _progressiveParserModule = await import("./progressiveJsonParser.js");
  }
  return _progressiveParserModule;
}

const DEFAULTS = Object.freeze({
  proxyUrl: "/api/judge",
  mode: "parallel",
  groqHeadStartMs: 60,
  diffThreshold: 6,
  idleTickMs: 750,
  debounceMs: 150,
  alwaysCritique: false
});

const CIRCUIT_TRIP_AFTER = 3;
const CIRCUIT_PROBE_INTERVAL_MS = 60_000;

/**
 * @param {object} opts
 * @returns {{
 *   start: () => void,
 *   stop: () => void,
 *   triggerNow: () => Promise<void>,
 *   getStats: () => object,
 *   _internal: object
 * }}
 */
export function createStreamingJudge(opts = {}) {
  const canvas = opts.canvas;
  const proxyUrl = opts.proxyUrl ?? DEFAULTS.proxyUrl;
  const mode = opts.mode ?? DEFAULTS.mode;
  const groqHeadStartMs = opts.groqHeadStartMs ?? DEFAULTS.groqHeadStartMs;
  const diffThreshold = opts.diffThreshold ?? DEFAULTS.diffThreshold;
  const idleTickMs = opts.idleTickMs ?? DEFAULTS.idleTickMs;
  const debounceMs = opts.debounceMs ?? DEFAULTS.debounceMs;
  const alwaysCritique = opts.alwaysCritique ?? DEFAULTS.alwaysCritique;
  const userKey = opts.userKey ?? null;
  const dictionary = opts.dictionary ?? null;

  const onPartial = typeof opts.onPartial === "function" ? opts.onPartial : () => {};
  const onFinal = typeof opts.onFinal === "function" ? opts.onFinal : () => {};
  const onError = typeof opts.onError === "function" ? opts.onError : () => {};
  const onCircuitTrip = typeof opts.onCircuitTrip === "function" ? opts.onCircuitTrip : () => {};
  const onCircuitClose = typeof opts.onCircuitClose === "function" ? opts.onCircuitClose : () => {};
  const onGuessRevised = typeof opts.onGuessRevised === "function" ? opts.onGuessRevised : () => {};

  // Allow tests to inject a fake fetcher (otherwise the real Worker POST).
  const submit = typeof opts.submit === "function" ? opts.submit : postJudge;
  const getNowMs = typeof opts.getNowMs === "function" ? opts.getNowMs : () => Date.now();
  const setTimer = typeof opts.setTimer === "function" ? opts.setTimer : (fn, ms) => setTimeout(fn, ms);
  const clearTimer = typeof opts.clearTimer === "function" ? opts.clearTimer : (id) => clearTimeout(id);

  let lastHash = null;
  let inflightController = null;
  let debounceTimer = null;
  let idleTimer = null;
  let pointerDown = false;
  let consecutiveFailures = 0;
  let circuitOpen = false;
  let probeTimer = null;
  let started = false;

  const stats = {
    requestsSent: 0,
    requestsSkippedByDiffGate: 0,
    failures: 0,
    circuitTrips: 0,
    fastGuess: null,
    deepGuess: null,
    lastSubmitAt: 0
  };

  // ---- Canvas observers ----

  function onPointerDown() {
    pointerDown = true;
    armIdleTimer();
  }

  function onPointerMove() {
    armIdleTimer();
  }

  function onPointerUp() {
    pointerDown = false;
    clearTimer(idleTimer);
    idleTimer = null;
    if (debounceTimer) clearTimer(debounceTimer);
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      trySubmit().catch(onError);
    }, debounceMs);
  }

  function armIdleTimer() {
    if (idleTimer) return;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (pointerDown) {
        // Continuous draw safety net: fire while pen is still down.
        trySubmit().catch(onError);
        armIdleTimer();
      }
    }, idleTickMs);
  }

  // ---- Diff gate ----

  function computeCanvasHash() {
    if (!canvas) return null;
    try {
      return dHash(canvas);
    } catch (err) {
      onError(err);
      return null;
    }
  }

  function passesDiffGate(currentHash) {
    if (currentHash === null || currentHash === undefined) return true;
    if (lastHash === null || lastHash === undefined) return true;
    const dist = hammingDistance(lastHash, currentHash);
    return dist >= diffThreshold;
  }

  // ---- Submission ----

  async function trySubmit() {
    if (circuitOpen) {
      // Breaker open: skip submission silently; auto-probe handles recovery.
      return;
    }

    const currentHash = computeCanvasHash();
    if (!alwaysCritique && !passesDiffGate(currentHash)) {
      stats.requestsSkippedByDiffGate += 1;
      return;
    }
    lastHash = currentHash;

    // Cancel any in-flight request — only the latest counts.
    if (inflightController) {
      try {
        inflightController.abort();
      } catch {
        // ignore
      }
    }
    inflightController = new AbortController();
    const localController = inflightController;
    stats.requestsSent += 1;
    stats.lastSubmitAt = getNowMs();

    let image = "";
    try {
      image = await canvasToBase64Png(canvas);
    } catch (err) {
      onError(err);
      return;
    }

    const prompt = systemPromptFor(mode === "deep" ? "deep" : "fast", dictionary);

    let postResult;
    try {
      postResult = await submit({
        proxyUrl,
        mode,
        image,
        prompt,
        settings: { groqHeadStartMs, userKeyPresent: !!userKey },
        signal: localController.signal,
        userKey
      });
    } catch (err) {
      if (localController.signal.aborted) return;
      recordFailure(err);
      return;
    }

    const { stream, response } = postResult;

    // 5xx from Worker -> count toward breaker.
    if (response && typeof response.status === "number" && response.status >= 500) {
      recordFailure(new Error(`worker-status-${response.status}`));
      return;
    }

    let progressiveModule;
    try {
      progressiveModule = await loadProgressiveParser();
    } catch (err) {
      onError(err);
      return;
    }

    // Per-source progressive parsers so fast/deep streams don't trample.
    const parsers = {
      fast: progressiveModule.createProgressiveJsonParser(),
      deep: progressiveModule.createProgressiveJsonParser(),
      "n/a": progressiveModule.createProgressiveJsonParser()
    };

    const lastGuess = { fast: null, deep: null };

    function wirePartial(source) {
      parsers[source].onPartial((value) => {
        try {
          onPartial(value, source);
        } catch (err) {
          onError(err);
        }
        const currentGuess = value?.guess?.glyphId;
        if (currentGuess) {
          const prev = lastGuess[source];
          lastGuess[source] = currentGuess;
          // Conflict precedence: deep guess overrides fast guess.
          if (source === "deep" && lastGuess.fast && currentGuess !== lastGuess.fast) {
            try {
              onGuessRevised({
                from: lastGuess.fast,
                to: currentGuess,
                source: "deep",
                priorSource: "fast"
              });
            } catch (err) {
              onError(err);
            }
          }
          if (source === "fast") stats.fastGuess = currentGuess;
          if (source === "deep") stats.deepGuess = currentGuess;
          // Touched-but-unused: silence noise from above conditional reuse.
          void prev;
        }
      });
      parsers[source].onFinal((value) => {
        try {
          onFinal(value, source);
        } catch (err) {
          onError(err);
        }
      });
      parsers[source].onError((err) => onError(err));
    }
    wirePartial("fast");
    wirePartial("deep");
    wirePartial("n/a");

    try {
      let sawAnyToken = false;
      for await (const ev of stream) {
        if (localController.signal.aborted) break;
        if (!ev || typeof ev !== "object") continue;
        const source = ev.source === "fast" || ev.source === "deep" ? ev.source : "n/a";
        if (ev.kind === "token-delta" && typeof ev.text === "string") {
          sawAnyToken = true;
          parsers[source].feed(ev.text);
        } else if (ev.kind === "error") {
          if (ev.reason === "breaker-open") {
            // Worker-side breaker already open: surface as failure for client UX.
            recordFailure(new Error("worker-breaker-open"));
            return;
          }
          onError(new Error(`judge stream error: ${ev.reason}`));
        } else if (ev.kind === "done") {
          parsers[source].end();
        }
      }
      if (!sawAnyToken && response && typeof response.status === "number" && response.status >= 500) {
        recordFailure(new Error(`worker-status-${response.status}`));
        return;
      }
      recordSuccess();
    } catch (err) {
      if (localController.signal.aborted) return;
      recordFailure(err);
    }
  }

  // ---- Circuit breaker UX ----

  function recordSuccess() {
    if (consecutiveFailures !== 0 || circuitOpen) {
      consecutiveFailures = 0;
      if (circuitOpen) {
        circuitOpen = false;
        try {
          onCircuitClose();
        } catch (err) {
          onError(err);
        }
      }
    }
  }

  function recordFailure(err) {
    stats.failures += 1;
    consecutiveFailures += 1;
    onError(err);
    if (!circuitOpen && consecutiveFailures >= CIRCUIT_TRIP_AFTER) {
      circuitOpen = true;
      stats.circuitTrips += 1;
      try {
        onCircuitTrip();
      } catch (e) {
        onError(e);
      }
      scheduleProbe();
    }
  }

  function scheduleProbe() {
    if (probeTimer) clearTimer(probeTimer);
    probeTimer = setTimer(() => {
      probeTimer = null;
      return probe();
    }, CIRCUIT_PROBE_INTERVAL_MS);
    // If the underlying timer is a Node Timeout, unref so it doesn't keep
    // the process alive after tests complete.
    if (probeTimer && typeof probeTimer.unref === "function") probeTimer.unref();
  }

  async function probe() {
    if (!circuitOpen) return;
    try {
      const probeImage = await canvasToBase64Png(canvas).catch(() => "");
      const probeResult = await submit({
        proxyUrl,
        mode: "fast",
        image: probeImage,
        prompt: "ping",
        settings: { probe: true, maxTokens: 1 },
        signal: new AbortController().signal,
        userKey
      });
      // We don't care about content; reaching here without throw = success.
      if (probeResult?.response && probeResult.response.status >= 500) {
        scheduleProbe();
        return;
      }
      // Drain a few events so the underlying connection closes cleanly.
      try {
        const iter = probeResult.stream?.[Symbol.asyncIterator]?.();
        if (iter) {
          for (let i = 0; i < 4; i += 1) {
            const next = await iter.next();
            if (next.done) break;
          }
          if (typeof iter.return === "function") await iter.return();
        }
      } catch {
        // ignore
      }
      circuitOpen = false;
      consecutiveFailures = 0;
      try {
        onCircuitClose();
      } catch (err) {
        onError(err);
      }
    } catch (err) {
      onError(err);
      scheduleProbe();
    }
  }

  // ---- Lifecycle ----

  function start() {
    if (started || !canvas) return;
    started = true;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
  }

  function stop() {
    // Always clear timers + abort in-flight even if start() was never called.
    // Without this, tests that exercise breaker/probe paths without calling
    // start() leave a 60s real setTimeout dangling, which node:test waits to
    // drain — burning minutes of test runtime.
    if (debounceTimer) clearTimer(debounceTimer);
    if (idleTimer) clearTimer(idleTimer);
    if (probeTimer) clearTimer(probeTimer);
    if (inflightController) {
      try {
        inflightController.abort();
      } catch {
        // ignore
      }
    }
    if (!started || !canvas) return;
    started = false;
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
  }

  return {
    start,
    stop,
    triggerNow: trySubmit,
    getStats: () => ({ ...stats, circuitOpen, consecutiveFailures }),
    _internal: {
      // Hooks for unit tests.
      setLastHash(h) {
        lastHash = h;
      },
      getLastHash() {
        return lastHash;
      },
      recordFailureForTest: recordFailure,
      recordSuccessForTest: recordSuccess,
      probeForTest: probe,
      forceCircuitOpenForTest() {
        circuitOpen = true;
        scheduleProbe();
      },
      isCircuitOpen() {
        return circuitOpen;
      }
    }
  };
}

/**
 * Render the canvas to a 256x256 base64-encoded PNG `data:` URI.
 *
 * The Worker accepts either a full data URI (Groq's `image_url.url` field can
 * be either a public URL or a base64 data URI) or just the base64 payload —
 * we send the data URI so all three providers' SDKs can interpret it.
 *
 * In headless test environments where `toDataURL` doesn't exist, returns "".
 */
export async function canvasToBase64Png(canvas) {
  if (!canvas) return "";
  if (typeof canvas.toDataURL !== "function" && typeof canvas.convertToBlob !== "function") {
    return "";
  }

  const targetW = 256;
  const targetH = 256;

  // Downsample via an offscreen 256x256 canvas.
  let off;
  if (typeof OffscreenCanvas !== "undefined") {
    off = new OffscreenCanvas(targetW, targetH);
  } else if (typeof document !== "undefined") {
    off = document.createElement("canvas");
    off.width = targetW;
    off.height = targetH;
  } else {
    return "";
  }

  const ctx = off.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(canvas, 0, 0, targetW, targetH);

  if (typeof off.convertToBlob === "function") {
    const blob = await off.convertToBlob({ type: "image/png" });
    return await blobToDataUri(blob);
  }
  return off.toDataURL("image/png");
}

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
