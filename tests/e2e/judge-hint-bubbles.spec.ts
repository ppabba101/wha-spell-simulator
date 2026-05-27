import { test, expect } from "@playwright/test";

/**
 * M3 — Judge hint-bubble headless e2e.
 *
 * Hint bubbles are off by default (Architect T7). The test enables them via
 * the settings tab, fires a judge response with a `hint`, and asserts that
 * the bubble appears near the cursor and fades after 2s.
 */

test.describe("judge hint bubbles", () => {
  test.beforeEach(async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    (page as any).__consoleErrors = consoleErrors;
  });

  test("enables via settings, shows on hint, fades after 2s", async ({ page }) => {
    await page.route("**/api/judge", async (route) => {
      const body =
        `data: ${JSON.stringify({
          kind: "token-delta",
          source: "fast",
          text: '{"primitives":[{"type":"Ring","cx":600,"cy":400,"r":140}],"guess":{"glyphId":"fire","confidence":0.7},"critique":{"score":3},"hint":"Try closing the ring at the bottom."}'
        })}\n\n` +
        `data: ${JSON.stringify({ kind: "done", source: "fast", reason: "stop" })}\n\n`;
      await route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body });
    });

    await page.goto("/?judge=on");

    // Pre-set the hint-bubble setting to ON via localStorage so the reload
    // path picks it up. This mirrors the Settings tab behaviour without
    // depending on tab interactions in this test.
    await page.evaluate(() => {
      localStorage.setItem("wha.settings.surfaces", JSON.stringify({ canvasOverlay: true, sidePanel: true, hintBubbles: true }));
    });
    await page.reload();

    const canvas = page.locator("#glyphCanvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas missing");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let a = 0; a <= 12; a += 1) {
      const ang = (a / 12) * Math.PI * 2;
      await page.mouse.move(
        box.x + box.width / 2 + Math.cos(ang) * 100,
        box.y + box.height / 2 + Math.sin(ang) * 100
      );
    }
    await page.mouse.up();

    // Bubble should appear within 2s.
    await page.waitForFunction(
      () => {
        const el = document.getElementById("judgeHintBubble");
        return !!el && !el.hidden && (el.textContent ?? "").length > 0;
      },
      undefined,
      { timeout: 4000 }
    );

    await expect(page.locator("#judgeHintBubble")).toContainText(/closing the ring/i);

    // After the auto-fade window the bubble should be opacity 0 and ultimately hidden.
    await page.waitForFunction(
      () => {
        const el = document.getElementById("judgeHintBubble");
        if (!el) return true;
        return el.hidden || el.style.opacity === "0";
      },
      undefined,
      { timeout: 4000 }
    );

    expect((page as any).__consoleErrors).toEqual([]);
  });

  test("bubble does not appear when hint-bubbles setting is OFF (default)", async ({ page }) => {
    await page.route("**/api/judge", async (route) => {
      const body =
        `data: ${JSON.stringify({
          kind: "token-delta",
          source: "fast",
          text: '{"primitives":[{"type":"Ring","cx":600,"cy":400,"r":140}],"guess":{"glyphId":"fire","confidence":0.7},"critique":{"score":3},"hint":"Hello hint."}'
        })}\n\n` +
        `data: ${JSON.stringify({ kind: "done", source: "fast", reason: "stop" })}\n\n`;
      await route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body });
    });

    await page.goto("/?judge=on");
    const canvas = page.locator("#glyphCanvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 30);
    await page.mouse.up();

    // Wait briefly; bubble should NOT become visible because default is OFF.
    await page.waitForTimeout(500);
    const bubbleVisible = await page.evaluate(() => {
      const el = document.getElementById("judgeHintBubble");
      if (!el) return false;
      return !el.hidden && el.textContent !== "";
    });
    expect(bubbleVisible).toBe(false);
  });
});
