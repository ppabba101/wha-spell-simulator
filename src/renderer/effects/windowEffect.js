import { clamp } from "../../utils/geometry.js";
import { activePortalPlane, effectOpacity } from "./effectUtils.js";

/**
 * M6 — Window overlay. Window is the on-surface aperture limiter: the
 * spell's manifestation is bound to a rectangle drawn around the seal.
 * We render the rectangle outline so the viewer can see the clamp.
 */
function windowStrength(spellIR) {
  return clamp(spellIR?.manifestations?.window?.strength ?? 0);
}

export function drawWindowEffect(ctx, _state, spellIR, ring) {
  const strength = windowStrength(spellIR);
  if (strength <= 0.001) {
    return;
  }

  const opacity = effectOpacity(spellIR);
  const portal = activePortalPlane(ctx.canvas, ring);
  const halfW = portal.radiusX * (0.72 - 0.18 * strength);
  const halfH = portal.radiusY * (1.4 - 0.32 * strength);

  ctx.save();
  ctx.strokeStyle = `rgba(214, 198, 161, ${0.34 * strength * opacity})`;
  ctx.lineWidth = 5;
  ctx.setLineDash([14, 8]);
  ctx.beginPath();
  ctx.rect(portal.center.x - halfW, portal.center.y - halfH, halfW * 2, halfH * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255, 240, 200, ${0.5 * strength * opacity})`;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.rect(portal.center.x - halfW, portal.center.y - halfH, halfW * 2, halfH * 2);
  ctx.stroke();
  ctx.restore();
}
