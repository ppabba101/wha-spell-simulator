import { getStroke } from "perfect-freehand";

// M7a — perfect-freehand renders the ink path as a tessellated polygon.
// The freehand polygon is a RENDERING ARTIFACT only — it is *never* fed back
// into the parser. The raw point list (preserved on stroke.points and on
// fixtures as raw-points-v1 [x, y, t_ms, pressure] tuples) remains the
// canonical input to the recognition pipeline.
const FREEHAND_OPTIONS_BASE = {
  size: 6.2,
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t) => t,
  last: true
};

// Convert a stroke's normalised points (x, y, pressure?, t?) into the tuple
// shape perfect-freehand expects: [x, y, pressure].
function pointsToFreehandInput(points) {
  const input = new Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const pressure = typeof p.pressure === "number" ? p.pressure : 0.5;
    input[i] = [p.x, p.y, pressure];
  }
  return input;
}

// Detect whether any point in the stroke carries a real (non-fallback) pressure
// value. Mouse input is normalised to a constant 0.5 in pointerNormalizer; only
// stylus input produces a distribution that varies away from that midpoint.
function hasRealPressure(points) {
  if (!points || points.length === 0) return false;
  let nonHalfCount = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i].pressure;
    if (typeof p === "number" && Math.abs(p - 0.5) > 0.01 && p > 0) {
      nonHalfCount += 1;
    }
  }
  // Two or more samples away from 0.5 means the input device reported real
  // pressure variation, so we trust it; otherwise we simulate.
  return nonHalfCount >= 2;
}

function freehandOptionsFor(points, overrides = {}) {
  const simulate = !hasRealPressure(points);
  return {
    ...FREEHAND_OPTIONS_BASE,
    simulatePressure: simulate,
    ...overrides
  };
}

// Cache the freehand polygon on the stroke object keyed on a stable signature
// (point count + endpoint positions). Recomputing 100+ point polygons every
// frame at 60fps is the dominant render cost; the cache cuts that to one
// compute per stroke per shape change.
function freehandPolygonForStroke(stroke, options) {
  if (!stroke?.points?.length) return null;
  const cacheKey = `${stroke.points.length}:${stroke.points[0]?.x ?? 0}:${stroke.points[0]?.y ?? 0}:${
    stroke.points[stroke.points.length - 1]?.x ?? 0
  }:${stroke.points[stroke.points.length - 1]?.y ?? 0}`;
  if (stroke.__freehandCacheKey === cacheKey && stroke.__freehandPolygon) {
    return stroke.__freehandPolygon;
  }
  const polygon = getStroke(pointsToFreehandInput(stroke.points), options);
  // Mutating the stroke object is safe here because strokeStore.getStrokes()
  // already returns fresh copies; the cache is per-frame-cycle, not persistent.
  try {
    Object.defineProperty(stroke, "__freehandCacheKey", { value: cacheKey, configurable: true });
    Object.defineProperty(stroke, "__freehandPolygon", { value: polygon, configurable: true });
  } catch {
    // Frozen objects fall through silently — getStroke will run each frame.
  }
  return polygon;
}

