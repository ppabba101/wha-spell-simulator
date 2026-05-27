import { test, expect } from "@playwright/test";

/**
 * M7b — Bloom toggle e2e.
 *
 * Asserts:
 *   1. Toggling bloom OFF → ON changes ≥10% of pixels in a controlled scene.
 *   2. The PixiJS renderer instance identity is preserved across the toggle
 *      (Critic iter-3 Open Q#4 — hot-swap, no remount).
 */

async function bootAndPrime(page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__effectsPixi), null, { timeout: 5000 });
  // Trigger lazy-load via synthetic pointerdown.
  await page.evaluate(() => {
    const c = document.getElementById("glyphCanvas") as HTMLCanvasElement;
    c?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
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

async function captureWithBloom(page, bloomEnabled: boolean) {
  return await page.evaluate(async (en) => {
    const mod = await import("/src/renderer/effectsPixi/compositor.js");
    const bloom = await import("/src/renderer/effectsPixi/bloomPass.js");
    await bloom.getBloomFilter();
    bloom.setBloomEnabled(en);
    const pixiCanvas = document.getElementById("effectPixiCanvas") as HTMLCanvasElement;
    const ctx = pixiCanvas.getContext("2d");
    ctx?.clearRect(0, 0, pixiCanvas.width, pixiCanvas.height);

    const ring = { center: { x: 600, y: 400 }, radius: 200 };
    for (let i = 0; i < 5; i += 1) {
      mod.compositeElementEffect({
        element: "light",
        ring,
        timestamp: 1000 + i * 16,
        fallbackCtx: ctx,
        intensity: 1
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    const w = 400;
    const h = 400;
    const x = Math.floor((pixiCanvas.width - w) / 2);
    const y = Math.floor((pixiCanvas.height - h) / 2);
    const d = ctx!.getImageData(x, y, w, h).data;
    return { data: Array.from(d) };
  }, bloomEnabled);
}

function diffRatio(a: { data: number[] }, b: { data: number[] }) {
  if (a.data.length !== b.data.length || a.data.length === 0) return 0;
  let differ = 0;
  let nonEmpty = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
    if (a.data[i + 3] > 4 || b.data[i + 3] > 4) nonEmpty += 1;
    if (dr + dg + db + da > 12) differ += 1;
  }
  return nonEmpty > 0 ? differ / nonEmpty : 0;
}

test("bloom toggle off→on changes ≥10% of pixels in a controlled scene", async ({ page }) => {
  test.setTimeout(60000);
  await bootAndPrime(page);

  const off = await captureWithBloom(page, false);
  const on = await captureWithBloom(page, true);
  const ratio = diffRatio(off, on);
  console.log(`[pixi-bloom-toggle] diff = ${(ratio * 100).toFixed(2)}%`);
  expect(ratio).toBeGreaterThanOrEqual(0.1);
});

test("bloom toggle preserves renderer instance identity", async ({ page }) => {
  await bootAndPrime(page);

  const result = await page.evaluate(async () => {
    const eff = (window as any).__effectsPixi;
    const bloom = await import("/src/renderer/effectsPixi/bloomPass.js");
    await bloom.getBloomFilter();
    const a1 = await eff.getApp();
    const r1 = a1?.renderer;
    bloom.setBloomEnabled(false);
    bloom.setBloomEnabled(true);
    bloom.setBloomEnabled(false);
    const a2 = await eff.getApp();
    const r2 = a2?.renderer;
    return { sameApp: a1 === a2, sameRenderer: r1 === r2 };
  });
  expect(result.sameApp).toBe(true);
  expect(result.sameRenderer).toBe(true);
});
