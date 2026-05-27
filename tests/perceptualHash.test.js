/**
 * Unit tests for dHash + Hamming distance.
 *
 * In a node:test environment there's no OffscreenCanvas. We exercise the
 * "already pre-downsampled 9x8 ImageData" fast path which is the only branch
 * with non-trivial arithmetic; the canvas-downsampling branch is exercised
 * in the Playwright e2e tests where a real browser is available.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { dHash, dHashHex, hammingDistance, HASH_SIZE_BITS } from "../src/parser/llmJudge/perceptualHash.js";

function makeUniformImageData(value) {
  const w = 9;
  const h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function makeGradientImageData() {
  // Right-to-left decreasing horizontal gradient.
  // dHash captures left > right transitions; a left-to-right increasing
  // gradient yields all-zero bits identical to a uniform image, so we
  // reverse the direction to guarantee a non-zero hash distinct from uniform.
  const w = 9;
  const h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const v = Math.floor(((w - 1 - x) / (w - 1)) * 255);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

test("dHash is deterministic for identical inputs", () => {
  const a = makeUniformImageData(128);
  const b = makeUniformImageData(128);
  assert.equal(dHash(a), dHash(b));
});

test("dHash differs for visibly different inputs", () => {
  const flat = makeUniformImageData(128);
  const grad = makeGradientImageData();
  assert.notEqual(dHash(flat), dHash(grad));
});

test("dHashHex returns 16 hex characters", () => {
  const a = makeGradientImageData();
  const hex = dHashHex(a);
  assert.equal(hex.length, 16);
  assert.match(hex, /^[0-9a-f]{16}$/);
});

test("hammingDistance(x, x) === 0", () => {
  const a = makeGradientImageData();
  const h = dHash(a);
  assert.equal(hammingDistance(h, h), 0);
  assert.equal(hammingDistance(dHashHex(a), dHashHex(a)), 0);
});

test("hammingDistance is symmetric", () => {
  const a = dHash(makeGradientImageData());
  const b = dHash(makeUniformImageData(64));
  assert.equal(hammingDistance(a, b), hammingDistance(b, a));
});

test("hammingDistance is bounded by hash size (64 - margin for 9x8 dHash)", () => {
  // dHash compares 8 columns of 8 rows = 64 bits, but we configure 9x8 so the
  // actual bit count is (9-1)*8 = 64.
  assert.equal(HASH_SIZE_BITS, 64);
  const a = dHash(makeGradientImageData());
  const b = dHash(makeUniformImageData(0));
  const dist = hammingDistance(a, b);
  assert.ok(dist >= 0 && dist <= HASH_SIZE_BITS, `dist=${dist} out of range`);
});

test("dHash accepts hex string into hammingDistance", () => {
  const a = makeGradientImageData();
  const b = makeUniformImageData(255);
  const ax = dHashHex(a);
  const bx = dHashHex(b);
  const d1 = hammingDistance(ax, bx);
  const d2 = hammingDistance(dHash(a), dHash(b));
  assert.equal(d1, d2);
});

test("dHash rejects mis-sized pre-downsampled buffer", () => {
  // The 9x8 fast path is *only* taken when dimensions match; mis-sized inputs
  // should hit the canvas-downsampling fallback, which throws when no canvas
  // API exists (as in node:test). We assert the throw to confirm the routing.
  const bad = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  assert.throws(() => dHash(bad), /no canvas API|expected/);
});
