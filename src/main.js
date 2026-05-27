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

// M2 judge enablement flag — opt-in via localStorage until M3 wires the
// settings panel. Read once at module load so we can fire the lazy import
// only when the user has explicitly turned the judge on.
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

async function maybeWireStreamingJudge() {
  if (!isJudgeEnabledFromStorage() || !CONFIG.llmJudge?.enabled === false) {
    // Still allow `?judge=on` URL override for ad-hoc enable without touching localStorage.
    try {
      if (typeof window !== "undefined") {
        const u = new URL(window.location.href);
        if (u.searchParams.get("judge") !== "on" && !isJudgeEnabledFromStorage()) return;
      } else {
        return;
      }
    } catch {
      return;
    }
  }
  try {
    const { createStreamingJudge } = await import("./parser/llmJudge/streamingJudge.js");
    const judge = createStreamingJudge({
      canvas: elements.glyphCanvas,
      proxyUrl: CONFIG.llmJudge.proxyUrl,
      mode: CONFIG.llmJudge.mode,
      groqHeadStartMs: CONFIG.llmJudge.groqHeadStartMs,
      diffThreshold: CONFIG.llmJudge.diffThreshold,
      idleTickMs: CONFIG.llmJudge.idleTickMs,
      debounceMs: CONFIG.llmJudge.debounceMs,
      alwaysCritique: CONFIG.llmJudge.alwaysCritique,
      dictionary,
      onPartial: (partial, source) => {
        // M2 logs only; M3 connects this to the overlay / panel UI.
        console.debug("[judge.partial]", source, partial);
      },
      onFinal: (final, source) => {
        console.debug("[judge.final]", source, final);
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
      },
      onCircuitClose: () => {
        console.info("[judge] circuit closed");
        try {
          showJudgeCloseToast();
        } catch {
          // ignore
        }
      },
      onGuessRevised: (info) => {
        console.debug("[judge.guessRevised]", info);
      }
    });
    judge.start();
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
