/**
 * AST↔DSL Mapper — Principle 1 enforcement module.
 *
 * The internal AST is **tree-structured** (Ring nodes own `children: Ring[]`)
 * and matches canonical Witch-Hat-Atelier nested-ring semantics. The DSL is
 * **flat** (`primitives: Primitive[]` with optional `parent` indexes) so it
 * round-trips trivially through JSON for the LLM, localStorage, and the bench.
 *
 * This module is the firewall: internal AST shape is decoupled from external
 * LLM JSON shape. Round-trip property: `dslToAst(astToDsl(x))` is structurally
 * equal to `x` modulo non-semantic fields.
 *
 * Cycle guard: the input tree is depth-limited; a `seen` set rejects any node
 * reachable from itself.
 */

import { Ring, Line, Arc, Dot, Symmetry } from "./dsl.js";

const MAX_DEPTH = 8;

/**
 * Flatten a GlyphAST-style tree into the flat DSL primitive list.
 *
 * Accepted input shapes (kept lenient because the codebase has not yet
 * migrated to the canonical tree form — that happens in M4):
 *
 *   { rings: Ring[] }                                 -> array of ring trees
 *   { ring: Ring }                                    -> single ring tree (legacy)
 *   { rings: Ring[], lines, arcs, dots, symmetries }  -> mixed primitives
 *
 * Each Ring may carry:
 *   { radius | r, centerX | cx, centerY | cy, completeness, children: Ring[] }
 *
 * Lines / Arcs / Dots / Symmetries may be parented to a ring via `parentId`
 * (matching `Ring.id` on the AST side) or via `parent` (already a numeric
 * index into the DSL output).
 *
 * @param {object} glyphAst
 * @returns {{ primitives: Array<object> }}
 */
export function astToDsl(glyphAst) {
  if (!glyphAst || typeof glyphAst !== "object") {
    return { primitives: [] };
  }

  const primitives = [];
  const ringIdToIndex = new Map();
  const seen = new WeakSet();

  function visitRing(node, parentIndex, depth) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) {
      throw new Error("astToDsl: cycle detected in ring tree");
    }
    if (depth > MAX_DEPTH) {
      throw new Error(`astToDsl: tree depth exceeded ${MAX_DEPTH}`);
    }
    seen.add(node);

    const cx = node.cx ?? node.centerX;
    const cy = node.cy ?? node.centerY;
    const r = node.r ?? node.radius;
    const completeness = node.completeness;

    const ring = Ring({
      cx,
      cy,
      r,
      completeness,
      parent: parentIndex === null ? undefined : parentIndex
    });

    const myIndex = primitives.length;
    primitives.push(ring);
    if (node.id !== undefined && node.id !== null) {
      ringIdToIndex.set(node.id, myIndex);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      visitRing(child, myIndex, depth + 1);
    }
  }

  const ringRoots = Array.isArray(glyphAst.rings)
    ? glyphAst.rings
    : glyphAst.ring
      ? [glyphAst.ring]
      : [];

  for (const root of ringRoots) {
    visitRing(root, null, 0);
  }

  function resolveParent(parentRef) {
    if (parentRef === undefined || parentRef === null) return undefined;
    if (typeof parentRef === "number") return parentRef;
    if (ringIdToIndex.has(parentRef)) return ringIdToIndex.get(parentRef);
    return undefined;
  }

  // Non-ring primitives: accept arrays at the top level OR per-ring nested arrays.
  function emitAttached({ lines, arcs, dots, symmetries }, parentRef) {
    if (Array.isArray(lines)) {
      for (const ln of lines) {
        primitives.push(
          Line({
            a1: ln.a1 ?? ln.start ?? 0,
            a2: ln.a2 ?? ln.end ?? 0,
            length: ln.length ?? 0,
            parent: ln.parent ?? resolveParent(parentRef ?? ln.parentId)
          })
        );
      }
    }
    if (Array.isArray(arcs)) {
      for (const a of arcs) {
        primitives.push(
          Arc({
            cx: a.cx ?? a.centerX,
            cy: a.cy ?? a.centerY,
            r: a.r ?? a.radius,
            startAngle: a.startAngle ?? 0,
            endAngle: a.endAngle ?? 0,
            parent: a.parent ?? resolveParent(parentRef ?? a.parentId)
          })
        );
      }
    }
    if (Array.isArray(dots)) {
      for (const d of dots) {
        primitives.push(
          Dot({
            cx: d.cx ?? d.centerX,
            cy: d.cy ?? d.centerY,
            r: d.r ?? d.radius,
            parent: d.parent ?? resolveParent(parentRef ?? d.parentId)
          })
        );
      }
    }
    if (Array.isArray(symmetries)) {
      for (const s of symmetries) {
        primitives.push(
          Symmetry({
            n: s.n ?? 2,
            centerX: s.centerX ?? s.cx ?? 0,
            centerY: s.centerY ?? s.cy ?? 0,
            parent: s.parent ?? resolveParent(parentRef ?? s.parentId)
          })
        );
      }
    }
  }

  emitAttached(glyphAst, null);

  // Walk again to pick up per-ring attached primitives.
  function walkAttached(node, depth) {
    if (!node || typeof node !== "object") return;
    if (depth > MAX_DEPTH) return;
    emitAttached(node, node.id);
    const children = Array.isArray(node.children) ? node.children : [];
    for (const c of children) walkAttached(c, depth + 1);
  }
  for (const root of ringRoots) walkAttached(root, 0);

  return { primitives };
}

