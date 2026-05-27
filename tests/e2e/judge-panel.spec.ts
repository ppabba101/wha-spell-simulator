import { test, expect } from "@playwright/test";

/**
 * M3 — Judge side-panel headless e2e.
 *
 * Mocks /api/judge to emit a partial with a guess, hint, and critique scores.
 * Asserts the Judge tab renders model name, streaming critique text,
 * confidence percentage, and the rubric meters.
 */

test.describe("judge panel", () => {
  test.beforeEach(async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    (page as any).__consoleErrors = consoleErrors;
  });

  test("Judge tab shows model name, critique text, confidence bar, primitive count", async ({ page }) => {
    await page.route("**/api/judge", async (route) => {
      const body =
        `data: ${JSON.stringify({
          kind: "token-delta",
          source: "fast",
          text: '{"primitives":[{"type":"Ring","cx":600,"cy":400,"r":140}],"guess":{"glyphId":"water","confidence":0.82},"critique":{"closure":4,"cleanliness":3,"continuity":4,"recognizability":4,"score":4},"hint":"Close the ring at the south arc."}'
        })}\n\n` +
        `data: ${JSON.stringify({ kind: "done", source: "fast", reason: "stop" })}\n\n`;
      await route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body });
    });

    let networkSawJudgePost = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/judge") && req.method() === "POST") networkSawJudgePost = true;
    });

    await page.goto("/?judge=on");

    // Click the Judge tab.
    await page.locator('button[data-panel-root="judgeRootPanel"]').click();
    await expect(page.locator("#judgeRootPanel")).toBeVisible();

    // Draw a quick ring to trigger the judge.
    const canvas = page.locator("#glyphCanvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas missing");
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2);
    await page.mouse.down();
    for (let a = 0; a <= 12; a += 1) {
      const ang = (a / 12) * Math.PI * 2;
      await page.mouse.move(
        box.x + box.width / 2 + Math.cos(ang) * 100,
        box.y + box.height / 2 + Math.sin(ang) * 100
      );
    }
    await page.mouse.up();

    // Wait for the guess to appear.
    await page.waitForFunction(
      () => {
        const el = document.getElementById("judgeGuessGlyph");
        return el && el.textContent && el.textContent.trim() === "water";
      },
      undefined,
      { timeout: 4000 }
    );

    await expect(page.locator("#judgeGuessGlyph")).toHaveText("water");
    await expect(page.locator("#judgeConfidenceValue")).toHaveText("82%");
    await expect(page.locator("#judgeModelName")).toContainText(/Groq|SambaNova|Judge/i);

    // Rubric values rendered.
    await expect(page.locator('.judge-rubric-row[data-rubric-key="score"] .judge-rubric-value')).toHaveText("4");
    await expect(page.locator('.judge-rubric-row[data-rubric-key="closure"] .judge-rubric-value')).toHaveText("4");

    // Primitive count.
    await expect(page.locator("#judgePrimitiveCount")).toHaveText("1");

    expect(networkSawJudgePost).toBeTruthy();
    expect((page as any).__consoleErrors).toEqual([]);
  });

  test("Judge panel shows revised guess line when deep guess overrides fast", async ({ page }) => {
    let stage = 0;
    await page.route("**/api/judge", async (route) => {
      stage += 1;
      const fastEvent =
        `data: ${JSON.stringify({
          kind: "token-delta",
          source: "fast",
          text: '{"primitives":[{"type":"Ring","cx":600,"cy":400,"r":140}],"guess":{"glyphId":"fire","confidence":0.6},"critique":{"score":3}}'
        })}\n\n`;
      const deepEvent =
        `data: ${JSON.stringify({
          kind: "token-delta",
          source: "deep",
          text: '{"primitives":[{"type":"Ring","cx":600,"cy":400,"r":140}],"guess":{"glyphId":"water","confidence":0.92},"critique":{"score":5}}'
        })}\n\n`;
      const done = `data: ${JSON.stringify({ kind: "done", source: "deep", reason: "stop" })}\n\n`;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: fastEvent + deepEvent + done
      });
    });

    await page.goto("/?judge=on");
    await page.locator('button[data-panel-root="judgeRootPanel"]').click();

    const canvas = page.locator("#glyphCanvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 30);
    await page.mouse.up();

    await page.waitForFunction(
      () => {
        const el = document.getElementById("judgeRevisedLine");
        return !!el && !el.hidden && /fire.*water/i.test(el.textContent ?? "");
      },
      undefined,
      { timeout: 4000 }
    );

    await expect(page.locator("#judgeRevisedLine")).toContainText(/fire/i);
    await expect(page.locator("#judgeRevisedLine")).toContainText(/water/i);
  });
});
