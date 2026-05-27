import { CONFIG } from "./config.js";
import { loadDictionary } from "./dictionary/dictionaryLoader.js";
import { DrawingCapture } from "./input/drawingCapture.js";
import { createStrokeStore } from "./input/strokeStore.js";
import { classifyDrawing } from "./parser/drawingClassifier.js";
import { compileSpell } from "./compiler/spellBuilder.js";
import { CanvasRenderer } from "./renderer/canvasRenderer.js";
import { setupCanvasSizing as setupResponsiveCanvasSizing } from "./ui/canvasSizing.js";
import { updateDiagnostics, updateDiagnosticsMode } from "./ui/diagnosticsView.js";
import { getElements } from "./ui/elements.js";
import { renderDictionaryReference } from "./ui/dictionaryReferenceView.js";
import { updateStatus, updateSummary } from "./ui/spellSummaryView.js";
import { setupTabs } from "./ui/tabs.js";
import { maybeMountLatencyBench } from "./ui/latencyBench.js";
import { showTrip as showJudgeTripToast, showClose as showJudgeCloseToast } from "./ui/judgeToast.js";
import { createJudgeOverlay } from "./ui/judgeOverlay.js";
import { createJudgePanel } from "./ui/judgePanel.js";
import { createJudgeHintBubbles } from "./ui/judgeHintBubbles.js";
import { createSettingsPanel, readSettings } from "./ui/settingsPanel.js";

// M2 judge enablement flag — opt-in via localStorage / settings panel. The
// streaming judge orchestrator is wired in main; the settings panel keeps the
// legacy `wha.llmJudge.enabled` localStorage flag in sync.
function isJudgeEnabledFromStorage() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("wha.llmJudge.enabled") === "true";
  } catch {
    return false;
  }
}

const elements = getElements();
const store = createStrokeStore();
let dictionary = null;
let renderer = null;
let capture = null;
let pipeline = null;
let spellIR = null;
let previousRing = null;
let resizeObserver = null;

// M3 surface handles. Each is lazily attached based on the settings snapshot.
let judgeOverlay = null;
let judgePanel = null;
let judgeHintBubbles = null;
let settingsPanel = null;
let judgeOrchestrator = null;

function setupCanvasSizing() {
  resizeObserver = setupResponsiveCanvasSizing({
    elements,
    store,
    onCanvasResized: () => {
      previousRing = null;
      recompute();
    }
  });
}

function recompute() {
  if (!dictionary) {
    return;
  }

  pipeline = classifyDrawing({
    strokes: store.getStrokes(),
    previousRing,
    dictionary,
    config: CONFIG
  });
  previousRing = pipeline.ring;
  spellIR = compileSpell({ glyphAST: pipeline.glyphAST, dictionary, config: CONFIG });
  updateSummary({ elements, store, capture, pipeline, spellIR });
  updateDiagnostics({ elements, store, pipeline, spellIR });
}

function animationFrame(timestamp) {
  renderer.renderGlyph({
    strokes: store.getStrokes(),
    currentStroke: capture.getCurrentStroke(),
    pipeline,
    showGuides: elements.guidesToggle.checked,
    showDebug: elements.diagnosticsToggle.checked
  });

  if (spellIR.active) {
    renderer.renderActivatedGlyph({
      activatedAt: spellIR.activatedAt,
      duration: spellIR.duration,
      strokes: store.getStrokes(),
      pipeline,
      timestamp
    });
  }

  renderer.renderEffect({
    spellIR,
    ring: pipeline?.ring,
    timestamp,
    showGuides: elements.guidesToggle.checked
  });
  requestAnimationFrame(animationFrame);
}

function setupControls() {
  elements.undoButton.addEventListener("click", () => {
    store.undo();
    previousRing = null;
    recompute();
  });

  elements.clearButton.addEventListener("click", () => {
    store.clear();
    previousRing = null;
    recompute();
  });

  elements.guidesToggle.addEventListener("change", () => {
    updateSummary({ elements, store, capture, pipeline, spellIR });
    updateDiagnostics({ elements, store, pipeline, spellIR });
  });

  elements.diagnosticsToggle.addEventListener("change", () => {
    updateDiagnosticsMode(elements);
    updateDiagnostics({ elements, store, pipeline, spellIR });
  });

  updateDiagnosticsMode(elements);
}

function setupJudgeSurfaces() {
  const settings = readSettings();
  if (elements.judgeOverlayCanvas) {
    judgeOverlay = createJudgeOverlay({ canvas: elements.judgeOverlayCanvas, settings });
    judgeOverlay.setEnabled(settings.surfaces.canvasOverlay);
  }
  if (elements.judgeRootPanelMount) {
    judgePanel = createJudgePanel({ mountEl: elements.judgeRootPanelMount, settings });
  }
  if (elements.glyphCanvas) {
    judgeHintBubbles = createJudgeHintBubbles({ canvas: elements.glyphCanvas, settings });
    judgeHintBubbles.setEnabled(settings.surfaces.hintBubbles);
  }
  if (elements.settingsRootPanelMount) {
    settingsPanel = createSettingsPanel({ mountEl: elements.settingsRootPanelMount });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("settings:change", (ev) => {
      const detail = ev?.detail;
      const next = detail?.settings;
      if (!next) return;
      if (judgeOverlay) judgeOverlay.setEnabled(!!next.surfaces.canvasOverlay);
      if (judgeHintBubbles) judgeHintBubbles.setEnabled(!!next.surfaces.hintBubbles);
      // Hot-swap the judge orchestrator on enable/disable.
      if (detail.section === "judge" && detail.patch && "enabled" in detail.patch) {
        if (detail.patch.enabled) {
          maybeWireStreamingJudge();
        } else if (judgeOrchestrator) {
          try {
            judgeOrchestrator.stop();
          } catch {
            // ignore
          }
          judgeOrchestrator = null;
        }
      }
    });
  }
}

