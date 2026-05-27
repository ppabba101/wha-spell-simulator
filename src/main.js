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
import { createGlowOnClosure } from "./renderer/effects/glowOnClosure.js";
import {
  initPaperTexture,
  setPaperTextureEnabled
} from "./renderer/effectsPixi/paperTexture.js";
import {
  setBloomEnabled,
  setBloomQuality,
  getBloomFilter
} from "./renderer/effectsPixi/bloomPass.js";
import { preloadStage } from "./renderer/effectsPixi/stage.js";
import { compositeElementEffect } from "./renderer/effectsPixi/compositor.js";

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

// M7a — glow-on-closure controller and the latched "previously-active" flag
// used to fire the glow exactly once per ring closure (i.e. when the spell
// transitions from prepared/invalid to active).
let glowOnClosure = null;
let wasActive = false;

// M7b — PixiJS effect stage handles. The stage is lazy-loaded on the first
// pointerdown (Architect T6 — relocated trigger). Until then `pixi.js` is NOT
// in the entry chunk's import graph; the structural test in
// `tests/effectsPixi/stage.test.js` asserts this against the Vite build.
let pixiStagePreloaded = false;

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

  // M7a — dispatch spell:compiled (qualityPanel and other M5 surfaces listen
  // on window for this event) and trigger the glow-on-closure animation when
  // the ring just closed (transition from non-active to active).
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("spell:compiled", { detail: { spellIR } }));
    } catch {
      // ignore — best-effort notification
    }
  }
  const nowActive = Boolean(spellIR?.active);
  if (nowActive && !wasActive && glowOnClosure) {
    const ring = pipeline?.ring ?? pipeline?.glyphAST?.ring ?? null;
    if (ring?.found) {
      // The glow handle is canvas-agnostic; we pass the ring centre + radius
      // through the trigger options so it works without knowing about pipelines.
      glowOnClosure.trigger(spellIR, {
        center: ring.center,
        radius: ring.radius
      });
    }
  }
  wasActive = nowActive;
}

function animationFrame(timestamp) {
  // M7a — prepared spells (open ring on a valid glyphAST) render at 50%
  // opacity until the user closes the ring. Active / failed / idle states
  // render at full opacity.
  const inkAlphaScale = spellIR?.prepared ? 0.5 : 1;
  renderer.renderGlyph({
    strokes: store.getStrokes(),
    currentStroke: capture.getCurrentStroke(),
    pipeline,
    showGuides: elements.guidesToggle.checked,
    showDebug: elements.diagnosticsToggle.checked,
    inkAlphaScale
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

  // M7a — glow-on-closure composites on top of the effect canvas. The
  // controller is a no-op until trigger() is called from recompute() on
  // the prepared→active transition.
  if (glowOnClosure?.isPlaying()) {
    glowOnClosure.renderFrame();
  }

  // M7b — PixiJS compositor. The compositor is itself lazy; it returns
  // immediately if the stage hasn't been preloaded yet. When the active
  // spell has a known element + ring, we layer the per-element shader on
  // top of the Canvas-2D effect. GLSL-failed elements fall back to a
  // flat-tinted Canvas-2D disc drawn into `#effectPixiCanvas`.
  if (
    spellIR?.active &&
    spellIR.valid &&
    !spellIR.prepared &&
    pipeline?.ring?.found &&
    typeof spellIR.element === "string"
  ) {
    const pixiCanvas = elements.effectPixiCanvas ?? null;
    const fallbackCtx = pixiCanvas?.getContext?.("2d") ?? null;
    // Best-effort: never let a compositor error tear down the main loop.
    try {
      compositeElementEffect({
        element: spellIR.element,
        ring: pipeline.ring,
        timestamp,
        fallbackCtx,
        intensity: 1
      });
    } catch (err) {
      // Logged once; subsequent frames silently skip Pixi.
      console.warn("[effectsPixi] composite error:", err?.message ?? err);
    }
  }
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

      // M7b — Graphics hot-swap. Each toggle mutates the corresponding Pixi
      // filter / emitter without re-mounting the stage. The PixiJS app
      // renderer identity is preserved (Critic iter-3 Open Q#4) — the
      // Playwright test asserts `__pixiAppRendererId` is stable across toggles.
      if (detail.section === "graphics" && detail.patch) {
        if ("bloom" in detail.patch) {
          setBloomEnabled(!!detail.patch.bloom);
        }
        if ("paperTexture" in detail.patch) {
          setPaperTextureEnabled(!!detail.patch.paperTexture);
        }
        if ("particleQuality" in detail.patch) {
          setBloomQuality(detail.patch.particleQuality);
        }
      }
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

  // M7a — Canvas-2D glow-on-closure handle. We render onto the effect canvas
  // so the silver flash + sparks composite *above* the spell effect canvas
  // pass while staying below any future M7b Pixi overlay.
  glowOnClosure = createGlowOnClosure({ canvas: elements.effectCanvas });

  // M7b — Paper texture substrate. Pure Canvas-2D; initialises immediately
  // so the parchment drift is visible from first paint. Gated by the
  // graphics.paperTexture setting (default ON).
  if (elements.paperCanvas) {
    initPaperTexture(elements.paperCanvas);
    const initial = readSettings();
    setPaperTextureEnabled(initial.graphics?.paperTexture !== false);
  }

  // M7b — Lazy-load the PixiJS effect stage on the FIRST pointerdown.
  // Architect T6 relocated this trigger from "first ring closure" so the
  // closure flash itself doesn't pay the cold-cache cost.
  if (elements.glyphCanvas) {
    const onFirstPointerDown = () => {
      if (pixiStagePreloaded) return;
      pixiStagePreloaded = true;
      try {
        preloadStage().then(() => {
          // Wire bloom once the stage is up.
          const initial = readSettings();
          if (initial.graphics?.bloom !== false) {
            getBloomFilter().then((f) => {
              if (f) {
                setBloomEnabled(true);
                setBloomQuality(initial.graphics?.particleQuality ?? "high");
              }
            });
          }
        });
      } catch (err) {
        console.warn("[effectsPixi] preload failed:", err?.message ?? err);
      }
    };
    elements.glyphCanvas.addEventListener("pointerdown", onFirstPointerDown, { once: true });
  }
  // Expose for headless tests so Playwright can poll the controller state.
  try {
    if (typeof window !== "undefined") {
      window.__glowOnClosure = glowOnClosure;
      // M7b — expose Pixi handles for Playwright. The stage is lazy; this
      // accessor resolves to the live PIXI.Application once preloaded so
      // tests can assert renderer identity across hot-swaps.
      window.__effectsPixi = {
        getApp: async () => {
          const mod = await import("./renderer/effectsPixi/stage.js");
          try {
            return await mod.getStage();
          } catch {
            return null;
          }
        },
        getFailedElements: async () => {
          const mod = await import("./renderer/effectsPixi/stage.js");
          return Array.from(mod.getFailedElements());
        },
        markFailed: async (element) => {
          const mod = await import("./renderer/effectsPixi/stage.js");
          mod.__markElementFailed(element);
        }
      };
    }
  } catch {
    // ignore
  }

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
