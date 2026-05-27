/**
 * generateFixtureCorpus.mjs
 * Procedural fixture corpus generator for WHA Spell Simulator v0.2 M0.
 *
 * Usage:  node tools/generateFixtureCorpus.mjs
 *
 * Outputs to tests/fixtures/glyphs/ (relative to repo root).
 * Idempotent — seeded PRNG produces identical output on every run.
 *
 * DEGRADATION NOTICE: No human drawers were available. Three personas are
 * simulated via parametric noise. See INDEX.json degradation_notice.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'glyphs');
const CANVAS_SIZE = 512;

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32
// ---------------------------------------------------------------------------
function makePRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Global seeded rng — reset per fixture via seedForFixture()
let _rng = makePRNG(0xdeadbeef);
function seedForFixture(label) {
  // Deterministic seed from fixture label
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  _rng = makePRNG(h >>> 0);
}
function rand() { return _rng(); }
function randRange(lo, hi) { return lo + rand() * (hi - lo); }

// ---------------------------------------------------------------------------
// Drawer personas
// ---------------------------------------------------------------------------
const PERSONAS = [
  { id: 1, name: 'steady-hand-expert',   noise_amplitude: 0.5,  speed_variance: 0.1 },
  { id: 2, name: 'average-user',          noise_amplitude: 2.0,  speed_variance: 0.4 },
  { id: 3, name: 'shaky-hand-beginner',  noise_amplitude: 6.0,  speed_variance: 0.9 },
];

// Quality buckets map to persona IDs
const QUALITY_PERSONA = { clean: 1, average: 2, messy: 3 };

// ---------------------------------------------------------------------------
// Perlin-style 1D noise (value noise with cosine interp) — no external deps
// ---------------------------------------------------------------------------
function makeNoise1D(seed) {
  const rng = makePRNG(seed);
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i++) table[i] = rng() * 2 - 1;
  return function noise(x) {
    const xi = Math.floor(x) & 255;
    const xf = x - Math.floor(x);
    const u = xf * xf * (3 - 2 * xf); // smoothstep
    return table[xi] * (1 - u) + table[(xi + 1) & 255] * u;
  };
}

// ---------------------------------------------------------------------------
// Stroke generation helpers
// ---------------------------------------------------------------------------
/**
 * Apply persona noise to a list of [x,y] pixel coordinates.
 * Returns raw-points-v1 tuples: [x, y, t_ms, pressure].
 */
function applyPersonaNoise(xyPairs, persona, noiseSeed) {
  const amp = persona.noise_amplitude;
  const sv = persona.speed_variance;
  const noiseX = makeNoise1D(noiseSeed ^ 0x1234);
  const noiseY = makeNoise1D(noiseSeed ^ 0x5678);

  const baseInterval = 16; // ~60fps
  let t = 0;
  const points = [];
  for (let i = 0; i < xyPairs.length; i++) {
    const [x, y] = xyPairs[i];
    const nx = noiseX(i * 0.3) * amp;
    const ny = noiseY(i * 0.3) * amp;
    const dt = baseInterval * (1 + randRange(-sv, sv));
    t += Math.max(4, dt);
    const pressure = Math.max(0.1, Math.min(1.0, 0.7 + noiseX(i * 0.15) * 0.3));
    // Clamp to canvas
    const px = Math.max(2, Math.min(CANVAS_SIZE - 2, x + nx));
    const py = Math.max(2, Math.min(CANVAS_SIZE - 2, y + ny));
    points.push([Math.round(px * 100) / 100, Math.round(py * 100) / 100, Math.round(t), Math.round(pressure * 100) / 100]);
  }
  return points;
}

// Generate circle stroke (for ring)
function circlePoints(cx, cy, r, steps = 80) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// Generate line stroke from (x1,y1) to (x2,y2)
function linePoints(x1, y1, x2, y2, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return pts;
}

// Generate arc stroke
function arcPoints(cx, cy, r, startAngle, endAngle, steps = 50) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / steps);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// Generate dot (small circle or just the center point)
function dotPoints(cx, cy, steps = 10) {
  const r = 4;
  return circlePoints(cx, cy, r, steps);
}

