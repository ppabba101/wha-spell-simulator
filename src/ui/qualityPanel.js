/**
 * M5 — Quality panel UI.
 *
 * Renders four meters (Cleanliness, Length, Closure Precision, Symmetry) for
 * the explicit `qualityMetrics` block produced by `spellBuilder.compileSpell`.
 *
 * Each meter has a tooltip explaining what it measures and how it affects
 * spell power. Lane 2 §4 canon: cleanliness drives lifetime; length drives
 * scale up to the 2.5× cap.
 *
 * INTEGRATION NOTE for M3:
 *   This module does NOT modify `main.js`, `index.html`, or `styles.css`.
 *   M3 owns those files. Instead, qualityPanel subscribes to a global
 *   `spell:compiled` CustomEvent that M3 will dispatch in main.js after
 *   each `compileSpell` call:
 *
 *     window.dispatchEvent(
 *       new CustomEvent('spell:compiled', { detail: { spellIR } })
 *     );
 *
 *   Mount this panel in main.js once M3 lands; subscribe to spell:compiled.
 *   Until then, callers may call `update(spellIR.qualityMetrics)` directly.
 */

import { LENGTH_CAP } from "../compiler/spellQuality.js";

/**
 * Tooltip copy for each meter — keeps the panel self-documenting so users
 * understand what each axis costs/rewards.
 */
const TOOLTIPS = Object.freeze({
  cleanliness:
    "Cleanliness — weighted composite of stroke smoothness, continuity, closure precision, and symmetry. Drives spell duration and contributes to power (0.4×). Lane 2 §4: neatly drawn seals last longer than messy ones.",
  length:
    "Length — total ink length divided by the outer ring's circumference, capped at 2.5×. Anything beyond 1.0× is overdraw/spirals. Contributes 0.2× to power.",
  closurePrecision:
    "Closure Precision — how tightly the outer ring's join-point seals. 100% means a complete ring; 0% means a wide gap. Spells stay prepared until closure precision hits 100%.",
  symmetry:
    "Symmetry — radial-angle balance across the seal's keystones. High symmetry channels intent evenly; low symmetry biases the effect direction."
});

const METER_KEYS = Object.freeze(["cleanliness", "length", "closurePrecision", "symmetry"]);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else if (k === "dataset") for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function meterRow(key, label) {
  const labelSpan = el("span", { className: "quality-panel-label", text: label });
  const meter = el("div", { className: "meter", role: "progressbar", "aria-label": label });
  const bar = el("span", { className: "quality-panel-bar", dataset: { meter: key } });
  meter.appendChild(bar);
  const value = el("span", {
    className: "quality-panel-value",
    dataset: { meter: `${key}Value` },
    text: "0%"
  });
  const row = el("div", { className: "quality-panel-row", dataset: { meterRow: key }, title: TOOLTIPS[key] }, [
    labelSpan,
    meter,
    value
  ]);
  return { row, bar, value };
}

function formatPercent(value) {
  const pct = Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)));
  return `${pct}%`;
}

function normaliseLengthForDisplay(length) {
  // Length is recorded on a 0..LENGTH_CAP scale; the panel shows it as
  // percent of cap so the meter UI stays consistent with the 0..1 meters.
  const cap = LENGTH_CAP || 2.5;
  return Math.max(0, Math.min(1, (length ?? 0) / cap));
}

/**
 * Public API.
 *
 * @param {{ mountEl: HTMLElement }} options
 * @returns {{ update: (qualityMetrics: object) => void, reset: () => void, destroy: () => void, element: HTMLElement }}
 */
export function createQualityPanel({ mountEl }) {
  if (!mountEl) {
    throw new Error("createQualityPanel: mountEl is required");
  }

  const root = el("section", { className: "quality-panel", "aria-label": "Spell Quality" });
  const heading = el("h3", { className: "quality-panel-heading", text: "Quality" });
  root.appendChild(heading);

  const rows = new Map();
  for (const key of METER_KEYS) {
    const label = ({
      cleanliness: "Cleanliness",
      length: "Length",
      closurePrecision: "Closure",
      symmetry: "Symmetry"
    })[key];
    const { row, bar, value } = meterRow(key, label);
    rows.set(key, { row, bar, value });
    root.appendChild(row);
  }

  mountEl.appendChild(root);

  let listener = null;

  function update(qualityMetrics) {
    const metrics = qualityMetrics ?? {};
    const display = {
      cleanliness: metrics.cleanliness ?? 0,
      // Length renders as percent-of-cap so the 0..2.5 scale fits the 0..100% UI.
      length: normaliseLengthForDisplay(metrics.length),
      closurePrecision: metrics.closurePrecision ?? 0,
      symmetry: metrics.symmetry ?? 0
    };

    for (const key of METER_KEYS) {
      const entry = rows.get(key);
      if (!entry) continue;
      const pct = formatPercent(display[key]);
      entry.bar.style.width = pct;
      entry.value.textContent = pct;
    }
  }

  function reset() {
    update({
      cleanliness: 0,
      length: 0,
      closurePrecision: 0,
      symmetry: 0
    });
  }

  function handleCompiled(event) {
    const ir = event?.detail?.spellIR;
    if (!ir) return;
    update(ir.qualityMetrics ?? {});
  }

  // Subscribe to the global `spell:compiled` event so M3's main.js can hand
  // off without importing this module directly. The listener is optional —
  // callers may also drive update() manually.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    listener = handleCompiled;
    window.addEventListener("spell:compiled", listener);
  }

  reset();

  return {
    update,
    reset,
    destroy() {
      if (listener && typeof window !== "undefined") {
        window.removeEventListener("spell:compiled", listener);
        listener = null;
      }
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    },
    element: root
  };
}