/**
 * Rebuild a GlyphAST tree from a flat DSL primitives array.
 *
 * Ring containment derives from the `parent` field on each ring primitive,
 * which is an integer index into the same `primitives` array. Non-ring
 * primitives attach to whichever ring is named in their `parent` field; if
 * none, they live at the top level (alongside the ring roots).
 *
 * @param {{ primitives: Array<object> } | Array<object>} dsl
 * @returns {object} GlyphAST tree
 */
export function dslToAst(dsl) {
  const primitives = Array.isArray(dsl) ? dsl : (dsl?.primitives ?? []);
  if (!Array.isArray(primitives)) {
    return { rings: [], lines: [], arcs: [], dots: [], symmetries: [] };
  }

  // First pass: instantiate ring nodes by index.
  const ringNodes = new Array(primitives.length);
  for (let i = 0; i < primitives.length; i += 1) {
    const p = primitives[i];
    if (p?.type === "Ring") {
      const ringNode = {
        id: `r${i}`,
        cx: p.cx,
        cy: p.cy,
        r: p.r,
        centerX: p.cx,
        centerY: p.cy,
        radius: p.r,
        children: [],
        lines: [],
        arcs: [],
        dots: [],
        symmetries: []
      };
      if (p.completeness !== undefined) ringNode.completeness = p.completeness;
      ringNodes[i] = ringNode;
    }
  }

  // Second pass: attach rings to parents, with cycle guard.
  const roots = [];
  const seenIndexes = new Set();
  for (let i = 0; i < primitives.length; i += 1) {
    const p = primitives[i];
    if (p?.type !== "Ring") continue;
    if (seenIndexes.has(i)) {
      throw new Error("dslToAst: cycle detected (ring referenced twice)");
    }
    seenIndexes.add(i);
    const parentIndex = Number.isInteger(p.parent) ? p.parent : null;
    if (parentIndex !== null && ringNodes[parentIndex]) {
      // Cycle: parent must precede child for a tree; reject reverse refs.
      if (parentIndex >= i) {
        throw new Error("dslToAst: cycle detected (ring parent index >= self index)");
      }
      ringNodes[parentIndex].children.push(ringNodes[i]);
    } else {
      roots.push(ringNodes[i]);
    }
  }

  const topLevel = { lines: [], arcs: [], dots: [], symmetries: [] };

  for (let i = 0; i < primitives.length; i += 1) {
    const p = primitives[i];
    if (!p || p.type === "Ring") continue;
    const parentIndex = Number.isInteger(p.parent) ? p.parent : null;
    const target = parentIndex !== null && ringNodes[parentIndex] ? ringNodes[parentIndex] : topLevel;

    if (p.type === "Line") {
      target.lines.push({ a1: p.a1, a2: p.a2, length: p.length, parentId: parentIndex !== null ? `r${parentIndex}` : null });
    } else if (p.type === "Arc") {
      target.arcs.push({
        cx: p.cx,
        cy: p.cy,
        r: p.r,
        startAngle: p.startAngle,
        endAngle: p.endAngle,
        parentId: parentIndex !== null ? `r${parentIndex}` : null
      });
    } else if (p.type === "Dot") {
      target.dots.push({ cx: p.cx, cy: p.cy, r: p.r, parentId: parentIndex !== null ? `r${parentIndex}` : null });
    } else if (p.type === "Symmetry") {
      target.symmetries.push({
        n: p.n,
        centerX: p.centerX,
        centerY: p.centerY,
        parentId: parentIndex !== null ? `r${parentIndex}` : null
      });
    }
  }

  return {
    rings: roots,
    lines: topLevel.lines,
    arcs: topLevel.arcs,
    dots: topLevel.dots,
    symmetries: topLevel.symmetries
  };
}

/**
 * Round-trip helper. The output equals the input AST under structural
 * comparison modulo non-semantic fields (ids re-minted, ordering preserved).
 */
export function roundTrip(glyphAst) {
  const dsl = astToDsl(glyphAst);
  return dslToAst(dsl);
}

/**
 * Structural equality helper for tests: compares ring trees by geometry +
 * children topology, ignoring id and other non-semantic fields.
 */
export function ringTreesEqual(a, b, epsilon = 1e-6) {
  function norm(node) {
    if (!node) return null;
    return {
      cx: node.cx ?? node.centerX,
      cy: node.cy ?? node.centerY,
      r: node.r ?? node.radius,
      completeness: node.completeness,
      children: (node.children ?? []).map(norm)
    };
  }
  function close(x, y) {
    if (x === undefined && y === undefined) return true;
    if (x === undefined || y === undefined) return false;
    return Math.abs(x - y) <= epsilon;
  }
  function eq(x, y) {
    if (x === y) return true;
    if (!x || !y) return false;
    if (!close(x.cx, y.cx) || !close(x.cy, y.cy) || !close(x.r, y.r)) return false;
    if (!close(x.completeness, y.completeness)) return false;
    if ((x.children ?? []).length !== (y.children ?? []).length) return false;
    for (let i = 0; i < x.children.length; i += 1) {
      if (!eq(x.children[i], y.children[i])) return false;
    }
    return true;
  }
  const aRoots = Array.isArray(a?.rings) ? a.rings : a?.ring ? [a.ring] : [];
  const bRoots = Array.isArray(b?.rings) ? b.rings : b?.ring ? [b.ring] : [];
  if (aRoots.length !== bRoots.length) return false;
  for (let i = 0; i < aRoots.length; i += 1) {
    if (!eq(norm(aRoots[i]), norm(bRoots[i]))) return false;
  }
  return true;
}
