/**
 * Judge overlay canvas (M3 surface 1 of 3).
 *
 * Renders WHA-DSL primitives streamed from the judge onto a transparent canvas
 * stacked above #effectCanvas. Each primitive carries its own appearance:
 *   - Ring       -> translucent silver circle with a 600ms pulsing inner glow
 *                   on first emit; persists at low opacity afterward
 *   - Line       -> silver segment with fade-in
 *   - Arc        -> silver arc
 *   - Dot        -> small radial glow
 *   - Symmetry   -> low-opacity dashed axis hints
 *
 * Single requestAnimationFrame loop drives the overlay; when setEnabled(false)
 * the canvas is cleared and the loop stops. Primitives that have fully settled
 * are persisted at low opacity so we don't lose context between partial events.
 */

const PULSE_DURATION_MS = 600;
const FADE_IN_MS = 240;
const SETTLED_OPACITY = 0.4;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function primitiveKey(p, index) {
  if (!p || typeof p !== "object") return `i${index}`;
  switch (p.type) {
    case "Ring":
      return `Ring|${round(p.cx)}|${round(p.cy)}|${round(p.r)}`;
    case "Line":
      return `Line|${round(p.a1)}|${round(p.a2)}|${round(p.length)}`;
    case "Arc":
      return `Arc|${round(p.cx)}|${round(p.cy)}|${round(p.r)}|${round(p.startAngle)}|${round(p.endAngle)}`;
    case "Dot":
      return `Dot|${round(p.cx)}|${round(p.cy)}`;
    case "Symmetry":
      return `Symmetry|${p.n}|${round(p.centerX)}|${round(p.centerY)}`;
    default:
      return `${p.type}|${index}`;
  }
}

