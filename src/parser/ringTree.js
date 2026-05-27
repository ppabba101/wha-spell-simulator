/**
 * Nested-ring tree helpers (M4).
 *
 * The ring detector now emits `glyphAST.rings: Ring[]` (a tree — each ring may
 * own `children: Ring[]`). For backward compatibility, the legacy flat
 * `glyphAST.ring` still points at the outer-most ring's summary so existing
 * call sites keep working until they migrate to the tree form.
 *
 * Containment rule: ring A is a child of ring B when A's centre falls inside
 * B's disc AND A.radius < B.radius. We pick the smallest enclosing ring as the
 * direct parent so deep nesting forms a chain, not a star.
 */

import { distance } from "../utils/geometry.js";

/**
 * Build a tree of rings from a flat list of detected rings.
 *
 * @param {Array<object>} rings  flat ring summaries; each must have `center`
 *   (or `centerX`/`centerY`) and `radius`.
 * @returns {Array<object>} top-level rings, each with `children: Ring[]` and
 *   a stable numeric `ringId` assigned in detection order.
 */
export function buildRingTree(rings) {
  if (!Array.isArray(rings) || !rings.length) {
    return [];
  }

  const nodes = rings.map((ring, index) => {
    const center = ring.center ?? {
      x: ring.centerX ?? 0,
      y: ring.centerY ?? 0
    };
    return {
      ...ring,
      ringId: index,
      center,
      centerX: center.x,
      centerY: center.y,
      children: []
    };
  });

  // Sort by radius ascending so we find the smallest enclosing parent first
  // when scanning from largest to smallest.
  const byRadiusDesc = [...nodes].sort((a, b) => b.radius - a.radius);
  const rootSet = new Set(nodes);

  for (let i = 0; i < nodes.length; i += 1) {
    const child = nodes[i];
    let bestParent = null;
    let bestParentRadius = Infinity;

    for (const candidate of byRadiusDesc) {
      if (candidate === child) {
        continue;
      }
      if (candidate.radius <= child.radius) {
        continue;
      }
      const d = distance(candidate.center, child.center);
      if (d <= candidate.radius && candidate.radius < bestParentRadius) {
        bestParent = candidate;
        bestParentRadius = candidate.radius;
      }
    }

    if (bestParent) {
      bestParent.children.push(child);
      rootSet.delete(child);
    }
  }

  return [...rootSet].sort((a, b) => b.radius - a.radius);
}

/**
 * Backwards-compatible accessor — returns the outermost ring summary or null.
 * Existing read-sites that only care about a single ring stay correct on
 * single-ring spells and pick up the outer activation gate on nested spells.
 *
 * @param {object} ast  GlyphAST (or anything with .rings or .ring)
 * @returns {object|null}
 */
export function getOuterRing(ast) {
  if (!ast) {
    return null;
  }
  if (Array.isArray(ast.rings) && ast.rings.length) {
    // The detector lists the largest ring first; that is the activation gate.
    return ast.rings[0];
  }
  if (ast.ring) {
    return ast.ring;
  }
  return null;
}

/**
 * Walks the ring tree top-down (outer → inner) yielding each node with its
 * depth. Used by the compiler to enumerate annulus modifier layers.
 */
export function* walkRings(roots, depth = 0) {
  for (const node of roots ?? []) {
    yield { ring: node, depth };
    yield* walkRings(node.children ?? [], depth + 1);
  }
}

/**
 * Collect every ring in the tree (depth-first, outer→inner per branch).
 */
export function flattenRings(roots) {
  const out = [];
  for (const { ring, depth } of walkRings(roots)) {
    out.push({ ring, depth });
  }
  return out;
}

/**
 * Returns the innermost ring on the deepest branch (the one that holds the
 * core element sigil). Falls back to the outer ring on a single-ring AST.
 */
export function getInnermostRing(roots) {
  const all = flattenRings(roots);
  if (!all.length) {
    return null;
  }
  let best = all[0];
  for (const entry of all) {
    if (entry.depth > best.depth) {
      best = entry;
    }
  }
  return best.ring;
}
