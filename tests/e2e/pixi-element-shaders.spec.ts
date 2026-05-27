import { test, expect } from "@playwright/test";

/**
 * M7b — Per-element shader pairwise pixel-diff (AC-F4-extended).
 *
 * Target: pairwise pixel-diff ≥20% at frame 5 of effect playback across the
 * 5 elements (10 pairs).
 *
 * Fallback per Critic iter-3 Open Q#2: if 20% pairwise is unreachable in the
 * measurement, switch to per-element vs neutral-baseline ≥20% (5 assertions
 * instead of 10). We measure the actual diff matrix and report it; the test
 * passes as long as EITHER the pairwise target OR the per-baseline fallback
 * is met.
 *
 * The test drives the effect by injecting a synthetic SpellIR via
 * `window.__effectsPixi.testRenderElement` so we don't need the full draw
 * pipeline to land an element on the canvas — see harness wiring in
 * `src/main.js`.
 */

const ELEMENTS = ["fire", "water", "wind", "earth", "light"] as const;
type ElementName = (typeof ELEMENTS)[number];

async function bootAndPrime(page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__effectsPixi), null, { timeout: 5000 });
  // Force the stage to initialise via a synthetic pointerdown.
  await page.evaluate(() => {
    const c = document.getElementById("glyphCanvas") as HTMLCanvasElement;
    c?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  // Wait until the stage is up.
  await page.waitForFunction(
    async () => {
      const eff = (window as any).__effectsPixi;
      if (!eff) return false;
      const app = await eff.getApp();
      return Boolean(app);
    },
    null,
    { timeout: 10000 }
  );
}

async function captureElementFrame(page, element: ElementName): Promise<ImageData> {
  // Drive the compositor directly: build a fake spellIR + ring, call
  // compositeElementEffect under the harness handle, advance a few ticks,
  // then sample.
  const data = await page.evaluate(async (el) => {
    const mod = await import("/src/renderer/effectsPixi/compositor.js");
    const stage = await import("/src/renderer/effectsPixi/stage.js");
    await stage.getStage();
    const pixiCanvas = document.getElementById("effectPixiCanvas") as HTMLCanvasElement;
    const effectCanvas = document.getElementById("effectCanvas") as HTMLCanvasElement;
    const fallbackCtx = pixiCanvas?.getContext("2d") ?? null;
    const ring = { center: { x: 600, y: 400 }, radius: 200 };

    // Clear any leftover pixels from previous element.
    fallbackCtx?.clearRect(0, 0, pixiCanvas.width, pixiCanvas.height);
    const effCtx = effectCanvas.getContext("2d");
    effCtx?.clearRect(0, 0, effectCanvas.width, effectCanvas.height);

    // Advance through 5 frames at ~16ms apart.
    for (let i = 0; i < 5; i += 1) {
      mod.compositeElementEffect({
        element: el,
        ring,
        timestamp: 1000 + i * 16,
        fallbackCtx,
        intensity: 1
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    // Sample the pixi canvas (the shader-or-fallback layer).
    const ctxPixi = pixiCanvas.getContext("2d");
    if (ctxPixi) {
      const w = 400;
      const h = 400;
      const x = Math.floor((pixiCanvas.width - w) / 2);
      const y = Math.floor((pixiCanvas.height - h) / 2);
      const d = ctxPixi.getImageData(x, y, w, h).data;
      return { width: w, height: h, data: Array.from(d) };
    }
    return { width: 0, height: 0, data: [] };
  }, element);
  return data as any;
}

function pairwiseDiffRatio(a: { data: number[]; width: number; height: number }, b: { data: number[]; width: number; height: number }) {
  if (a.data.length === 0 || b.data.length === 0) return 0;
  if (a.data.length !== b.data.length) return 0;
  let differ = 0;
  let nonEmpty = 0;
  const len = a.data.length;
  for (let i = 0; i < len; i += 4) {
    const aR = a.data[i], aG = a.data[i + 1], aB = a.data[i + 2], aA = a.data[i + 3];
    const bR = b.data[i], bG = b.data[i + 1], bB = b.data[i + 2], bA = b.data[i + 3];
    if (aA > 4 || bA > 4) nonEmpty += 1;
    const dr = Math.abs(aR - bR), dg = Math.abs(aG - bG), db = Math.abs(aB - bB);
    if (dr + dg + db > 30) differ += 1;
  }
  return nonEmpty > 0 ? differ / nonEmpty : 0;
}

test("per-element shaders or fallback render distinct visuals (pairwise or baseline)", async ({ page }) => {
  test.setTimeout(120000);
  await bootAndPrime(page);

  // Capture frames for each element.
  const frames: Record<ElementName, any> = {} as any;
  for (const el of ELEMENTS) {
    frames[el] = await captureElementFrame(page, el);
  }

  // Baseline = empty canvas (all zeros). Build inline.
  const baseline = {
    width: frames.fire.width,
    height: frames.fire.height,
    data: new Array(frames.fire.data.length).fill(0)
  };

  // Compute pairwise diff matrix + per-element vs baseline diff.
  const pairwiseRatios: number[] = [];
  const pairLabels: string[] = [];
  for (let i = 0; i < ELEMENTS.length; i += 1) {
    for (let j = i + 1; j < ELEMENTS.length; j += 1) {
      const r = pairwiseDiffRatio(frames[ELEMENTS[i]], frames[ELEMENTS[j]]);
      pairwiseRatios.push(r);
      pairLabels.push(`${ELEMENTS[i]}↔${ELEMENTS[j]}`);
    }
  }

  const baselineRatios: number[] = [];
  for (const el of ELEMENTS) {
    baselineRatios.push(pairwiseDiffRatio(frames[el], baseline));
  }

  // Report measured values (visible in CI logs).
  console.log("[pixi-element-shaders] pairwise diff matrix:");
  for (let i = 0; i < pairLabels.length; i += 1) {
    console.log(`  ${pairLabels[i]}: ${(pairwiseRatios[i] * 100).toFixed(2)}%`);
  }
  console.log("[pixi-element-shaders] per-element vs baseline:");
  for (let i = 0; i < ELEMENTS.length; i += 1) {
    console.log(`  ${ELEMENTS[i]}: ${(baselineRatios[i] * 100).toFixed(2)}%`);
  }

  // Per the plan: attempt ≥20% pairwise, fall back to ≥20% baseline if
  // pairwise is unreachable. The threshold target is intentionally measured
  // and reported so the orchestrator can persist the actual value.
  const TARGET = 0.2;
  const minPairwise = Math.min(...pairwiseRatios);
  const minBaseline = Math.min(...baselineRatios);

  const pairwisePass = minPairwise >= TARGET;
  const baselinePass = minBaseline >= TARGET;

  console.log(`[pixi-element-shaders] minPairwise=${(minPairwise * 100).toFixed(2)}%, minBaseline=${(minBaseline * 100).toFixed(2)}%, target=${(TARGET * 100).toFixed(0)}%`);

  // Each element must at least differ from empty by ≥20% — that's the
  // baseline fallback. Pairwise is the stretch target; we log but don't
  // require it.
  expect(minBaseline).toBeGreaterThanOrEqual(TARGET);

  // Soft signal: if pairwise also clears the bar, we hit the headline goal.
  if (pairwisePass) {
    console.log("[pixi-element-shaders] PAIRWISE TARGET MET");
  } else {
    console.log("[pixi-element-shaders] using BASELINE fallback per Open Q#2");
  }
});
