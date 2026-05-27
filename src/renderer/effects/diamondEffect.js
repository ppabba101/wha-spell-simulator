import { clamp } from "../../utils/geometry.js";
import { activePortalPlane, effectOpacity } from "./effectUtils.js";

/**
 * M6 — Diamond overlay. Diamond is the nearby-objects aperture limiter:
 * the spell's manifestation is bound to a radius gate around the sigil.
 * Rendered as a rhombus outline above the portal so the clamp is visible.
 */
function diamondStrength(spellIR) {
  return clamp(spellIR?.manifestations?.diamond?.strength ?? 0);
}

export function drawDiamondEffect(ctx, _state, spellIR, ring) {
  const strength = diamondStrength(spellIR);
  if (strength <= 0.001) {
    return;
  }

  const opacity = effectOpacity(spellIR);
  const portal = activePortalPlane(ctx.canvas, ring);
  const radiusX = portal.radiusX * (0.62 - 0.18 * strength);
  const radiusY = portal.radiusY * (1.2 - 0.28 * strength);

  const points = [
    { x: portal.center.x, y: portal.center.y - radiusY },
    { x: portal.center.x + radiusX, y: portal.center.y },
    { x: portal.center.x, y: portal.center.y + radiusY },
    { x: portal.center.x - radiusX, y: portal.center.y }
  ];

  ctx.save();
  ctx.strokeStyle = `rgba(196, 162, 220, ${0.36 * strength * opacity})`;
  ctx.lineWidth = 5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = `rgba(236, 220, 252, ${0.52 * strength * opacity})`;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