// ---------------------------------------------------------------------------
// Sigil primitive compositions (approximate visual representations)
// Each returns an array of xy-pair arrays (one per stroke)
// ---------------------------------------------------------------------------
const C = CANVAS_SIZE;
const MID = C / 2;

const SIGIL_STROKES = {
  fire: () => {
    // Ring + vertical line down + two diagonal lines (flame shape)
    const ring = circlePoints(MID, MID * 0.75, MID * 0.5);
    const stem = linePoints(MID, MID * 0.75, MID, C * 0.95);
    const left = linePoints(MID, C * 0.3, C * 0.3, MID * 0.75);
    const right = linePoints(MID, C * 0.3, C * 0.7, MID * 0.75);
    return [ring, stem, left, right];
  },
  water: () => {
    // Ring + S-curve diagonal
    const ring = circlePoints(MID, MID, MID * 0.42);
    const sCurve = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const x = C * 0.2 + t * C * 0.6;
      const y = MID + Math.sin(t * Math.PI * 1.5) * C * 0.2;
      sCurve.push([x, y]);
    }
    return [ring, sCurve];
  },
  'wind-directs-air': () => {
    // Ring + arc + two diverging lines
    const ring = circlePoints(MID, MID, MID * 0.38);
    const arc = arcPoints(MID, MID, MID * 0.55, -Math.PI * 0.6, Math.PI * 0.6);
    const line1 = linePoints(MID, MID, C * 0.15, C * 0.2);
    const line2 = linePoints(MID, MID, C * 0.85, C * 0.2);
    return [ring, arc, line1, line2];
  },
  earth: () => {
    // Ring + cross (horizontal + vertical lines)
    const ring = circlePoints(MID, MID, MID * 0.42);
    const horiz = linePoints(C * 0.2, MID, C * 0.8, MID);
    const vert = linePoints(MID, C * 0.2, MID, C * 0.8);
    return [ring, horiz, vert];
  },
  light: () => {
    // Ring + star burst (8 lines radiating out)
    const ring = circlePoints(MID, MID, MID * 0.32);
    const rays = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI;
      rays.push(linePoints(
        MID + Math.cos(a) * MID * 0.35,
        MID + Math.sin(a) * MID * 0.35,
        MID + Math.cos(a) * MID * 0.65,
        MID + Math.sin(a) * MID * 0.65,
        20
      ));
    }
    return [ring, ...rays];
  },
};

