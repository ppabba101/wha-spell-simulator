/**
 * M7b — Bloom pass.
 *
 * Wraps `@pixi/filter-advanced-bloom`'s `AdvancedBloomFilter`. Applied to the
 * effect-stage container; gated by `settings.graphics.bloom`. Hot-swap-able
 * via `setBloomEnabled(bool)` — turning it off detaches the filter without
 * remounting the stage (renderer identity is preserved).
 *
 * Quality steps `low|med|high` map to bloom kernel size + pass count.
 */

import { setBloomFilterRef } from "./stage.js";

const QUALITY_PRESETS = {
  low: { threshold: 0.6, bloomScale: 0.8, brightness: 1.0, blur: 4, quality: 2 },
  med: { threshold: 0.5, bloomScale: 1.1, brightness: 1.05, blur: 6, quality: 4 },
  high: { threshold: 0.4, bloomScale: 1.4, brightness: 1.1, blur: 8, quality: 6 }
};

let _filter = null;
let _enabled = false;
let _quality = "high";
let _loadPromise = null;

async function loadFilterClass() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = import("@pixi/filter-advanced-bloom")
    .then((mod) => mod.AdvancedBloomFilter ?? mod.default?.AdvancedBloomFilter ?? mod.default)
    .catch((err) => {
      console.warn("[effectsPixi.bloom] failed to load AdvancedBloomFilter:", err?.message ?? err);
      return null;
    });
  return _loadPromise;
}

async function ensureFilter(quality = _quality) {
  if (_filter) return _filter;
  const Cls = await loadFilterClass();
  if (!Cls) return null;
  try {
    _filter = new Cls(QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.high);
    setBloomFilterRef(_filter);
    return _filter;
  } catch (err) {
    console.warn("[effectsPixi.bloom] AdvancedBloomFilter init failed:", err?.message ?? err);
    return null;
  }
}

/**
 * Returns the live filter instance or null if init failed.
 */
export async function getBloomFilter() {
  return ensureFilter();
}

/**
 * Hot-swap bloom on/off. Does NOT recreate the filter; merely attaches or
 * detaches via the `enabled` flag the renderer reads at composite time.
 */
export function setBloomEnabled(value) {
  _enabled = !!value;
  if (_filter && "enabled" in _filter) {
    _filter.enabled = _enabled;
  }
  return _enabled;
}

export function isBloomEnabled() {
  return _enabled;
}

/**
 * Hot-swap bloom quality. Re-uses the same filter instance by patching its
 * tunable properties — does NOT replace it. Renderer identity preserved.
 */
export async function setBloomQuality(quality) {
  if (!QUALITY_PRESETS[quality]) return;
  _quality = quality;
  const f = await ensureFilter(quality);
  if (!f) return;
  const preset = QUALITY_PRESETS[quality];
  for (const [k, v] of Object.entries(preset)) {
    if (k in f) {
      try {
        f[k] = v;
      } catch {
        // ignore — read-only props vary across filter versions
      }
    }
  }
}

export function __resetBloomForTest() {
  _filter = null;
  _enabled = false;
  _quality = "high";
  _loadPromise = null;
}

export const BLOOM_QUALITY_PRESETS = QUALITY_PRESETS;
