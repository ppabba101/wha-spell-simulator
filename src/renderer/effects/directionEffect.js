import { clamp } from "../../utils/geometry.js";
import { activePortalPlane, effectOpacity } from "./effectUtils.js";

/**
 * M6 — Direction overlay. Renders a faint chevron indicator at the portal
 * plane pointing along the spell's primary surface vector when one or more
 * `direction` signs are present. The chevron telegraphs to the viewer
 * where the spell is biased, separate from the element's own particles.
 */
function directionStrength(spellIR) {
  return clamp(spellIR?.manifestations?.direction?.strength ?? 0);
}

function spellSurfaceVector(spellIR) {
  const direction = spellIR?.direction ?? {};
  const x = direction.x ?? 0;
  const y = direction.y ?? -1;
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.001) {
    return { x: 0, y: -1 };
  }
  return { x: x / magnitude, y: y / magnitude };
}

export function drawDirectionEffect(ctx, _state, spellIR, ring) {
  const strength = directionStrength(spellIR);
  if (strength <= 0.001) {
    return;
  }

  const opacity = effectOpacity(spellIR);
  const portal = activePortalPlane(ctx.canvas, ring);
  const vector = spellSurfaceVector(spellIR);
  // Side vector perpendicular to direction for the chevron wings.
  const side = { x: -vector.y, y: vector.x };
  const arm = ring.radius * (0.18 + strength * 0.12);
  const wingAngle = ring.radius * (0.12 + strength * 0.08);

  const apex = {
    x: portal.center.x + vector.x * arm,
    y: portal.center.y + vector.y * arm
  };
  const wingLeft = {
    x: apex.x - vector.x * arm * 0.6 + side.x * wingAngle,
    y: apex.y - vector.y * arm * 0.6 + side.y * wingAngle
  };
  const wingRight = {
    x: apex.x - vector.x * arm * 0.6 - side.x * wingAngle,
    y: apex.y - vector.y * arm * 0.6 - side.y * wingAngle
  };

  ctx.save();
  ctx.strokeStyle = `rgba(178, 220, 245, ${0.22 * strength * opacity})`;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(wingLeft.x, wingLeft.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(wingRight.x, wingRight.y);
  ctx.stroke();

  ctx.strokeStyle = `rgba(232, 244, 255, ${0.42 * strength * opacity})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(wingLeft.x, wingLeft.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(wingRight.x, wingRight.y);
  ctx.stroke();
  ctx.restore();
}