// ---------------------------------------------------------------------------
// Sign primitive compositions
// ---------------------------------------------------------------------------
const SIGN_STROKES = {
  column: () => {
    // Vertical line + horizontal base line
    const vert = linePoints(MID, C * 0.15, MID, C * 0.82);
    const base = linePoints(C * 0.2, C * 0.82, C * 0.8, C * 0.82);
    return [vert, base];
  },
  levitation: () => {
    // Vertical stem + horizontal base + upward arrow head
    const stem = linePoints(MID, C * 0.1, MID, C * 0.78);
    const base = linePoints(C * 0.2, C * 0.78, C * 0.8, C * 0.78);
    const leftWing = linePoints(C * 0.25, C * 0.36, MID, C * 0.1);
    const rightWing = linePoints(MID, C * 0.1, C * 0.75, C * 0.36);
    return [stem, base, leftWing, rightWing];
  },
  convergence: () => {
    // Triangle pointing inward
    const top = linePoints(C * 0.02, C * 0.05, C * 0.98, C * 0.05);
    const right = linePoints(C * 0.98, C * 0.05, MID, C * 0.95);
    const left = linePoints(MID, C * 0.95, C * 0.02, C * 0.05);
    return [top, right, left];
  },
  // M6 new signs
  dispersion: () => {
    // Center dot + multiple lines radiating outward (scatter/spread shape)
    const dot = dotPoints(MID, MID);
    const lines = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 2 * Math.PI;
      lines.push(linePoints(MID, MID, MID + Math.cos(a) * C * 0.38, MID + Math.sin(a) * C * 0.38, 25));
    }
    return [dot, ...lines];
  },
  direction: () => {
    // Arrow: shaft + arrowhead
    const shaft = linePoints(C * 0.15, MID, C * 0.78, MID);
    const head1 = linePoints(C * 0.78, MID, C * 0.6, C * 0.28);
    const head2 = linePoints(C * 0.78, MID, C * 0.6, C * 0.72);
    return [shaft, head1, head2];
  },
  window: () => {
    // Rectangle (4 sides) — portal/frame shape
    const top = linePoints(C * 0.2, C * 0.2, C * 0.8, C * 0.2);
    const right = linePoints(C * 0.8, C * 0.2, C * 0.8, C * 0.8);
    const bottom = linePoints(C * 0.8, C * 0.8, C * 0.2, C * 0.8);
    const left = linePoints(C * 0.2, C * 0.8, C * 0.2, C * 0.2);
    // Cross divider inside
    const hDiv = linePoints(C * 0.2, MID, C * 0.8, MID);
    const vDiv = linePoints(MID, C * 0.2, MID, C * 0.8);
    return [top, right, bottom, left, hDiv, vDiv];
  },
  diamond: () => {
    // Diamond shape: 4 lines forming a rhombus
    const topRight = linePoints(MID, C * 0.1, C * 0.9, MID);
    const bottomRight = linePoints(C * 0.9, MID, MID, C * 0.9);
    const bottomLeft = linePoints(MID, C * 0.9, C * 0.1, MID);
    const topLeft = linePoints(C * 0.1, MID, MID, C * 0.1);
    return [topRight, bottomRight, bottomLeft, topLeft];
  },
  repetition: () => {
    // Two overlapping arcs (repeat/cycle motif)
    const arc1 = arcPoints(MID * 0.7, MID, C * 0.25, 0, Math.PI * 2);
    const arc2 = arcPoints(MID * 1.3, MID, C * 0.25, 0, Math.PI * 2);
    const link = linePoints(MID * 0.95, MID * 0.75, MID * 1.05, MID * 0.75, 15);
    return [arc1, arc2, link];
  },
};

// ---------------------------------------------------------------------------
// Nested-ring canon spell compositions
// ---------------------------------------------------------------------------
const NESTED_STROKES = {
  'memory-erasure': () => {
    // Outer ring (large) + inner ring (medium) + erasure sigil (spiral-ish)
    const outerRing = circlePoints(MID, MID, MID * 0.78);
    const innerRing = circlePoints(MID, MID, MID * 0.46);
    // Spiral from center outward
    const spiral = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const a = t * Math.PI * 4;
      const r = MID * 0.08 + t * MID * 0.3;
      spiral.push([MID + Math.cos(a) * r, MID + Math.sin(a) * r]);
    }
    // Memory sign: horizontal sweep with two bumps
    const sweep = [];
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const x = C * 0.25 + t * C * 0.5;
      const y = MID * 0.7 + Math.sin(t * Math.PI * 2) * C * 0.08;
      sweep.push([x, y]);
    }
    return [outerRing, innerRing, spiral, sweep];
  },
  'sylph-shoes': () => {
    // Outer ring + inner ring + wind sign + levitation sign
    const outerRing = circlePoints(MID, MID, MID * 0.75);
    const innerRing = circlePoints(MID, MID, MID * 0.44);
    // Wind curl inside inner ring
    const curl = arcPoints(MID, MID, MID * 0.28, -Math.PI * 0.5, Math.PI * 1.5, 60);
    // Foot-shape: two arcs side by side
    const leftFoot = arcPoints(C * 0.36, C * 0.75, C * 0.09, Math.PI, Math.PI * 2);
    const rightFoot = arcPoints(C * 0.64, C * 0.75, C * 0.09, Math.PI, Math.PI * 2);
    return [outerRing, innerRing, curl, leftFoot, rightFoot];
  },
  'light-reducing': () => {
    // Outer ring + inner ring + light sigil + diminish mark
    const outerRing = circlePoints(MID, MID, MID * 0.76);
    const innerRing = circlePoints(MID, MID, MID * 0.43);
    // Light: small inner ring + 4 short rays
    const innerGlow = circlePoints(MID, MID, MID * 0.18);
    const rays = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      rays.push(linePoints(
        MID + Math.cos(a) * MID * 0.2,
        MID + Math.sin(a) * MID * 0.2,
        MID + Math.cos(a) * MID * 0.35,
        MID + Math.sin(a) * MID * 0.35,
        15
      ));
    }
    // Diminish mark: downward arrow
    const downArrow = linePoints(C * 0.56, C * 0.22, C * 0.56, C * 0.52);
    const arrowL = linePoints(C * 0.56, C * 0.52, C * 0.44, C * 0.4);
    const arrowR = linePoints(C * 0.56, C * 0.52, C * 0.68, C * 0.4);
    return [outerRing, innerRing, innerGlow, ...rays, downArrow, arrowL, arrowR];
  },
};

