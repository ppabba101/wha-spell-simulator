/**
 * Prepared spells panel (M4).
 *
 * A "prepared" spell is a glyph whose outer ring is *not yet closed*. The
 * user can capture it with the Save Prepared button, persist the GlyphAST
 * (plus the gap position where the closing dot belongs) into localStorage,
 * and later Fire it — which synthesises the closing dot and re-runs the
 * compile path so the spell activates.
 *
 * This module is intentionally framework-free so it can be unit-tested with
 * a stub storage adapter. The DOM helpers at the bottom are pure wiring.
 */

export const STORAGE_KEY = "wha.preparedSpells";

const DEFAULT_STORAGE = (() => {
  if (typeof globalThis === "undefined") return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
})();

function makeId() {
  // Short, sortable, unique enough for client-side state.
  const random = Math.random().toString(36).slice(2, 8);
  return `ps_${Date.now().toString(36)}_${random}`;
}

function safeParse(json) {
  if (typeof json !== "string" || !json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Read the saved prepared-spell list from storage. Returns [] if no storage
 * adapter is available, the slot is empty, or the JSON cannot be parsed.
 */
export function loadPreparedSpells(storage = DEFAULT_STORAGE) {
  if (!storage || typeof storage.getItem !== "function") return [];
  return safeParse(storage.getItem(STORAGE_KEY));
}

/**
 * Persist the full list. The caller passes the canonical array shape so
 * deletes and edits can be done in-place.
 */
export function savePreparedSpells(spells, storage = DEFAULT_STORAGE) {
  if (!storage || typeof storage.setItem !== "function") return false;
  storage.setItem(STORAGE_KEY, JSON.stringify(spells));
  return true;
}

/**
 * Construct the gap-position record for the current open ring.
 * Returns null when the ring is missing or closed (no gap to record).
 */
export function ringGapPosition(ring) {
  if (!ring?.found || ring.complete) return null;
  const gap = ring.gap;
  if (!gap) return null;
  // Use the midpoint of the gap arc as the dot the user would draw to close.
  const midDeg = (gap.startAngle + gap.endAngle) / 2;
  const midRad = (midDeg * Math.PI) / 180;
  return {
    x: ring.center.x + Math.cos(midRad) * ring.radius,
    y: ring.center.y + Math.sin(midRad) * ring.radius,
    arcMidpointDeg: midDeg
  };
}

/**
 * Build a saveable record from the current pipeline.
 *
 * @param {object} pipeline  output of classifyDrawing()
 * @param {object[]} strokes raw strokes (so the Fire button can restore them)
 * @param {string} name      user-supplied name; falls back to a default
 */
export function buildPreparedEntry({ pipeline, strokes, name }) {
  const ring = pipeline?.ring ?? pipeline?.glyphAST?.ring ?? null;
  if (!ring?.found || ring.complete) {
    throw new Error("buildPreparedEntry: a prepared spell requires an open ring");
  }
  return {
    id: makeId(),
    name: name && name.trim() ? name.trim() : `Prepared ${new Date().toLocaleString()}`,
    glyphAst: pipeline?.glyphAST ?? null,
    strokes,
    ringGapPosition: ringGapPosition(ring),
    createdAt: Date.now()
  };
}

/**
 * Append a prepared entry, persist, return the updated list.
 */
export function appendPreparedSpell(entry, storage = DEFAULT_STORAGE) {
  const list = loadPreparedSpells(storage);
  list.push(entry);
  savePreparedSpells(list, storage);
  return list;
}

export function removePreparedSpell(id, storage = DEFAULT_STORAGE) {
  const list = loadPreparedSpells(storage).filter((entry) => entry.id !== id);
  savePreparedSpells(list, storage);
  return list;
}

/**
 * Synthesise the closing-dot stroke at the ringGapPosition. Returned as a
 * normal stroke object — a single point segment, since the parser tolerates
 * short marks at the gap (the topological flood-fill considers them as the
 * closing seam).
 */
export function synthesiseClosingDot(entry) {
  const pos = entry?.ringGapPosition;
  if (!pos) return null;
  const id = `closing-${entry.id}`;
  // A 1-pixel dot drawn three times so the cleaner doesn't discard it; the
  // ring detector's flood-fill is happy with a tiny seam.
  const points = [];
  for (let i = 0; i < 3; i += 1) {
    points.push({ x: pos.x + i * 0.5, y: pos.y + i * 0.5 });
  }
  return { id, points };
}

/**
 * Combine the saved strokes with the closing dot to produce the strokes that
 * should re-enter the parser on Fire.
 */
export function strokesForFiring(entry) {
  const dot = synthesiseClosingDot(entry);
  const base = Array.isArray(entry?.strokes) ? entry.strokes : [];
  return dot ? [...base, dot] : base;
}

/**
 * Render the prepared-spell list into a DOM container. Pure wiring — kept
 * in this module so callers can drop it next to a Save button.
 *
 * @param {HTMLElement} container
 * @param {{ onFire(entry), onRemove(entry), storage? }} options
 */
export function renderPreparedSpellsList(container, options) {
  if (!container) return;
  const storage = options?.storage ?? DEFAULT_STORAGE;
  const list = loadPreparedSpells(storage);
  container.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "prepared-spells-empty";
    empty.textContent = "No prepared spells yet. Draw an open ring and click Save Prepared.";
    container.appendChild(empty);
    return;
  }
  for (const entry of list) {
    const card = document.createElement("article");
    card.className = "prepared-spell-card";
    card.dataset.preparedId = entry.id;

    const title = document.createElement("h3");
    title.textContent = entry.name;
    card.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "prepared-spell-meta";
    const created = new Date(entry.createdAt);
    meta.textContent = `Saved ${created.toLocaleString()}`;
    card.appendChild(meta);

    const fire = document.createElement("button");
    fire.type = "button";
    fire.textContent = "Fire";
    fire.addEventListener("click", () => options?.onFire?.(entry));
    card.appendChild(fire);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Forget";
    remove.addEventListener("click", () => options?.onRemove?.(entry));
    card.appendChild(remove);

    container.appendChild(card);
  }
}
