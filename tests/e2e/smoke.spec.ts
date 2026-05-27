import { test, expect } from "@playwright/test";

test("app loads with expected title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Witch Hat Atelier Spell Simulator/);
});
