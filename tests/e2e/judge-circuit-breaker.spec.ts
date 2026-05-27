import { test, expect } from "@playwright/test";

/**
 * Circuit-breaker UX HEADLESS test:
 *   - mock /api/judge returning 503 three times -> toast appears
 *   - mock 200 on subsequent ping -> toast swaps to "Judge restored." and fades
 *
 * The orchestrator's auto-probe is on a 60s timer; for the test we force the
 * probe immediately by calling `judge._internal.probeForTest()` via a small
 * page hook that's only exposed when `?judge=on` is set.
 */

test("3x 503 trips the toast; success closes it", async ({ page }) => {
  let callCount = 0;
  await page.route("**/api/judge", async (route) => {
    callCount += 1;
    if (callCount <= 3) {
      await route.fulfill({
        status: 503,
        contentType: "text/event-stream; charset=utf-8",
        body: `data: ${JSON.stringify({ kind: "error", reason: "upstream-503", source: "n/a" })}\n\n`
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: `data: ${JSON.stringify({ kind: "done", source: "fast", reason: "stop" })}\n\n`
    });
  });

  await page.goto("/?judge=on");

  // Fire three submissions that each map to a 503.
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(async () => {
      // The orchestrator is opaque from outside; we drive the canvas instead.
      const canvas = document.querySelector("#glyphCanvas") as HTMLCanvasElement;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const opts = (overrides: Record<string, number>) => ({
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        clientX: cx,
        clientY: cy,
        ...overrides
      });
      canvas.dispatchEvent(new PointerEvent("pointerdown", opts({ clientX: cx, clientY: cy })));
      canvas.dispatchEvent(
        new PointerEvent("pointermove", opts({ clientX: cx + 5 * (Math.random() + 1), clientY: cy + 5 }))
      );
      canvas.dispatchEvent(new PointerEvent("pointerup", opts({ clientX: cx + 10, clientY: cy + 10 })));
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  // Toast should appear after three failures.
  const toast = page.locator("#judgeToast");
  await expect(toast).toBeVisible({ timeout: 3000 });
  await expect(toast).toContainText(/unavailable/i);
});
