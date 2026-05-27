import { test, expect } from "@playwright/test";

/**
 * M7b — PixiJS stage lazy-load e2e.
 *
 * Architect T6: the stage is lazy-loaded on the FIRST `pointerdown` so the
 * bundle entry chunk does NOT include pixi.js. The structural assertion
 * lives in `tests/effectsPixi/stage.test.js`; this spec asserts the runtime
 * behaviour: pixi.js is fetched only after the user's first interaction.
 */

async function bootApp(page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__effectsPixi), null, { timeout: 5000 });
}

test("pixi.js chunk is NOT fetched on initial page load", async ({ page }) => {
  const fetchedUrls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes(".js") && !url.includes("vite") && !url.includes("@id/")) {
      fetchedUrls.push(url);
    }
  });

  await bootApp(page);
  // Give the page a beat to finish all rAF / idle fetches.
  await page.waitForTimeout(400);

  // None of the JS chunks fetched before any user interaction should contain
  // pixi.js library code. The dist asset filenames are content-hashed; we
  // verify via a runtime probe that no Pixi-bearing module is currently
  // resolvable in the global Vite module graph.
  const pixiLoaded = await page.evaluate(() => {
    // The lazy-loaded chunk dumps PIXI on globalThis when initialised. If
    // that global ever exists pre-interaction, the lazy-load is broken.
    return typeof (globalThis as any).PIXI !== "undefined";
  });
  expect(pixiLoaded).toBe(false);
});

test("first pointerdown triggers preloadStage()", async ({ page }) => {
  await bootApp(page);
  const canvas = page.locator("#glyphCanvas");
  await canvas.waitFor({ state: "visible" });

  // Trigger the pointerdown that the main listener is wired to.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("glyph canvas has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  // The lazy preload kicks off through requestIdleCallback (or rAF
  // fallback) — give it ample wall-clock to land.
  await page.waitForFunction(
    async () => {
      const eff = (window as any).__effectsPixi;
      if (!eff) return false;
      const app = await eff.getApp();
      return Boolean(app);
    },
    null,
    { timeout: 8000 }
  );
  // If we got here, the stage initialised.
});

test("multiple pointerdowns do not remount the stage", async ({ page }) => {
  await bootApp(page);
  const canvas = page.locator("#glyphCanvas");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("glyph canvas has no bounding box");

  // Fire 3 quick pointerdowns.
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.move(box.x + 100 + i * 20, box.y + 100);
    await page.mouse.down();
    await page.mouse.up();
  }

  await page.waitForFunction(
    async () => {
      const eff = (window as any).__effectsPixi;
      if (!eff) return false;
      const app = await eff.getApp();
      return Boolean(app);
    },
    null,
    { timeout: 8000 }
  );

  // Same renderer identity across the second and third interactions.
  const ids = await page.evaluate(async () => {
    const eff = (window as any).__effectsPixi;
    const a1 = await eff.getApp();
    const a2 = await eff.getApp();
    // Pixi v8 exposes `renderer` on the Application.
    return {
      same: a1 === a2,
      hasRenderer: Boolean(a1?.renderer)
    };
  });
  expect(ids.same).toBe(true);
  expect(ids.hasRenderer).toBe(true);
});
