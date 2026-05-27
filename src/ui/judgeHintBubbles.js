/**
 * Judge cursor-tip hint bubbles (M3 surface 3 of 3).
 *
 * Default OFF (Architect T7 — opt-in via settings). Floats a positioned div
 * near the pointer with the judge's `hint` text. Auto-fades after 2 seconds;
 * a new arriving hint replaces the existing bubble and resets the fade timer.
 */

const FADE_AFTER_MS = 2000;
const FADE_DURATION_MS = 280;
const BUBBLE_ID = "judgeHintBubble";

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas       used to track pointer position
 * @param {object} [opts.settings]
 * @returns {{
 *   onHint: (text: string, position?: { x: number, y: number }) => void,
 *   setEnabled: (bool: boolean) => void,
 *   destroy: () => void,
 * }}
 */
export function createJudgeHintBubbles({ canvas, settings = {} } = {}) {
  const state = {
    enabled: settings?.surfaces?.hintBubbles === true, // default OFF per Architect T7
    pointer: { x: 0, y: 0 },
    fadeTimer: null,
    removeTimer: null,
    bubbleEl: null
  };

  function ensureBubble() {
    if (state.bubbleEl) return state.bubbleEl;
    if (typeof document === "undefined") return null;
    let el = document.getElementById(BUBBLE_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BUBBLE_ID;
      el.className = "judge-hint-bubble";
      el.setAttribute("role", "tooltip");
      el.hidden = true;
      document.body.appendChild(el);
    }
    state.bubbleEl = el;
    return el;
  }

  function onPointerMove(ev) {
    state.pointer.x = ev.clientX;
    state.pointer.y = ev.clientY;
    if (state.bubbleEl && !state.bubbleEl.hidden) {
      positionBubble();
    }
  }

  function positionBubble() {
    if (!state.bubbleEl) return;
    const offsetX = 14;
    const offsetY = -28;
    state.bubbleEl.style.left = `${state.pointer.x + offsetX}px`;
    state.bubbleEl.style.top = `${state.pointer.y + offsetY}px`;
  }

  function clearTimers() {
    if (state.fadeTimer) {
      clearTimeout(state.fadeTimer);
      state.fadeTimer = null;
    }
    if (state.removeTimer) {
      clearTimeout(state.removeTimer);
      state.removeTimer = null;
    }
  }

  function onHint(text, position) {
    if (!state.enabled) return;
    if (typeof text !== "string" || !text.trim()) return;
    const el = ensureBubble();
    if (!el) return;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      state.pointer.x = position.x;
      state.pointer.y = position.y;
    }
    clearTimers();
    el.textContent = text.trim();
    el.hidden = false;
    el.style.opacity = "0";
    positionBubble();
    // Force reflow so the transition runs.
    void el.offsetHeight;
    el.style.opacity = "1";

    state.fadeTimer = setTimeout(() => {
      if (!state.bubbleEl) return;
      state.bubbleEl.style.opacity = "0";
      state.removeTimer = setTimeout(() => {
        if (state.bubbleEl) {
          state.bubbleEl.hidden = true;
          state.bubbleEl.textContent = "";
        }
      }, FADE_DURATION_MS);
    }, FADE_AFTER_MS);
  }

  function setEnabled(enabled) {
    state.enabled = !!enabled;
    if (!state.enabled) {
      clearTimers();
      if (state.bubbleEl) {
        state.bubbleEl.hidden = true;
        state.bubbleEl.textContent = "";
      }
    }
  }

  function destroy() {
    clearTimers();
    if (canvas && typeof canvas.removeEventListener === "function") {
      canvas.removeEventListener("pointermove", onPointerMove);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("pointermove", onPointerMove);
    }
    if (state.bubbleEl?.parentNode) {
      state.bubbleEl.parentNode.removeChild(state.bubbleEl);
    }
    state.bubbleEl = null;
  }

  // Wire up pointer tracking.
  if (canvas && typeof canvas.addEventListener === "function") {
    canvas.addEventListener("pointermove", onPointerMove);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("pointermove", onPointerMove);
  }

  return { onHint, setEnabled, destroy };
}
