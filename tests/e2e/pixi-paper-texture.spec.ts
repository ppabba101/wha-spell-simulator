import { test, expect } from "@playwright/test";

/**
 * M7b — Paper texture toggle e2e.
 *
 * Asserts toggling the paper-texture setting OFF → ON changes ≥10% of pixels
 * in a static empty scene (just the paper canvas, no spell active).
 *
 * The paper texture is pure Canvas-2D so this assertion does not depend on
 * the Pixi stage being mounted.
 */

async function bootApp(page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__effectsPixi), null, { timeout: 5000 });
  await page.waitForTimeout(200);
}

async function capturePaper(page, enabled: boolean) {
  return await page.evaluate(async (en) => {
    const mod = await import("/src/renderer/effectsPixi/paperTexture.js");
    const paperCanvas = document.getElementById("paperCanvas") as HTMLCanvasElement;
    mod.initPaperTexture(paperCanvas);
    mod.setPaperTextureEnabled(en);
    if (en) {
      // Force one render so the assertion is deterministic regardless of
      // RAF cadence.
      mod.renderOnce(paperCanvas, 1000);
    }
    const ctx = paperCanvas.getContext("2d");
    // Sample the whole canvas so the small per-pixel drift is detectable.
    const w = 400;
    const h = 400;
    const x = Math.floor((paperCanvas.width - w) / 2);
    const y = Math.floor((paperCanvas.height - h) / 2);
    const d = ctx!.getImageData(x, y, w, h).data;
    return { data: Array.from(d) };
  }, enabled);
}

function pixelDiffRatio(a: { data: number[] }, b: { data: number[] }) {
  if (a.data.length !== b.data.length || a.data.length === 0) return 0;
  let differ = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
    if (dr + dg + db + da > 4) differ += 1;
  }
  return differ / (a.data.length / 4);
}

test("paper texture toggle off→on changes ≥10% of pixels in a static empty scene", async ({ page }) => {
  await bootApp(page);

  const off = await capturePaper(page, false);
  const on = await capturePaper(page, true);
  const ratio = pixelDiffRatio(off, on);
  console.log(`[pixi-paper-texture] diff = ${(ratio * 100).toFixed(2)}%`);
  expect(ratio).toBeGreaterThanOrEqual(0.1);
});

test("paper texture toggle preserves canvas DOM identity (no remount)", async ({ page }) => {
  await bootApp(page);
  const result = await page.evaluate(async () => {
    const mod = await import("/src/renderer/effectsPixi/paperTexture.js");
    const before = document.getElementById("paperCanvas");
    mod.setPaperTextureEnabled(false);
    mod.setPaperTextureEnabled(true);
    mod.setPaperTextureEnabled(false);
    const after = document.getElementById("paperCanvas");
    return { same: before === after, hasContext: Boolean((before as HTMLCanvasElement)?.getContext("2d")) };
  });
  expect(result.same).toBe(true);
  expect(result.hasContext).toBe(true);
});
