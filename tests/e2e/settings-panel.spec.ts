import { test, expect } from "@playwright/test";

/**
 * M3 — Settings panel headless e2e.
 *
 * Asserts:
 *  - the Settings tab exists and toggles each setting
 *  - settings persist across reload via localStorage
 *  - the Forget all keys button wipes wha.userKey.*
 *  - the disclosure copy is rendered next to the provider key inputs
 *  - no console errors, no direct provider URL calls (CSP boundary)
 */

test.describe("settings panel", () => {
  test.beforeEach(async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    (page as any).__consoleErrors = consoleErrors;
  });

  test("Settings tab is reachable; toggling enable-judge persists across reload", async ({ page }) => {
    await page.goto("/");
    await page.locator('button[data-panel-root="settingsRootPanel"]').click();
    await expect(page.locator("#settingsRootPanel")).toBeVisible();

    // Toggle judge enabled.
    const enableToggle = page.locator("#settingsJudgeEnabled");
    await enableToggle.check();
    expect(await enableToggle.isChecked()).toBe(true);

    // Inspect localStorage round-trip.
    const stored = await page.evaluate(() => localStorage.getItem("wha.settings.judge"));
    expect(stored).toContain('"enabled":true');

    // Reload and assert it sticks.
    await page.reload();
    await page.locator('button[data-panel-root="settingsRootPanel"]').click();
    await expect(page.locator("#settingsJudgeEnabled")).toBeChecked();
  });

  test("Disclosure copy renders next to provider key inputs", async ({ page }) => {
    await page.goto("/");
    await page.locator('button[data-panel-root="settingsRootPanel"]').click();
    // Open the details disclosure.
    await page.locator(".settings-details").locator("summary").click();
    await expect(page.locator("#settingsDisclosureCopy")).toContainText(/stored locally in your browser/i);
    await expect(page.locator("#settingsDisclosureCopy")).toContainText(/Forget all keys/i);
  });

  test("Forget all keys wipes wha.userKey.* slots", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("wha.userKey.groq", "g-test");
      localStorage.setItem("wha.userKey.sambanova", "s-test");
      localStorage.setItem("wha.userKey.anthropic", "a-test");
    });
    await page.locator('button[data-panel-root="settingsRootPanel"]').click();
    await page.locator(".settings-details").locator("summary").click();
    // Refresh the field values from storage.
    await page.evaluate(() => {
      const ev = new Event("focus");
      document.querySelectorAll('input[type="password"]').forEach((el) => el.dispatchEvent(ev));
    });
    await page.locator("#settingsForgetAllKeys").click();
    const remaining = await page.evaluate(() => ({
      g: localStorage.getItem("wha.userKey.groq"),
      s: localStorage.getItem("wha.userKey.sambanova"),
      a: localStorage.getItem("wha.userKey.anthropic")
    }));
    expect(remaining.g).toBeNull();
    expect(remaining.s).toBeNull();
    expect(remaining.a).toBeNull();
  });

  test("Toggling each surface persists across reload", async ({ page }) => {
    await page.goto("/");
    await page.locator('button[data-panel-root="settingsRootPanel"]').click();
    await page.locator("#settingsSurfaceOverlay").uncheck();
    await page.locator("#settingsSurfaceHints").check();

    const stored = await page.evaluate(() => localStorage.getItem("wha.settings.surfaces"));
    expect(stored).toContain('"canvasOverlay":false');
    expect(stored).toContain('"hintBubbles":true');

    await page.reload();
    await page.locator('button[data-panel-root="settingsRootPanel"]').click();
    expect(await page.locator("#settingsSurfaceOverlay").isChecked()).toBe(false);
    expect(await page.locator("#settingsSurfaceHints").isChecked()).toBe(true);
  });

  test("CSP not violated: no direct provider URL fetches when toggling settings", async ({ page }) => {
    const directProviderHits: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (/api\.(groq|sambanova|anthropic)\.com/.test(url)) {
        directProviderHits.push(url);
      }
    });
    await page.goto("/");
    await page.locator('button[data-panel-root="settingsRootPanel"]').click();
    await page.locator("#settingsJudgeEnabled").check();
    await page.locator("#settingsJudgeEnabled").uncheck();
    expect(directProviderHits).toEqual([]);
    expect((page as any).__consoleErrors).toEqual([]);
  });
});
