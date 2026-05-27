/**
 * Judge side-panel (M3 surface 2 of 3).
 *
 * Streaming critique tab living inside the existing right-hand <aside>.
 *
 * Layout sections (top to bottom):
 *   - Model + status banner ("Groq Maverick - streaming...")
 *   - Streaming critique text (token-by-token, fed by judge .partial events)
 *   - Confidence bar (guess.glyphId + percentage)
 *   - Latency display (TTFT + total ms)
 *   - Primitive count + rubric meters (closure / cleanliness / continuity /
 *     recognizability / score, all 1-5)
 *
 * The module is mount-once; toggling visibility lives at the panel-tab level
 * (handled by setupTabs in tabs.js). Resetting wipes per-spell state without
 * destroying DOM listeners.
 */

const RUBRIC_KEYS = ["closure", "cleanliness", "continuity", "recognizability", "score"];

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function fmtMs(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  return `${Math.round(ms)}ms`;
}

function rubricBucketLevel(value) {
  if (!Number.isFinite(value)) return "low";
  if (value >= 4) return "high";
  if (value >= 3) return "medium";
  return "low";
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.mountEl
 * @param {object} [opts.settings]
 */
export function createJudgePanel({ mountEl, settings = {} } = {}) {
  if (!mountEl) {
    return {
      onPartial() {},
      onFinal() {},
      onGuessRevised() {},
      onCircuitTrip() {},
      onCircuitClose() {},
      reset() {},
      destroy() {}
    };
  }

  // Inject the panel structure once.
  mountEl.innerHTML = `
    <section class="judge-panel" aria-label="Judge insight">
      <div class="judge-status-banner" data-judge-status="idle">
        <div class="judge-status-text">
          <strong id="judgeModelName">Judge idle</strong>
          <span id="judgeStatusMessage">Draw to consult the judge.</span>
        </div>
        <span class="judge-spinner" id="judgeSpinner" hidden></span>
      </div>

      <div class="judge-section">
        <h3>Streaming critique</h3>
        <div class="judge-critique" id="judgeCritiqueBody" aria-live="polite"></div>
        <p class="judge-hint-line" id="judgeHintLine" hidden></p>
      </div>

      <div class="judge-section">
        <h3>Guess</h3>
        <div class="judge-confidence-row">
          <strong id="judgeGuessGlyph">—</strong>
          <span class="judge-confidence-value" id="judgeConfidenceValue">0%</span>
        </div>
        <div class="judge-confidence-bar"><span id="judgeConfidenceBar"></span></div>
        <p class="judge-revised-line" id="judgeRevisedLine" hidden></p>
      </div>

      <div class="judge-section judge-latency-row">
        <div>
          <span class="judge-meta-label">TTFT</span>
          <strong id="judgeTtft">—</strong>
        </div>
        <div>
          <span class="judge-meta-label">Total</span>
          <strong id="judgeTotalLatency">—</strong>
        </div>
        <div>
          <span class="judge-meta-label">Primitives</span>
          <strong id="judgePrimitiveCount">0</strong>
        </div>
      </div>

      <div class="judge-section">
        <h3>Rubric (1–5)</h3>
        <div class="judge-rubric" id="judgeRubric">
          ${RUBRIC_KEYS.map(
            (k) => `
            <div class="judge-rubric-row" data-rubric-key="${k}">
              <span class="judge-rubric-label">${k[0].toUpperCase()}${k.slice(1)}</span>
              <div class="judge-rubric-meter"><span></span></div>
              <span class="judge-rubric-value">—</span>
            </div>
          `
          ).join("")}
        </div>
      </div>
    </section>
  `;

  const refs = {
    statusBanner: mountEl.querySelector(".judge-status-banner"),
    modelName: mountEl.querySelector("#judgeModelName"),
    statusMessage: mountEl.querySelector("#judgeStatusMessage"),
    spinner: mountEl.querySelector("#judgeSpinner"),
    critiqueBody: mountEl.querySelector("#judgeCritiqueBody"),
    hintLine: mountEl.querySelector("#judgeHintLine"),
    guessGlyph: mountEl.querySelector("#judgeGuessGlyph"),
    confidenceValue: mountEl.querySelector("#judgeConfidenceValue"),
    confidenceBar: mountEl.querySelector("#judgeConfidenceBar"),
    revisedLine: mountEl.querySelector("#judgeRevisedLine"),
    ttft: mountEl.querySelector("#judgeTtft"),
    totalLatency: mountEl.querySelector("#judgeTotalLatency"),
    primitiveCount: mountEl.querySelector("#judgePrimitiveCount"),
    rubricRows: RUBRIC_KEYS.reduce((acc, key) => {
      acc[key] = mountEl.querySelector(`.judge-rubric-row[data-rubric-key="${key}"]`);
      return acc;
    }, {})
  };

  const state = {
    mode: settings?.judge?.mode ?? "parallel",
    firstTokenAt: null,
    submittedAt: null,
    lastEventAt: null,
    seenPrimitives: 0,
    streamingTextBySource: { fast: "", deep: "" },
    rubric: { closure: null, cleanliness: null, continuity: null, recognizability: null, score: null }
  };

  function setStatus(banner, model, message, opts = {}) {
    if (refs.statusBanner) refs.statusBanner.dataset.judgeStatus = banner;
    if (refs.modelName) refs.modelName.textContent = model;
    if (refs.statusMessage) refs.statusMessage.textContent = message;
    if (refs.spinner) refs.spinner.hidden = !opts.spinner;
  }

  function modelLabelForSource(source) {
    if (source === "fast") return "Groq Maverick";
    if (source === "deep") return "SambaNova Maverick";
    if (source === "anthropic") return "Anthropic Sonnet";
    return "Judge";
  }

  function startSubmissionIfNeeded(source) {
    if (state.submittedAt === null) {
      state.submittedAt = nowMs();
      setStatus("streaming", modelLabelForSource(source), "streaming…", { spinner: true });
      if (refs.critiqueBody) refs.critiqueBody.textContent = "";
      if (refs.hintLine) {
        refs.hintLine.textContent = "";
        refs.hintLine.hidden = true;
      }
    }
  }

  function maybeFirstToken() {
    if (state.firstTokenAt === null && state.submittedAt !== null) {
      state.firstTokenAt = nowMs();
      if (refs.ttft) refs.ttft.textContent = fmtMs(state.firstTokenAt - state.submittedAt);
    }
  }

  function renderCritiqueText(partial, source) {
    const critique = partial?.critique;
    const hint = partial?.hint;
    // We stream the per-source `critique` summary line + hint.
    if (typeof hint === "string" && hint.trim() && refs.hintLine) {
      refs.hintLine.hidden = false;
      refs.hintLine.textContent = `Hint: ${hint.trim()}`;
    }

    // Build a compact critique string from the rubric — even partial scores
    // give the user something to read while we wait for tokens.
    if (critique && typeof critique === "object") {
      const parts = [];
      for (const key of RUBRIC_KEYS) {
        const v = critique[key];
        if (Number.isFinite(v)) parts.push(`${key} ${v}`);
      }
      if (parts.length && refs.critiqueBody) {
        state.streamingTextBySource[source === "deep" ? "deep" : "fast"] = parts.join(" · ");
        refs.critiqueBody.textContent = [state.streamingTextBySource.fast, state.streamingTextBySource.deep]
          .filter(Boolean)
          .join("  ▸  ");
      }
    }
  }

  function renderGuess(partial) {
    const guess = partial?.guess;
    if (!guess || typeof guess !== "object") return;
    const glyphId = guess.glyphId;
    const conf = clamp01(Number(guess.confidence));
    if (typeof glyphId === "string" && refs.guessGlyph) refs.guessGlyph.textContent = glyphId;
    if (refs.confidenceValue) refs.confidenceValue.textContent = `${Math.round(conf * 100)}%`;
    if (refs.confidenceBar) refs.confidenceBar.style.width = `${conf * 100}%`;
  }

  function renderRubric(critique) {
    if (!critique || typeof critique !== "object") return;
    for (const key of RUBRIC_KEYS) {
      const v = critique[key];
      if (!Number.isFinite(v)) continue;
      state.rubric[key] = v;
      const row = refs.rubricRows[key];
      if (!row) continue;
      const meter = row.querySelector(".judge-rubric-meter span");
      const valueEl = row.querySelector(".judge-rubric-value");
      const pct = clamp01((v - 1) / 4) * 100;
      if (meter) {
        meter.style.width = `${pct}%`;
        meter.dataset.level = rubricBucketLevel(v);
      }
      if (valueEl) valueEl.textContent = String(v);
    }
  }

  function renderPrimitives(partial) {
    const primitives = partial?.primitives;
    if (!Array.isArray(primitives)) return;
    state.seenPrimitives = Math.max(state.seenPrimitives, primitives.length);
    if (refs.primitiveCount) refs.primitiveCount.textContent = String(state.seenPrimitives);
  }

  function onPartial(partial, source) {
    if (!partial || typeof partial !== "object") return;
    startSubmissionIfNeeded(source);
    maybeFirstToken();
    state.lastEventAt = nowMs();
    renderGuess(partial);
    renderCritiqueText(partial, source);
    renderRubric(partial?.critique);
    renderPrimitives(partial);
  }

  function onFinal(final, source) {
    if (!final || typeof final !== "object") {
      // Still mark as complete.
      finishStreaming(source);
      return;
    }
    renderGuess(final);
    renderCritiqueText(final, source);
    renderRubric(final?.critique);
    renderPrimitives(final);
    finishStreaming(source);
  }

  function finishStreaming(source) {
    const t = nowMs();
    state.lastEventAt = t;
    if (state.submittedAt !== null && refs.totalLatency) {
      refs.totalLatency.textContent = fmtMs(t - state.submittedAt);
    }
    setStatus("complete", modelLabelForSource(source), "complete", { spinner: false });
  }

  function onGuessRevised(info) {
    if (!refs.revisedLine) return;
    if (!info || typeof info !== "object") return;
    refs.revisedLine.hidden = false;
    refs.revisedLine.textContent = `Revised guess: ${info.from ?? "?"} → ${info.to ?? "?"} (deep override)`;
  }

  function onCircuitTrip() {
    setStatus("error", "Judge unavailable", "circuit tripped", { spinner: false });
  }

  function onCircuitClose() {
    setStatus("ready", "Judge restored", "ready", { spinner: false });
  }

  function reset() {
    state.firstTokenAt = null;
    state.submittedAt = null;
    state.lastEventAt = null;
    state.seenPrimitives = 0;
    state.streamingTextBySource = { fast: "", deep: "" };
    state.rubric = { closure: null, cleanliness: null, continuity: null, recognizability: null, score: null };
    if (refs.critiqueBody) refs.critiqueBody.textContent = "";
    if (refs.hintLine) {
      refs.hintLine.textContent = "";
      refs.hintLine.hidden = true;
    }
    if (refs.revisedLine) {
      refs.revisedLine.textContent = "";
      refs.revisedLine.hidden = true;
    }
    if (refs.guessGlyph) refs.guessGlyph.textContent = "—";
    if (refs.confidenceValue) refs.confidenceValue.textContent = "0%";
    if (refs.confidenceBar) refs.confidenceBar.style.width = "0%";
    if (refs.ttft) refs.ttft.textContent = "—";
    if (refs.totalLatency) refs.totalLatency.textContent = "—";
    if (refs.primitiveCount) refs.primitiveCount.textContent = "0";
    for (const row of Object.values(refs.rubricRows)) {
      const meter = row?.querySelector(".judge-rubric-meter span");
      const valueEl = row?.querySelector(".judge-rubric-value");
      if (meter) meter.style.width = "0%";
      if (valueEl) valueEl.textContent = "—";
    }
    setStatus("idle", "Judge idle", "Draw to consult the judge.", { spinner: false });
  }

  function destroy() {
    mountEl.innerHTML = "";
  }

  // Initial render snapshot.
  reset();

  return {
    onPartial,
    onFinal,
    onGuessRevised,
    onCircuitTrip,
    onCircuitClose,
    reset,
    destroy
  };
}
