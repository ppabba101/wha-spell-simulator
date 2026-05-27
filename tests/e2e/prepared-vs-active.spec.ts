import { test, expect } from "@playwright/test";

/**
 * M7a — Prepared-vs-active visual distinction.
 *
 * Contract:
 *   - When the spell is `prepared` (open ring), glyph ink renders at ≤60%
 *     opacity (target: 50%); no glow fires.
 *   - When the spell becomes `active` (ring closed via the closing dot), the
 *     glyph returns to full opacity and the glow controller is triggered.
 *
 * The e2e harness drives the visual state directly via the rendered ink
 * alpha — Playwright reads pixel alpha samples from the glyph canvas after
 * the renderer ticks. We do not exercise the recognition pipeline here; that
 * is covered by the prepared-spells.spec.ts (M4) and parser unit tests.
 */

async function bootApp(page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__glowOnClosure), null, { timeout: 5000 });
}

async function drawDarkLineOnGlyphCanvas(page, alphaScale: number) {
  // Render a thick black line into the glyph canvas through the renderer's
  // drawStrokes path. The renderer multiplies the ink alpha by inkAlphaScale,
  // so we can sample alpha downstream to confirm the dimming contract.
  return page.evaluate(async (alpha) => {
    const mod = await import("/src/renderer/glyphOverlayRenderer.js");
    const canvas = document.getElementById("glyphCanvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Synthetic stroke shaped like a horizontal bar in the centre.
    const points: Array<{ x: number; y: number; pressure: number }> = [];
    for (let i = 0; i < 40; i += 1) {
      points.push({ x: 400 + i * 10, y: 400, pressure: 0.5 });
    }
    const stroke = { id: "synthetic", points };
    const fakeConfig = { renderer: { inkColor: "#000000" } };
    mod.drawStrokes(ctx, [stroke], null, fakeConfig, { inkAlphaScale: alpha });
    // Sample the alpha along the bar.
    const sample = ctx.getImageData(450, 400, 200, 1).data;
    let opaqueCount = 0;
    let alphaSum = 0;
    for (let i = 0; i < sample.length; i += 4) {
      const a = sample[i + 3];
      if (a > 0) {
        opaqueCount += 1;
        alphaSum += a;
      }
    }
    return {
      opaqueCount,
      avgAlpha: opaqueCount > 0 ? alphaSum / opaqueCount : 0
    };
  }, alphaScale);
}

test("prepared spell renders glyph ink at ≤60% opacity (50% target)", async ({ page }) => {
  await bootApp(page);

  // Prepared spells dim ink to 50% per main.js wiring. We exercise the
  // renderer path with inkAlphaScale=0.5 to confirm the alpha samples.
  const result = await drawDarkLineOnGlyphCanvas(page, 0.5);
  expect(result.opaqueCount).toBeGreaterThan(20);
  // Expected alpha for a 0.94-base ink rendered at 0.5 inkAlphaScale: ≈ 120
  // out of 255. Cap at 60% (153) per spec.
  expect(result.avgAlpha).toBeLessThanOrEqual(153);
  expect(result.avgAlpha).toBeGreaterThan(50);
});

test("active spell renders glyph ink at full opacity", async ({ page }) => {
  await bootApp(page);
  const result = await drawDarkLineOnGlyphCanvas(page, 1);
  expect(result.opaqueCount).toBeGreaterThan(20);
  // 0.94 base alpha => ≈ 240 out of 255.
  expect(result.avgAlpha).toBeGreaterThan(180);
});

test("prepared spell does NOT fire glow", async ({ page }) => {
  await bootApp(page);
  const fired = await page.evaluate(() => {
    const handle = (window as any).__glowOnClosure;
    return handle.trigger(
      { active: false, prepared: true, element: "fire" },
      { center: { x: 600, y: 400 }, radius: 200 }
    );
  });
  expect(fired).toBe(false);
});

test("transition prepared → active fires glow on closure", async ({ page }) => {
  await bootApp(page);
  // Simulate "ring closed via the Fire button": flip directly to active.
  const fired = await page.evaluate(() => {
    const handle = (window as any).__glowOnClosure;
    // First, prepared call (no-op).
    handle.trigger(
      { active: false, prepared: true, element: "fire" },
      { center: { x: 600, y: 400 }, radius: 200 }
    );
    const wasPlayingPrepared = handle.isPlaying();
    // Now the active call should trigger.
    const triggered = handle.trigger(
      { active: true, element: "fire" },
      { center: { x: 600, y: 400 }, radius: 200 }
    );
    return {
      wasPlayingPrepared,
      triggered,
      isPlayingActive: handle.isPlaying()
    };
  });
  expect(fired.wasPlayingPrepared).toBe(false);
  expect(fired.triggered).toBe(true);
  expect(fired.isPlayingActive).toBe(true);
});
