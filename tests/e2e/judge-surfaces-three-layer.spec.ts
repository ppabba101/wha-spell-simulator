import { test, expect } from "@playwright/test";

/**
 * M3 — Three-layer surface independence.
 *
 * The overlay, side panel, and hint bubbles must each be independently
 * toggleable. We exercise the matrix:
 *   - All three off  -> orchestrator still runs in background, no console errors
 *   - Overlay off    -> panel still updates
 *   - Side panel off -> overlay still updates
 *   - Hints on, overlay off, panel off -> bubble appears
 */

const PARTIAL_BODY =
  `data: ${JSON.stringify({
    kind: "token-delta",
    source: "fast",
    text: '{"primitives":[{"type":"Ring","cx":600,"cy":400,"r":140}],"guess":{"glyphId":"earth","confidence":0.66},"critique":{"score":3,"closure":3,"cleanliness":3,"continuity":3,"recognizability":3},"hint":"Steady the outer arc."}'
  })}\n\n` +
  `data: ${JSON.stringify({ kind: "done", source: "fast", reason: "stop" })}\n\n`;

async function setupMock(page: import("@playwright/test").Page) {
  await page.route("**/api/judge", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body: PARTIAL_BODY });
  });
}

async function drawCircle(page: import("@playwright/test").Page) {
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
}

test.describe("judge three-layer surfaces", () => {
  test.beforeEach(async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    (page as any).__consoleErrors = consoleErrors;
  });

  test("all three off -> no console errors, judge still POSTs to proxy", async ({ page }) => {
    await setupMock(page);
    let networkSawJudgePost = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/judge") && req.method() === "POST") networkSawJudgePost = true;
    });

    await page.goto("/?judge=on");
    await page.evaluate(() => {
      localStorage.setItem(
        "wha.settings.surfaces",
        JSON.stringify({ canvasOverlay: false, sidePanel: false, hintBubbles: false })
      );
    });
    await page.reload();

    await drawCircle(page);
    await page.waitForTimeout(800);

    expect(networkSawJudgePost).toBeTruthy();
    expect((page as any).__consoleErrors).toEqual([]);
  });

  test("overlay off, panel ON -> panel updates", async ({ page }) => {
    await setupMock(page);
    await page.goto("/?judge=on");
    await page.evaluate(() => {
      localStorage.setItem(
        "wha.settings.surfaces",
        JSON.stringify({ canvasOverlay: false, sidePanel: true, hintBubbles: false })
      );
    });
    await page.reload();

    await page.locator('button[data-panel-root="judgeRootPanel"]').click();
    await drawCircle(page);

    await page.waitForFunction(
      () => document.getElementById("judgeGuessGlyph")?.textContent?.trim() === "earth",
      undefined,
      { timeout: 4000 }
    );
    await expect(page.locator("#judgeGuessGlyph")).toHaveText("earth");
  });

  test("panel off (no click), overlay ON -> overlay still paints", async ({ page }) => {
    await setupMock(page);
    await page.goto("/?judge=on");
    await page.evaluate(() => {
      localStorage.setItem(
        "wha.settings.surfaces",
        JSON.stringify({ canvasOverlay: true, sidePanel: false, hintBubbles: false })
      );
    });
    await page.reload();

    await drawCircle(page);
    const drew = await page.waitForFunction(
      () => {
        const c = document.getElementById("judgeOverlayCanvas") as HTMLCanvasElement | null;
        if (!c) return false;
        const ctx = c.getContext("2d");
        if (!ctx) return false;
        const sample = ctx.getImageData(c.width / 2 - 80, c.height / 2 - 80, 160, 160);
        for (let i = 3; i < sample.data.length; i += 4) {
          if (sample.data[i] > 0) return true;
        }
        return false;
      },
      undefined,
      { timeout: 4000 }
    );
    expect(drew).toBeTruthy();
  });

  test("hints on, overlay/panel off -> bubble appears", async ({ page }) => {
    await setupMock(page);
    await page.goto("/?judge=on");
    await page.evaluate(() => {
      localStorage.setItem(
        "wha.settings.surfaces",
        JSON.stringify({ canvasOverlay: false, sidePanel: false, hintBubbles: true })
      );
    });
    await page.reload();

    await drawCircle(page);
    await page.waitForFunction(
      () => {
        const el = document.getElementById("judgeHintBubble");
        return !!el && !el.hidden && (el.textContent ?? "").length > 0;
      },
      undefined,
      { timeout: 4000 }
    );
    await expect(page.locator("#judgeHintBubble")).toContainText(/Steady the outer arc/i);
  });

  test("network: every judge call hits the proxy, never direct provider URLs", async ({ page }) => {
    await setupMock(page);
    const providerDirect: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (/api\.(groq|sambanova|anthropic)\.com/.test(url)) providerDirect.push(url);
    });

    await page.goto("/?judge=on");
    await drawCircle(page);
    await page.waitForTimeout(500);
    expect(providerDirect).toEqual([]);
  });
});