function fillFreehandPolygon(ctx, polygon) {
  if (!polygon || polygon.length === 0) return;
  ctx.beginPath();
  for (let i = 0; i < polygon.length; i += 1) {
    const [x, y] = polygon[i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

const GLOW_LAYERS = [
  {
    shadowColor: "rgb(110, 185, 212)",
    shadowBlur: ({ pulse, flicker, glowAlpha }) => (24 + pulse * 18 + flicker * 10) * glowAlpha,
    strokeStyle: ({ pulse, glowAlpha }) => `rgba(120, 220, 255, ${(0.18 + pulse * 0.12) * glowAlpha})`,
    lineWidth: ({ pulse, glowAlpha }) => 4 + (8 + pulse * 2) * glowAlpha
  },
  {
    shadowColor: "rgb(117, 150, 161)",
    shadowBlur: ({ pulse, glowAlpha }) => (10 + pulse * 6) * glowAlpha,
    strokeStyle: ({ pulse, glowAlpha }) => `rgba(187, 225, 237, ${(0.88 + pulse * 0.12) * glowAlpha})`,
    lineWidth: ({ pulse, glowAlpha }) => 1.8 + (2 + pulse * 0.6) * glowAlpha
  }
];

function hasStrokePoints(stroke) {
  return Boolean(stroke?.points?.length);
}

function traceStrokePath(ctx, stroke) {
  const firstPoint = stroke.points[0];
  ctx.beginPath();
  ctx.moveTo(firstPoint.x, firstPoint.y);
  for (let index = 1; index < stroke.points.length; index += 1) {
    const point = stroke.points[index];
    ctx.lineTo(point.x, point.y);
  }
}

function drawSingleStroke(ctx, stroke, options = {}) {
  if (!hasStrokePoints(stroke)) {
    return;
  }

  // M7a — perfect-freehand fill replaces the legacy lineTo stroke. Per-stroke
  // size derives from the requested lineWidth so element renderers keep their
  // visual weight contract. simulatePressure switches off automatically when
  // the device reports real stylus pressure.
  const size = (options.lineWidth ?? 4.2) * 1.05;
  const polygon = freehandPolygonForStroke(
    stroke,
    freehandOptionsFor(stroke.points, { size })
  );
  if (!polygon || polygon.length === 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = options.color ?? "#241b16";
  ctx.globalAlpha = options.alpha ?? 1;
  fillFreehandPolygon(ctx, polygon);
  ctx.restore();
}

function strokeLabelAnchor(stroke) {
  if (!hasStrokePoints(stroke)) {
    return null;
  }
  if (stroke.points.length === 1) {
    return stroke.points[0];
  }

  let totalLength = 0;
  for (let index = 1; index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1];
    const current = stroke.points[index];
    totalLength += Math.hypot(current.x - previous.x, current.y - previous.y);
  }

  const targetLength = totalLength / 2;
  let walkedLength = 0;
  for (let index = 1; index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1];
    const current = stroke.points[index];
    const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (walkedLength + segmentLength >= targetLength) {
      const local = segmentLength <= 0 ? 0 : (targetLength - walkedLength) / segmentLength;
      return {
        x: previous.x + (current.x - previous.x) * local,
        y: previous.y + (current.y - previous.y) * local
      };
    }
    walkedLength += segmentLength;
  }

  return stroke.points[stroke.points.length - 1];
}

function clampLabelPosition(ctx, x, y, width, height) {
  return {
    x: Math.max(4, Math.min(ctx.canvas.width - width - 4, x)),
    y: Math.max(height + 4, Math.min(ctx.canvas.height - 4, y))
  };
}

function drawGlowingStrokeLayer(ctx, stroke, glow, layer) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = layer.shadowBlur(glow);
  ctx.shadowColor = layer.shadowColor;
  ctx.strokeStyle = layer.strokeStyle(glow);
  ctx.lineWidth = layer.lineWidth(glow);
  traceStrokePath(ctx, stroke);
  ctx.stroke();
  ctx.restore();
}

function drawSingleGlowingStroke(ctx, stroke, timestamp, glowAlpha = 1) {
  if (!hasStrokePoints(stroke)) {
    return;
  }

  const glow = {
    pulse: 0.5 + Math.sin(timestamp * 0.004) * 0.5,
    flicker: Math.random() * 0.08,
    glowAlpha
  };

  for (const layer of GLOW_LAYERS) {
    drawGlowingStrokeLayer(ctx, stroke, glow, layer);
  }
}

export function drawStrokes(ctx, strokes, currentStroke, config, options = {}) {
  // M7a — `inkAlphaScale` lets the caller dim the rendered glyph when a
  // prepared (open-ring) spell is active. The renderer keeps the raw point
  // list unchanged; only the rendered ink alpha is scaled.
  const inkScale = typeof options.inkAlphaScale === "number" ? options.inkAlphaScale : 1;
  for (const stroke of strokes) {
    drawSingleStroke(ctx, stroke, {
      color: config.renderer.inkColor,
      lineWidth: 4.4,
      alpha: 0.94 * inkScale
    });
  }

  if (currentStroke) {
    drawSingleStroke(ctx, currentStroke, {
      color: config.renderer.inkColor,
      lineWidth: 4.4,
      alpha: 0.72 * inkScale
    });
  }
}

function activeGlowStrokes(activatedStrokeIds, strokes) {
  const glowingStrokes = [];

  for (const stroke of strokes) {
    if (activatedStrokeIds.has(stroke.id)) {
      glowingStrokes.push(stroke);
    }
  }

  return glowingStrokes;
}

function glowAlphaAt(timestamp, activatedAt, duration) {
  const elapsed = timestamp - activatedAt;
  const t = Math.min(1, elapsed / duration);
  return Math.pow(1 - t, 2);
}

export function drawGlowingStrokes(
  ctx,
  activatedAt,
  activatedStrokeIds,
  strokes,
  duration,
  timestamp = performance.now()
) {
  if (!activatedStrokeIds?.size || !activatedAt) {
    return;
  }

  const glowAlpha = glowAlphaAt(timestamp, activatedAt, duration);
  if (glowAlpha <= 0) {
    return;
  }

  for (const stroke of activeGlowStrokes(activatedStrokeIds, strokes)) {
    drawSingleGlowingStroke(ctx, stroke, timestamp, glowAlpha);
  }
}

export function drawRingDebug(ctx, ring) {
  if (!ring?.found) {
    return;
  }

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ring.complete ? "rgba(184, 69, 49, 0.72)" : "rgba(31, 111, 115, 0.72)";
  ctx.setLineDash(ring.complete ? [] : [10, 10]);
  ctx.beginPath();
  ctx.arc(ring.center.x, ring.center.y, ring.radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(36, 27, 22, 0.62)";
  ctx.beginPath();
  ctx.arc(ring.center.x, ring.center.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawStrokeIdDebug(ctx, strokes) {
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;

  for (const stroke of strokes ?? []) {
    const anchor = strokeLabelAnchor(stroke);
    if (!anchor || !stroke.id) {
      continue;
    }

    const label = stroke.id;
    const paddingX = 5;
    const paddingY = 3;
    const textMetrics = ctx.measureText(label);
    const boxWidth = Math.ceil(textMetrics.width + paddingX * 2);
    const boxHeight = 18;
    const position = clampLabelPosition(ctx, anchor.x + 7, anchor.y - 9, boxWidth, boxHeight);

    ctx.fillStyle = "rgba(255, 251, 233, 0.88)";
    ctx.strokeStyle = "rgba(36, 27, 22, 0.34)";
    ctx.beginPath();
    ctx.roundRect(position.x, position.y - boxHeight / 2, boxWidth, boxHeight, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(36, 27, 22, 0.86)";
    ctx.fillText(label, position.x + paddingX, position.y + paddingY - 2);
  }

  ctx.restore();
}

export function drawCandidateDebug(ctx, candidates, recognitions) {
  const byCandidate = new Map((recognitions ?? []).map((recognition) => [recognition.candidateId, recognition]));

  ctx.save();
  ctx.lineWidth = 1.5;
  for (const candidate of candidates ?? []) {
    const recognition = byCandidate.get(candidate.candidateId);
    const accepted = recognition?.recognized;
    ctx.strokeStyle = accepted ? "rgba(31, 111, 115, 0.82)" : "rgba(184, 69, 49, 0.74)";
    ctx.fillStyle = accepted ? "rgba(31, 111, 115, 0.92)" : "rgba(184, 69, 49, 0.92)";
    ctx.strokeRect(candidate.bounds.minX, candidate.bounds.minY, candidate.bounds.width, candidate.bounds.height);
    const label = accepted
      ? `${recognition.id} ${Math.round(recognition.confidence * 100)}`
      : `${candidate.candidateId}`;
    ctx.fillText(label, candidate.bounds.minX, Math.max(12, candidate.bounds.minY - 5));
  }
  ctx.restore();
}
