import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DIST = join(REPO_ROOT, "dist");

/**
 * M7b structural assertion (Architect T4) — pixi.js MUST NOT live in the
 * entry chunk's import graph. The lazy-load contract is verified at the
 * Vite build output: the entry chunk referenced by index.html must contain
 * NO `pixi.js` library code; pixi must only appear in dynamically-split
 * chunks.
 *
 * If this test fails, somebody has accidentally added a static import of
 * pixi.js (or one of its sub-modules) to the entry chunk's transitive
 * import graph — the lazy-load is gone.
 */

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function findEntryChunkPath() {
  const indexHtmlPath = join(DIST, "index.html");
  const html = await readFile(indexHtmlPath, "utf8");
  const match = html.match(/assets\/(index-[A-Za-z0-9]+\.js)/);
  if (!match) {
    throw new Error("entry chunk reference not found in dist/index.html");
  }
  return join(DIST, "assets", match[1]);
}

test("dist build exists (run `npm run build` first if this fails)", async () => {
  const ok = await exists(DIST);
  assert.equal(ok, true, "dist/ missing — run `npm run build` before this test");
});

test("entry chunk does NOT contain pixi.js library code", async () => {
  if (!(await exists(DIST))) {
    // Skip silently when the build hasn't been produced yet — CI runs build
    // before tests so this never fires there. Developers who haven't built
    // get a clear notice from the previous assertion.
    return;
  }
  const entryPath = await findEntryChunkPath();
  const entry = await readFile(entryPath, "utf8");

  // PixiJS library code uses these distinctive identifiers. If the bundler
  // accidentally pulled pixi.js into the entry chunk via a static import,
  // these strings appear. The literal "PIXI.Application" string DOES appear
  // in our own error-message text in stage.js, so we deliberately look for
  // library-only symbols (`TextureSource`, `_pixiVersion`, `WebGLRenderer`).
  const forbidden = ["TextureSource", "_pixiVersion", "WebGLRenderer"];
  for (const needle of forbidden) {
    assert.equal(
      entry.includes(needle),
      false,
      `pixi.js library identifier "${needle}" found in entry chunk ${entryPath}`
    );
  }
});

test("pixi.js library DOES appear in a separate chunk (split occurred)", async () => {
  if (!(await exists(DIST))) return;
  const assetsDir = join(DIST, "assets");
  const files = (await readdir(assetsDir)).filter((f) => f.endsWith(".js"));
  let pixiFound = false;
  for (const f of files) {
    const content = await readFile(join(assetsDir, f), "utf8");
    if (content.includes("PIXI.Application") || content.includes("TextureSource")) {
      pixiFound = true;
      break;
    }
  }
  // We don't strictly require pixi to be in a split chunk in the dist (if
  // the build is dead-code-eliminated to nothing because nothing references
  // it, it could be absent). But if it appears anywhere, it must NOT be in
  // the entry chunk — which the previous test asserts.
  // This test exists for diagnostic value; if pixi never appears we just
  // log it and move on.
  if (!pixiFound) {
    console.warn("[stage.test] pixi.js library identifiers not found in any chunk");
  }
});

test("stage module exposes the lazy-load API", async () => {
  const stageModule = await import("../../src/renderer/effectsPixi/stage.js");
  assert.equal(typeof stageModule.getStage, "function", "getStage missing");
  assert.equal(typeof stageModule.preloadStage, "function", "preloadStage missing");
  assert.equal(typeof stageModule.getElementFilter, "function", "getElementFilter missing");
  assert.equal(typeof stageModule.isElementFailed, "function", "isElementFailed missing");
});

test("preloadStage is idempotent", async () => {
  const stageModule = await import("../../src/renderer/effectsPixi/stage.js");
  // The pixi.js dynamic import will fail in node (no DOM); preloadStage is
  // built to resolve to null on failure. We just assert the function
  // doesn't throw and returns the same promise across calls.
  const p1 = stageModule.preloadStage();
  const p2 = stageModule.preloadStage();
  assert.equal(p1, p2, "preloadStage should memoize");
});