function round(n) {
  return Math.round(Number(n) || 0);
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Public factory.
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas  the #judgeOverlayCanvas element
 * @param {object} [opts.settings]         current settings snapshot (read-only)
 * @returns {{
 *   onPartial: (partial: object) => void,
 *   onFinal: (final: object) => void,
 *   clear: () => void,
 *   setEnabled: (bool: boolean) => void,
 *   destroy: () => void,
 * }}
 */
export function createJudgeOverlay({ canvas, settings = {} } = {}) {
  const state = {
    enabled: settings?.surfaces?.canvasOverlay !== false,
    rafId: null,
    /** @type {Map<string, { primitive: object, addedAt: number, settled: boolean }>} */
    primitives: new Map(),
    canvas: canvas ?? null,
    ctx: canvas ? canvas.getContext("2d") : null
  };

  function recordPrimitives(primitives) {
    if (!Array.isArray(primitives)) return;
    primitives.forEach((p, i) => {
      if (!p || typeof p !== "object") return;
      const key = primitiveKey(p, i);
      if (!state.primitives.has(key)) {
        state.primitives.set(key, { primitive: p, addedAt: nowMs(), settled: false });
      } else {
        // Update payload in place so we pick up newer numeric values.
        const existing = state.primitives.get(key);
        existing.primitive = p;
      }
    });
  }

  function settleAll() {
    for (const entry of state.primitives.values()) {
      entry.settled = true;
    }
  }

  function clear() {
    state.primitives.clear();
    paint();
  }

  function setEnabled(enabled) {
    state.enabled = !!enabled;
    if (!state.enabled) {
      stopLoop();
      paintClearOnly();
    } else if (state.canvas) {
      startLoop();
    }
  }

  function destroy() {
    stopLoop();
    state.primitives.clear();
    paintClearOnly();
  }

  function onPartial(partial) {
    if (!state.enabled || !state.canvas) return;
    recordPrimitives(partial?.primitives);
    startLoop();
  }

  function onFinal(final) {
    if (!state.enabled || !state.canvas) return;
    recordPrimitives(final?.primitives);
    settleAll();
    startLoop();
  }

  // ---- Rendering ----

  function startLoop() {
    if (state.rafId !== null) return;
    if (typeof requestAnimationFrame === "undefined") return;
    const tick = () => {
      state.rafId = null;
      paint();
      if (state.enabled && state.primitives.size > 0) {
        state.rafId = requestAnimationFrame(tick);
      }
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (state.rafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(state.rafId);
    }
    state.rafId = null;
  }

  function paintClearOnly() {
    if (!state.ctx || !state.canvas) return;
    state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  }

  function paint() {
    if (!state.ctx || !state.canvas) return;
    const ctx = state.ctx;
    const t = nowMs();
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    if (!state.enabled) return;

    for (const entry of state.primitives.values()) {
      const ageMs = t - entry.addedAt;
      const fadeIn = clamp01(ageMs / FADE_IN_MS);
      const settledFactor = entry.settled ? SETTLED_OPACITY : 1;
      const baseAlpha = SETTLED_OPACITY * fadeIn * (entry.settled ? 1 : 1.4);
      const alpha = clamp01(baseAlpha) * (entry.settled ? settledFactor / SETTLED_OPACITY : 1);

      const pulseT = clamp01(ageMs / PULSE_DURATION_MS);
      const pulseEnergy = entry.settled ? 0 : 1 - pulseT;

      drawPrimitive(ctx, entry.primitive, alpha, pulseEnergy);
    }
  }

  function drawPrimitive(ctx, p, alpha, pulseEnergy) {
    if (!p || typeof p !== "object") return;
    switch (p.type) {
      case "Ring":
        drawRing(ctx, p, alpha, pulseEnergy);
        return;
      case "Line":
        drawLine(ctx, p, alpha);
        return;
      case "Arc":
        drawArc(ctx, p, alpha);
        return;
      case "Dot":
        drawDot(ctx, p, alpha);
        return;
      case "Symmetry":
        drawSymmetry(ctx, p, alpha);
        return;
      default:
        return;
    }
  }

  function drawRing(ctx, p, alpha, pulseEnergy) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(180, 220, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
    ctx.stroke();

    // Translucent silver fill (very low opacity) — gives the "glow" feeling.
    ctx.fillStyle = `rgba(220, 232, 250, ${alpha * 0.25})`;
    ctx.fill();

    if (pulseEnergy > 0) {
      ctx.lineWidth = 4 + pulseEnergy * 6;
      ctx.strokeStyle = `rgba(200, 230, 255, ${alpha * pulseEnergy * 0.8})`;
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, p.r * (1 + 0.04 * pulseEnergy), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLine(ctx, p, alpha) {
    // `a1`/`a2` are angles in radians; `length` is the segment length.
    // We approximate a midpoint near the canvas centre for the unanchored
    // partial primitives that arrive without absolute coordinates.
    const cx = state.canvas.width / 2;
    const cy = state.canvas.height / 2;
    const x1 = cx + Math.cos(p.a1) * p.length * 0.5;
    const y1 = cy + Math.sin(p.a1) * p.length * 0.5;
    const x2 = cx + Math.cos(p.a2) * p.length * 0.5;
    const y2 = cy + Math.sin(p.a2) * p.length * 0.5;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(200, 220, 240, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawArc(ctx, p, alpha) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(180, 220, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.r, p.startAngle, p.endAngle);
    ctx.stroke();
    ctx.restore();
  }

  function drawDot(ctx, p, alpha) {
    const r = Math.max(2, Number(p.r) || 3);
    ctx.save();
    const gradient = ctx.createRadialGradient(p.cx, p.cy, 0, p.cx, p.cy, r * 4);
    gradient.addColorStop(0, `rgba(230, 245, 255, ${alpha})`);
    gradient.addColorStop(1, `rgba(230, 245, 255, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, r * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSymmetry(ctx, p, alpha) {
    const n = Math.max(2, p.n | 0);
    const cx = Number(p.centerX) || state.canvas.width / 2;
    const cy = Number(p.centerY) || state.canvas.height / 2;
    const len = Math.min(state.canvas.width, state.canvas.height) / 2;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = `rgba(180, 220, 255, ${alpha * 0.6})`;
    for (let i = 0; i < n; i += 1) {
      const angle = (i / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // First paint so the canvas isn't garbage when the user toggles in.
  if (state.enabled && state.canvas) {
    paintClearOnly();
  }

  return {
    onPartial,
    onFinal,
    clear,
    setEnabled,
    destroy,
    // Test-only hooks.
    _internal: {
      getPrimitiveCount: () => state.primitives.size,
      paintNow: paint
    }
  };
}