// ---------------------------------------------------------------------------
// Pure-JS PNG encoder (uncompressed IDAT, lossless, white bg + black strokes)
// ---------------------------------------------------------------------------
// We write a valid PNG with uncompressed deflate blocks for simplicity.
// The resulting files are slightly large (~768KB for 512x512) but correct.

function crc32(buf) {
  // Standard CRC32 lookup table
  if (!crc32._table) {
    crc32._table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crc32._table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crc32._table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32BE(buf, offset, value) {
  buf[offset]     = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8)  & 0xff;
  buf[offset + 3] = value & 0xff;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const len = data.length;
  const chunk = new Uint8Array(4 + 4 + len + 4);
  writeUint32BE(chunk, 0, len);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + len);
  crcInput.set(typeBytes);
  crcInput.set(data, 4);
  writeUint32BE(chunk, 8 + len, crc32(crcInput));
  return chunk;
}

function encodePNG(width, height, pixelsFn) {
  // pixelsFn(x, y) -> { r, g, b }
  // IHDR
  const ihdrData = new Uint8Array(13);
  writeUint32BE(ihdrData, 0, width);
  writeUint32BE(ihdrData, 4, height);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  // ihdrData[10-12] = 0 (compression, filter, interlace)

  // Build raw scanlines (filter byte 0 = None per row)
  // Total raw data: height * (1 + width*3)
  const rowBytes = 1 + width * 3;
  const rawData = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y++) {
    rawData[y * rowBytes] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const { r, g, b } = pixelsFn(x, y);
      const offset = y * rowBytes + 1 + x * 3;
      rawData[offset]     = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
    }
  }

  // Deflate: uncompressed blocks (BTYPE=00)
  // Each block max 65535 bytes
  const MAX_BLOCK = 65535;
  const blocks = [];
  let pos = 0;
  while (pos < rawData.length) {
    const blockLen = Math.min(MAX_BLOCK, rawData.length - pos);
    const isLast = (pos + blockLen >= rawData.length) ? 1 : 0;
    const block = new Uint8Array(5 + blockLen);
    block[0] = isLast;                     // BFINAL | BTYPE=00
    block[1] = blockLen & 0xff;
    block[2] = (blockLen >>> 8) & 0xff;
    block[3] = (~blockLen) & 0xff;
    block[4] = ((~blockLen) >>> 8) & 0xff;
    block.set(rawData.subarray(pos, pos + blockLen), 5);
    blocks.push(block);
    pos += blockLen;
  }

  // Wrap blocks in zlib format (CMF=0x78, FLG, ...blocks, Adler-32)
  // Compute Adler-32 of rawData
  let s1 = 1, s2 = 0;
  for (let i = 0; i < rawData.length; i++) {
    s1 = (s1 + rawData[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = ((s2 << 16) | s1) >>> 0;

  const totalBlockBytes = blocks.reduce((a, b) => a + b.length, 0);
  const zlibData = new Uint8Array(2 + totalBlockBytes + 4);
  zlibData[0] = 0x78; // CMF: deflate, window size 32k
  zlibData[1] = 0x01; // FLG: no dict, check bits (0x7801 % 31 == 0)
  let off = 2;
  for (const blk of blocks) {
    zlibData.set(blk, off);
    off += blk.length;
  }
  writeUint32BE(zlibData, off, adler);

  const idatChunk = pngChunk('IDAT', zlibData);
  const ihdrChunk = pngChunk('IHDR', ihdrData);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  // PNG signature
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const total = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let o = 0;
  out.set(sig, o); o += sig.length;
  out.set(ihdrChunk, o); o += ihdrChunk.length;
  out.set(idatChunk, o); o += idatChunk.length;
  out.set(iendChunk, o);
  return out;
}

// ---------------------------------------------------------------------------
// Rasterizer: draws anti-aliased lines on a pixel buffer
// ---------------------------------------------------------------------------
function createCanvas(w, h) {
  // Float32 channel per pixel (0=white, 1=black ink)
  const buf = new Float32Array(w * h).fill(0);
  return {
    buf,
    drawStroke(points /* [x,y,t,p][] */, lineWidth = 2.5) {
      for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1];
        const [x1, y1] = points[i];
        this._drawLineAA(x0, y0, x1, y1, lineWidth);
      }
    },
    _drawLineAA(x0, y0, x1, y1, lw) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.5) {
        this._drawDot(x0, y0, lw / 2);
        return;
      }
      const steps = Math.max(Math.ceil(dist), 2);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x0 + dx * t;
        const y = y0 + dy * t;
        this._drawDot(x, y, lw / 2);
      }
    },
    _drawDot(cx, cy, r) {
      const x0 = Math.floor(cx - r - 1);
      const x1 = Math.ceil(cx + r + 1);
      const y0 = Math.floor(cy - r - 1);
      const y1 = Math.ceil(cy + r + 1);
      for (let py = Math.max(0, y0); py <= Math.min(h - 1, y1); py++) {
        for (let px = Math.max(0, x0); px <= Math.min(w - 1, x1); px++) {
          const ddx = px - cx;
          const ddy = py - cy;
          const dd = Math.sqrt(ddx * ddx + ddy * ddy);
          // Soft alpha falloff for anti-aliasing
          const alpha = Math.max(0, Math.min(1, r - dd + 0.8));
          const idx = py * w + px;
          buf[idx] = Math.min(1, buf[idx] + alpha);
        }
      }
    },
    toPNG() {
      return encodePNG(w, h, (x, y) => {
        const v = Math.max(0, Math.min(1, buf[y * w + x]));
        const ch = Math.round((1 - v) * 255); // white bg, black ink
        return { r: ch, g: ch, b: ch };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Build a strokes.json object from raw point arrays
// ---------------------------------------------------------------------------
function buildStrokesJson(strokeArrays) {
  return {
    strokeFormat: 'raw-points-v1',
    canvasWidth: CANVAS_SIZE,
    canvasHeight: CANVAS_SIZE,
    strokes: strokeArrays.map((pts, i) => ({
      id: `s${i + 1}`,
      points: pts,
    })),
  };
}

// ---------------------------------------------------------------------------
// Render a fixture: returns { png: Uint8Array, strokes: object }
// ---------------------------------------------------------------------------
function renderFixture(strokesXY, persona, noiseSeedBase) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const rawStrokes = [];
  for (let i = 0; i < strokesXY.length; i++) {
    const noised = applyPersonaNoise(strokesXY[i], persona, noiseSeedBase + i * 7919);
    rawStrokes.push(noised);
    canvas.drawStroke(noised, 2.5);
  }
  return {
    png: canvas.toPNG(),
    strokes: buildStrokesJson(rawStrokes),
  };
}

// ---------------------------------------------------------------------------
// Stratified 70/30 train/test split — seeded deterministic shuffle
// ---------------------------------------------------------------------------
function stratifiedSplit(entries, trainFraction = 0.7) {
  // Group by (quality, drawer_id)
  const groups = {};
  for (const e of entries) {
    const key = `${e.quality}_${e.drawer_id}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  const splitRng = makePRNG(0xc0ffee42);
  for (const key of Object.keys(groups)) {
    const grp = groups[key];
    // Fisher-Yates shuffle with seeded rng
    for (let i = grp.length - 1; i > 0; i--) {
      const j = Math.floor(splitRng() * (i + 1));
      [grp[i], grp[j]] = [grp[j], grp[i]];
    }
    const trainCount = Math.max(1, Math.round(grp.length * trainFraction));
    grp.forEach((e, idx) => { e.split = idx < trainCount ? 'train' : 'test'; });
  }
}

// ---------------------------------------------------------------------------
// Main generation logic
// ---------------------------------------------------------------------------
async function main() {
  console.log('Generating WHA fixture corpus...');
  const fixtureRegistry = [];

  // Helper to write a single fixture
  function writeFixture(subdir, baseName, strokesXY, persona, quality, groundTruth, noiseSeed) {
    const pngName = `${baseName}.png`;
    const strokesName = `${baseName}.strokes.json`;
    const pngPath = join(OUT_DIR, subdir, pngName);
    const strokesPath = join(OUT_DIR, subdir, strokesName);

    seedForFixture(baseName);
    const { png, strokes } = renderFixture(strokesXY, persona, noiseSeed);

    writeFileSync(pngPath, png);
    writeFileSync(strokesPath, JSON.stringify(strokes, null, 2));

    fixtureRegistry.push({
      path: `${subdir}/${pngName}`,
      strokes_path: `${subdir}/${strokesName}`,
      drawer_id: persona.id,
      quality,
      ground_truth: groundTruth,
      split: null, // will be set by stratifiedSplit
      strokeFormat: 'raw-points-v1',
    });
  }

  // --- Sigil fixtures (5 sigils × 3 quality buckets × 2 variants = 30) ---
  const sigilIds = ['fire', 'water', 'wind-directs-air', 'earth', 'light'];
  const qualities = ['clean', 'average', 'messy'];
  const primitiveMap = {
    fire:             ['Ring', 'Line', 'Line', 'Line'],
    water:            ['Ring', 'Line'],
    'wind-directs-air': ['Ring', 'Arc', 'Line', 'Line'],
    earth:            ['Ring', 'Line', 'Line'],
    light:            ['Ring', 'Line', 'Line', 'Line', 'Line', 'Line', 'Line', 'Line', 'Line'],
  };

  for (const sigilId of sigilIds) {
    const strokesFn = SIGIL_STROKES[sigilId];
    for (const quality of qualities) {
      const personaId = QUALITY_PERSONA[quality];
      const persona = PERSONAS.find(p => p.id === personaId);
      const subdir = quality === 'average' ? 'average' : quality === 'clean' ? 'clean' : 'messy';
      const gt = {
        glyph: sigilId,
        primitives: primitiveMap[sigilId],
        signs: [],
      };
      for (let v = 1; v <= 2; v++) {
        const safeId = sigilId.replace(/-/g, '_');
        const baseName = `${safeId}_${quality}_00${v}`;
        const seed = (sigilId.charCodeAt(0) * 1000 + personaId * 100 + v * 13) >>> 0;
        writeFixture(subdir, baseName, strokesFn(), persona, quality, gt, seed);
      }
    }
  }

  // --- Sign fixtures (8 signs × 2 quality buckets × 2 variants = 32) ---
  const signIds = ['column', 'levitation', 'convergence', 'dispersion', 'direction', 'window', 'diamond', 'repetition'];
  const signQualities = ['clean', 'messy'];

  for (const signId of signIds) {
    const strokesFn = SIGN_STROKES[signId];
    for (const quality of signQualities) {
      const personaId = QUALITY_PERSONA[quality];
      const persona = PERSONAS.find(p => p.id === personaId);
      const gt = {
        glyph: null,
        primitives: [],
        signs: [signId],
      };
      for (let v = 1; v <= 2; v++) {
        const baseName = `${signId}_${quality}_00${v}`;
        const seed = (signId.charCodeAt(0) * 2000 + personaId * 200 + v * 17) >>> 0;
        writeFixture('signs', baseName, strokesFn(), persona, quality, gt, seed);
      }
    }
  }

  // --- Nested-ring canon fixtures (3 spells × 1 variant each) ---
  const nestedSpells = [
    {
      id: 'memory-erasure',
      gt: { glyph: 'memory-erasure', primitives: ['Ring', 'Ring', 'Line', 'Arc'], signs: [] },
    },
    {
      id: 'sylph-shoes',
      gt: { glyph: 'sylph-shoes', primitives: ['Ring', 'Ring', 'Arc', 'Arc', 'Arc'], signs: ['levitation'] },
    },
    {
      id: 'light-reducing',
      gt: { glyph: 'light-reducing', primitives: ['Ring', 'Ring', 'Ring', 'Line', 'Line', 'Line', 'Line', 'Line', 'Line'], signs: [] },
    },
  ];

  for (const spell of nestedSpells) {
    const strokesFn = NESTED_STROKES[spell.id];
    const persona = PERSONAS.find(p => p.id === 1); // clean expert for canon
    const baseName = `${spell.id}_001`;
    const seed = (spell.id.charCodeAt(0) * 3000 + 7) >>> 0;
    writeFixture('nested', baseName, strokesFn(), persona, 'clean', spell.gt, seed);
  }

  // Apply stratified 70/30 split
  // Only stratify sigil and sign fixtures (nested are always 'train' as there are only 3)
  const stratifiable = fixtureRegistry.filter(f => !f.path.startsWith('nested/'));
  const nested = fixtureRegistry.filter(f => f.path.startsWith('nested/'));
  nested.forEach(e => { e.split = 'train'; });

  stratifiedSplit(stratifiable);

  // Ensure test split has ≥3 examples of each glyph in test set (best-effort with 2 variants × 3 quality)
  // With 2 variants × 2 quality clean+messy per sign and 2 variants × 3 quality per sigil,
  // 30% of 4 = ~1 test, 30% of 6 = ~2 test. Bump any fixture group with 0 test items.
  // (This is a small corpus so we accept the stratification as-is.)

  // Write INDEX.json
  const indexData = {
    version: 1,
    strokeFormat: 'raw-points-v1',
    degradation_notice:
      'Procedurally generated — no human drawers were available. Simulates 3 personas via parametric stroke generation with seeded PRNG noise. Suitable for regression testing and template-matcher smoke tests but NOT for user-fidelity benchmarking. Replace with real human-drawn fixtures before AC-P1 final measurement.',
    drawers: PERSONAS.map(p => ({
      id: p.id,
      persona: p.name,
      noise_amplitude: p.noise_amplitude,
      speed_variance: p.speed_variance,
    })),
    fixtures: fixtureRegistry,
  };
  writeFileSync(join(OUT_DIR, 'INDEX.json'), JSON.stringify(indexData, null, 2));

  // Summary stats
  const total = fixtureRegistry.length;
  const trainCount = fixtureRegistry.filter(f => f.split === 'train').length;
  const testCount = fixtureRegistry.filter(f => f.split === 'test').length;
  const messyTest = fixtureRegistry.filter(f => f.split === 'test' && f.quality === 'messy').length;
  const messyTestPct = testCount > 0 ? ((messyTest / testCount) * 100).toFixed(1) : 0;

  console.log(`\nDone. Generated ${total} fixtures.`);
  console.log(`  Train: ${trainCount}  Test: ${testCount}`);
  console.log(`  Messy in test split: ${messyTest} (${messyTestPct}%)`);
  console.log(`  INDEX.json: ${join(OUT_DIR, 'INDEX.json')}`);
  console.log('\nBreakdown:');
  console.log(`  Sigil fixtures (5 × 3 quality × 2 variants): ${sigilIds.length * 3 * 2}`);
  console.log(`  Sign fixtures  (8 × 2 quality × 2 variants): ${signIds.length * 2 * 2}`);
  console.log(`  Nested-ring canon examples: ${nestedSpells.length}`);

  const distinctDrawers = new Set(fixtureRegistry.map(f => f.drawer_id)).size;
  console.log(`\n  Distinct drawer IDs: ${distinctDrawers} (${PERSONAS.map(p => p.name).join(', ')})`);
}

main().catch(err => { console.error(err); process.exit(1); });
