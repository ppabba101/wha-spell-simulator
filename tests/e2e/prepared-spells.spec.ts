import { test, expect } from "@playwright/test";

/**
 * M4 — Prepared spells end-to-end.
 *
 * The prepared-spells module persists open-ring drawings to localStorage and
 * can synthesise a closing-dot stroke on Fire. The corresponding UI panel is
 * wired in a follow-up (M4 ships the module + the persistence contract). We
 * exercise the contract here directly by importing the ESM module from the
 * running dev server and round-tripping a save → reload → fire cycle.
 */

test("save → reload → fire restores the saved glyph and synthesises a closing dot", async ({ page }) => {
  await page.goto("/");

  // Use the live module via dynamic import. The dev server serves source as ESM.
  const result = await page.evaluate(async () => {
    const mod = await import("/src/ui/preparedSpells.js");

    // Stub storage so the test doesn't pollute real localStorage.
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      }
    };

    const pipeline = {
      ring: {
        found: true,
        complete: false,
        completeness: 0.85,
        center: { x: 600, y: 400 },
        radius: 220,
        gap: { startAngle: 350, endAngle: 380, sizeDegrees: 30 }
      },
      glyphAST: {
        type: "GlyphAST",
        ring: { found: true, complete: false, completeness: 0.85, center: { x: 600, y: 400 }, radius: 220 },
        rings: [],
        primarySigil: { id: "fire", element: "fire", confidence: 0.9 },
        signs: [],
        unknowns: [],
        globalMetrics: { neatness: 0.8 }
      }
    };

    const entry = mod.buildPreparedEntry({
      pipeline,
      strokes: [{ id: "s1", points: [{ x: 100, y: 100 }] }],
      name: "E2E prep"
    });
    mod.appendPreparedSpell(entry, storage);

    const reloaded = mod.loadPreparedSpells(storage);
    const dot = mod.synthesiseClosingDot(reloaded[0]);
    const fired = mod.strokesForFiring(reloaded[0]);

    return {
      savedCount: reloaded.length,
      name: reloaded[0].name,
      dotPoints: dot?.points?.length ?? 0,
      firedCount: fired.length
    };
  });

  expect(result.savedCount).toBe(1);
  expect(result.name).toBe("E2E prep");
  expect(result.dotPoints).toBeGreaterThan(0);
  expect(result.firedCount).toBe(2); // original 1 stroke + synthesised closing dot
});
