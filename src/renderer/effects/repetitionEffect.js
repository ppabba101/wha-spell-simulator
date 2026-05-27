import { clamp } from "../../utils/geometry.js";
import {
  activePortalPlane,
  effectOpacity,
  effectScale,
  scaledParticleCount
} from "./effectUtils.js";

/**
 * M6 — Repetition overlay. Visualises the "rewind / restore" effect by
 * spawning sparkle motes that radiate outward from the portal centre,
 * then easing back toward the centre over their lifetime. The reverse
 * traversal signals that the spell preserves / restores rather than
 * projects.
 */
const REPETITION_PARTICLE_BASE = 36;

function repetitionStrength(spellIR) {
  return clamp(spellIR?.manifestations?.repetition?.strength ?? 0);
}

function spawnRepetitionMote(portal, scale, strength, ring) {
  const angle = Math.random() * Math.PI * 2;
  const radiusX = portal.radiusX * (0.42 + 0.32 * strength);
  const radiusY = portal.radiusY * (0.42 + 0.32 * strength);
  return {
    angle,
    radiusX: radiusX * (0.7 + Math.random() * 0.3),
    radiusY: radiusY * (0.7 + Math.random() * 0.3),
    age: 0,
    life: 56 + Math.random() * 28,
    radius: 2.2 + Math.random() * 1.4 * (0.86 + scale * 0.18),
    phase: Math.random() * Math.PI * 2,
    sigilRadius: ring.radius
  };
}

function repetitionEase(t) {
  // Out-and-back: t in [0, 1]. 0 = at center, 0.5 = furthest, 1 = back at center.
  if (t < 0.5) {
    return t * 2; // 0..1
  }
  return (1 - t) * 2; // 1..0
}

export function drawRepetitionEffect(ctx, state, spellIR, ring, dt, config) {
  const strength = repetitionStrength(spellIR);
  if (strength <= 0.001) {
    return;
  }

  const scale = effectScale(spellIR);
  const opacity = effectOpacity(spellIR);
  const portal = activePortalPlane(ctx.canvas, ring);
  state.repetitionFrame = (state.repetitionFrame ?? 0) + dt;
  state.repetitionParticles = state.repetitionParticles ?? [];

  const targetCount = scaledParticleCount(
    REPETITION_PARTICLE_BASE * strength * (0.78 + scale * 0.32),
    spellIR,
    config
  );

  while (state.repetitionParticles.length < targetCount) {
    state.repetitionParticles.push(spawnRepetitionMote(portal, scale, strength, ring));
  }

  for (const particle of state.repetitionParticles) {
    particle.age += dt;
  }

  state.repetitionParticles = state.repetitionParticles.filter((particle) => particle.age < particle.life);

  for (const particle of state.repetitionParticles) {
    const t = particle.age / Math.max(1, particle.life);
    const reach = repetitionEase(t);
    const x = portal.center.x + Math.cos(particle.angle) * particle.radiusX * reach;
    const y = portal.center.y + Math.sin(particle.angle) * particle.radiusY * reach;
    // Twinkle: pulse the alpha with phase so the shimmer reads as motion.
    const twinkle = 0.6 + Math.sin(particle.phase + particle.age * 0.4) * 0.4;
    const alpha = (0.18 + reach * 0.62) * strength * opacity * twinkle;
    if (alpha <= 0.01) {
      continue;
    }
    ctx.fillStyle = `rgba(245, 240, 220, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, particle.radius * (0.86 + reach * 0.32), 0, Math.PI * 2);
    ctx.fill();
  }
}
