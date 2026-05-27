import { clamp, randomBetween } from "../../utils/geometry.js";
import {
  activePortalPlane,
  effectOpacity,
  effectScale,
  elementFlow,
  particleAlpha,
  particleDepth,
  pruneParticles,
  randomPortalPoint,
  scaledParticleCount
} from "./effectUtils.js";

/**
 * M6 — Dispersion overlay. Adds a wide spray of pale-gold motes that fan
 * outward from the portal plane at a 60-90° spread angle. Activated only
 * when the spell carries a `dispersion` manifestation. Rendered ON TOP of
 * the element effect so it visibly widens the cone, distinguishing the
 * frame from convergence (which compresses).
 */
const DISPERSION_PARTICLE_BASE = 56;
const DISPERSION_SPREAD_RAD = Math.PI / 2; // 90° spread angle

function dispersionStrength(spellIR) {
  return clamp(spellIR?.manifestations?.dispersion?.strength ?? 0);
}

function dispersionFlow(spellIR, ring, portal, frame) {
  const flow = elementFlow(spellIR, portal, frame);
  const { scale } = flow;
  const strength = dispersionStrength(spellIR);

  return {
    ...flow,
    strength,
    spreadRad: DISPERSION_SPREAD_RAD * (0.5 + strength * 0.5),
    speed: (1.4 + spellIR.force * 2.6) * (0.9 + scale * 0.1),
    sourceRadiusX: Math.min(0.34, 0.14 + scale * 0.08) * portal.radiusX,
    sourceRadiusY: Math.min(0.34, 0.16 + scale * 0.08) * portal.radiusY,
    life: 44 + spellIR.range * 32,
    moteRadius: 2.4 + spellIR.force * 1.8
  };
}

function spawnDispersionParticle(spellIR, portal, flow) {
  const source = randomPortalPoint(portal, flow.sourceRadiusX / portal.radiusX, flow.sourceRadiusY / portal.radiusY);
  // Pick a direction within ±spread/2 of the spell's forward vector.
  const angularOffset = (Math.random() - 0.5) * flow.spreadRad;
  const cos = Math.cos(angularOffset);
  const sin = Math.sin(angularOffset);
  const dx = flow.direction.x * cos - flow.direction.y * sin;
  const dy = flow.direction.x * sin + flow.direction.y * cos;
  const speed = flow.speed * (0.78 + Math.random() * 0.4);

  return {
    x: source.x,
    y: source.y,
    vx: dx * speed,
    vy: dy * speed,
    age: 0,
    life: flow.life * (0.86 + Math.random() * 0.28),
    radius: flow.moteRadius * (0.78 + Math.random() * 0.44),
    phase: Math.random() * Math.PI * 2
  };
}

function drawDispersionParticle(ctx, particle, opacity, flowStrength) {
  const depth = particleDepth(particle);
  const alpha = particleAlpha(particle) * opacity * flowStrength * (0.6 + depth * 0.4);
  if (alpha <= 0.01) {
    return;
  }
  ctx.fillStyle = `rgba(255, 226, 168, ${alpha})`;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, particle.radius * (0.9 + depth * 0.5), 0, Math.PI * 2);
  ctx.fill();
}

export function drawDispersionEffect(ctx, state, spellIR, ring, dt, config) {
  const strength = dispersionStrength(spellIR);
  if (strength <= 0.001) {
    return;
  }

  const scale = effectScale(spellIR);
  const opacity = effectOpacity(spellIR);
  const portal = activePortalPlane(ctx.canvas, ring);
  state.dispersionFrame = (state.dispersionFrame ?? 0) + dt;
  state.dispersionParticles = state.dispersionParticles ?? [];
  const flow = dispersionFlow(spellIR, ring, portal, state.dispersionFrame);
  const targetCount = scaledParticleCount(
    DISPERSION_PARTICLE_BASE * strength * (0.78 + scale * 0.32),
    spellIR,
    config
  );

  while (state.dispersionParticles.length < targetCount) {
    state.dispersionParticles.push(spawnDispersionParticle(spellIR, portal, flow));
  }

  for (const particle of state.dispersionParticles) {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }

  state.dispersionParticles = state.dispersionParticles.filter((particle) => particle.age < particle.life);

  for (const particle of state.dispersionParticles) {
    drawDispersionParticle(ctx, particle, opacity, strength);
  }
}
