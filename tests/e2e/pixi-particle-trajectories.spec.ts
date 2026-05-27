import { test, expect } from "@playwright/test";

/**
 * M7b — Particle trajectory distinctness e2e.
 *
 * Each of the 5 elements emits particles with its own velocity field +
 * lifespan + size/alpha curves (see `src/renderer/effectsPixi/particlePhysics.js`).
 * With a fixed PRNG seed, the trajectory polylines must all be distinct.
 *
 * We record 30 frames of particle positions per element, hash each polyline,
 * and assert all 5 hashes differ.
 */

const ELEMENTS = ["fire", "water", "wind", "earth", "light"] as const;

async function bootApp(page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__effectsPixi), null, { timeout: 5000 });
}

test("particle trajectory hashes are distinct across the 5 elements (PRNG-seeded)", async ({ page }) => {
  await bootApp(page);

  const hashes = await page.evaluate(async (elements) => {
    const mod = await import("/src/renderer/effectsPixi/particlePhysics.js");
    mod.setEmitterSeed(0xdeadbeef);
    const emitters = mod.createAllEmitters({ origin: { x: 600, y: 400 }, seed: 0xdeadbeef });
    const out: Record<string, string> = {};
    for (const el of elements as readonly string[]) {
      const e = emitters[el];
      let now = 0;
      let acc = "";
      for (let i = 0; i < 30; i += 1) {
        now += 16.67;
        e.step(1, now);
        const ps = e.getParticles();
        for (const p of ps) {
          acc += `${p.id}:${p.x.toFixed(1)},${p.y.toFixed(1)};`;
        }
        acc += "|";
      }
      // Simple FNV-1a hash so the comparison stays cheap.
      let h = 0x811c9dc5;
      for (let i = 0; i < acc.length; i += 1) {
        h ^= acc.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      out[el] = (h >>> 0).toString(16);
    }
    return out;
  }, ELEMENTS);

  console.log("[pixi-particle-trajectories] hashes:", hashes);
  const values = Object.values(hashes);
  const uniq = new Set(values);
  expect(uniq.size).toBe(5);
  // Sanity: each hash should be non-trivial (more than just FNV initial state).
  for (const [el, h] of Object.entries(hashes)) {
    expect(h).not.toBe("811c9dc5");
  }
});

test("particle trajectory is deterministic across runs with same seed", async ({ page }) => {
  await bootApp(page);
  const run1 = await page.evaluate(async () => {
    const mod = await import("/src/renderer/effectsPixi/particlePhysics.js");
    const e = mod.createEmitter({ element: "fire", origin: { x: 100, y: 100 }, seed: 42 });
    let now = 0;
    const acc: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      now += 16.67;
      e.step(1, now);
      for (const p of e.getParticles()) {
        acc.push(`${p.x.toFixed(3)},${p.y.toFixed(3)}`);
      }
    }
    return acc.join("|");
  });

  const run2 = await page.evaluate(async () => {
    const mod = await import("/src/renderer/effectsPixi/particlePhysics.js");
    const e = mod.createEmitter({ element: "fire", origin: { x: 100, y: 100 }, seed: 42 });
    let now = 0;
    const acc: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      now += 16.67;
      e.step(1, now);
      for (const p of e.getParticles()) {
        acc.push(`${p.x.toFixed(3)},${p.y.toFixed(3)}`);
      }
    }
    return acc.join("|");
  });
  expect(run1).toBe(run2);
});
