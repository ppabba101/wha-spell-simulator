/**
 * 64-bit difference hash (dHash) + Hamming distance.
 *
 * The streaming judge uses this as a gate to skip redundant submissions:
 * if the canvas hasn't visibly changed (Hamming distance vs the last
 * submitted hash < diffThreshold), we don't fire another judge call.
 *
 * Algorithm:
 *   1) Downsample to a 9x8 grayscale image (64 bits).
 *   2) For each row, compare adjacent pixels: bit = 1 if left > right else 0.
 *   3) Pack the 64 bits into a BigInt (returned as hex by `dHashHex`).
 *
 * Hash inputs accept either an `ImageData` (Web Canvas API) or an
 * `HTMLCanvasElement` / `OffscreenCanvas`. The latter is downsampled
 * internally via a 9x8 offscreen draw.
 */

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

/**
 * Compute the dHash of an ImageData buffer that is *already* 9x8.
 * Returns a 64-bit BigInt.
 */
function dHashFromGrayscale9x8(imageData) {
  const { data, width, height } = imageData;
  if (width !== HASH_WIDTH || height !== HASH_HEIGHT) {
    throw new Error(`dHashFromGrayscale9x8: expected ${HASH_WIDTH}x${HASH_HEIGHT}, got ${width}x${height}`);
  }
  let hash = 0n;
  let bit = 0;
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH - 1; x += 1) {
      const i = (y * HASH_WIDTH + x) * 4;
      const j = (y * HASH_WIDTH + x + 1) * 4;
      // Rec. 709 luminance approximation.
      const left = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const right = data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722;
      if (left > right) {
        hash |= 1n << BigInt(bit);
      }
      bit += 1;
    }
  }
  return hash;
}

/**
 * Downsample an arbitrary canvas / image to 9x8 ImageData.
 *
 * Browser-only path uses an OffscreenCanvas if available, falling back to a
 * detached HTMLCanvasElement. In node-test environments where no canvas
 * APIs exist, callers must pass `imageData` directly.
 */
function downsampleToGrayscale9x8(source) {
  // Already an ImageData of the right size — fast path.
  if (
    source &&
    typeof source === "object" &&
    source.data &&
    source.width === HASH_WIDTH &&
    source.height === HASH_HEIGHT
  ) {
    return source;
  }

  let canvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(HASH_WIDTH, HASH_HEIGHT);
  } else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = HASH_WIDTH;
    canvas.height = HASH_HEIGHT;
  } else {
    throw new Error("dHash: no canvas API available; pass a pre-downsampled 9x8 ImageData");
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("dHash: 2d context unavailable");
  ctx.drawImage(source, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  return ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT);
}

/**
 * Public: compute 64-bit dHash. Returns BigInt.
 *
 * @param {ImageData|HTMLCanvasElement|OffscreenCanvas|HTMLImageElement} source
 * @returns {bigint}
 */
export function dHash(source) {
  const sample = downsampleToGrayscale9x8(source);
  return dHashFromGrayscale9x8(sample);
}

/** Hex string variant (16 hex digits, lowercase, leading zeros). */
export function dHashHex(source) {
  const h = dHash(source);
  let hex = h.toString(16);
  while (hex.length < 16) hex = "0" + hex;
  return hex;
}

/**
 * Hamming distance between two hashes. Accepts BigInt or hex string.
 *
 * @param {bigint|string} a
 * @param {bigint|string} b
 * @returns {number}
 */
export function hammingDistance(a, b) {
  const ba = typeof a === "bigint" ? a : BigInt("0x" + a);
  const bb = typeof b === "bigint" ? b : BigInt("0x" + b);
  let diff = ba ^ bb;
  let count = 0;
  while (diff !== 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

export const HASH_SIZE_BITS = (HASH_WIDTH - 1) * HASH_HEIGHT;