async function maybeWireStreamingJudge() {
  // Allow `?judge=on` URL override for ad-hoc enable without touching settings.
  let urlOverride = false;
  try {
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      urlOverride = u.searchParams.get("judge") === "on";
    }
  } catch {
    // ignore
  }
  const settings = readSettings();
  if (!urlOverride && !settings.judge.enabled && !isJudgeEnabledFromStorage()) {
    return;
  }
  if (judgeOrchestrator) {
    // Already wired.
    return;
  }
  try {
    const { createStreamingJudge } = await import("./parser/llmJudge/streamingJudge.js");
    judgeOrchestrator = createStreamingJudge({
      canvas: elements.glyphCanvas,
      proxyUrl: CONFIG.llmJudge.proxyUrl,
      mode: settings.judge.mode ?? CONFIG.llmJudge.mode,
      groqHeadStartMs: CONFIG.llmJudge.groqHeadStartMs,
      diffThreshold: CONFIG.llmJudge.diffThreshold,
      idleTickMs: CONFIG.llmJudge.idleTickMs,
      debounceMs: CONFIG.llmJudge.debounceMs,
      alwaysCritique: settings.judge.alwaysCritique ?? CONFIG.llmJudge.alwaysCritique,
      dictionary,
      onPartial: (partial, source) => {
        console.debug("[judge.partial]", source, partial);
        try {
          judgeOverlay?.onPartial(partial);
        } catch (err) {
          console.warn("[judge.overlay.partial]", err);
        }
        try {
          judgePanel?.onPartial(partial, source);
        } catch (err) {
          console.warn("[judge.panel.partial]", err);
        }
        try {
          if (typeof partial?.hint === "string" && partial.hint.trim()) {
            judgeHintBubbles?.onHint(partial.hint);
          }
        } catch (err) {
          console.warn("[judge.hint.partial]", err);
        }
      },
      onFinal: (final, source) => {
        console.debug("[judge.final]", source, final);
        try {
          judgeOverlay?.onFinal(final);
        } catch (err) {
          console.warn("[judge.overlay.final]", err);
        }
        try {
          judgePanel?.onFinal(final, source);
        } catch (err) {
          console.warn("[judge.panel.final]", err);
        }
        try {
          if (typeof final?.hint === "string" && final.hint.trim()) {
            judgeHintBubbles?.onHint(final.hint);
          }
        } catch (err) {
          console.warn("[judge.hint.final]", err);
        }
      },
      onError: (err) => {
        console.debug("[judge.error]", err?.message ?? err);
      },
      onCircuitTrip: () => {
        console.warn("[judge] circuit tripped");
        try {
          showJudgeTripToast();
        } catch {
          // ignore — toast is best-effort
        }
        try {
          judgePanel?.onCircuitTrip();
        } catch {
          // ignore
        }
      },
      onCircuitClose: () => {
        console.info("[judge] circuit closed");
        try {
          showJudgeCloseToast();
        } catch {
          // ignore
        }
        try {
          judgePanel?.onCircuitClose();
        } catch {
          // ignore
        }
      },
      onGuessRevised: (info) => {
        console.debug("[judge.guessRevised]", info);
        try {
          judgePanel?.onGuessRevised(info);
        } catch {
          // ignore
        }
      }
    });
    judgeOrchestrator.start();
  } catch (err) {
    console.warn("[judge] failed to initialise", err);
  }
}

async function init() {
  // Hidden `?latency-bench` route short-circuits the regular boot.
  if (maybeMountLatencyBench()) return;

  setupTabs(elements);
  setupControls();
  setupCanvasSizing();
  renderer = new CanvasRenderer({
    glyphCanvas: elements.glyphCanvas,
    effectCanvas: elements.effectCanvas,
    config: CONFIG
  });
  capture = new DrawingCapture(elements.glyphCanvas, store, CONFIG, {
    onPreview: () => {},
    onCommit: recompute
  });

  setupJudgeSurfaces();

  try {
    dictionary = await loadDictionary();
    renderDictionaryReference(elements, dictionary);
    capture.enable();
    recompute();
    requestAnimationFrame(animationFrame);
    // Fire-and-forget; never block the main path on judge wiring.
    maybeWireStreamingJudge();
  } catch (error) {
    console.error(error);
    updateStatus(elements, "Dictionary load failed", "invalid");
  }
}

init();
