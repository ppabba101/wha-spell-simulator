import { defineConfig } from "@playwright/test";

/**
 * Headless Playwright is the only Playwright (Principle 3).
 * `npm run test:e2e:headed` exists only as a debug escape hatch and is NOT
 * wired into CI or any default `npm test*` invocation.
 *
 * Golden snapshots live in `tests/golden/` with a 0.1% diff tolerance.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    headless: true, // PRINCIPLE 3 ENFORCEMENT — never change.
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: "disabled" }
  },
  webServer: {
    command: "npm run dev",
    port: 5173,
    reuseExistingServer: !process.env.CI
  }
});
