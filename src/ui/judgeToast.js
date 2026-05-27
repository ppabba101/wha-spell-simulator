/**
 * Circuit-breaker UX toast.
 *
 * Two states:
 *  - trip:  "Judge unavailable - template matching still works. Add your own key in Settings to bypass."
 *  - close: "Judge restored." (auto-fades after 4s)
 *
 * Lightweight DOM-only; no framework, no external deps. Caller owns the
 * lifecycle: `showTrip()` puts the trip toast on screen; `showClose()` swaps
 * to the success toast then auto-dismisses.
 */

const TOAST_ID = "judgeToast";
const FADE_OUT_MS = 4000;

function ensureToastElement() {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(TOAST_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = TOAST_ID;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.style.position = "fixed";
  el.style.top = "16px";
  el.style.right = "16px";
  el.style.maxWidth = "320px";
  el.style.padding = "12px 14px";
  el.style.borderRadius = "8px";
  el.style.background = "#241b16";
  el.style.color = "#fdf6ec";
  el.style.fontSize = "13px";
  el.style.lineHeight = "1.4";
  el.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.2)";
  el.style.opacity = "0";
  el.style.transition = "opacity 250ms ease";
  el.style.zIndex = "9999";
  el.style.pointerEvents = "auto";
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

let _autoFadeTimer = null;

export function showTrip(message) {
  const el = ensureToastElement();
  if (!el) return;
  if (_autoFadeTimer) {
    clearTimeout(_autoFadeTimer);
    _autoFadeTimer = null;
  }
  el.dataset.state = "trip";
  el.textContent =
    message ??
    "Judge unavailable - template matching still works. Add your own key in Settings to bypass.";
  el.hidden = false;
  // Force reflow so the transition runs.
  void el.offsetHeight;
  el.style.opacity = "1";
}

export function showClose(message) {
  const el = ensureToastElement();
  if (!el) return;
  el.dataset.state = "close";
  el.textContent = message ?? "Judge restored.";
  el.hidden = false;
  void el.offsetHeight;
  el.style.opacity = "1";
  if (_autoFadeTimer) clearTimeout(_autoFadeTimer);
  _autoFadeTimer = setTimeout(() => {
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(() => {
      el.hidden = true;
      el.textContent = "";
      el.dataset.state = "";
    }, 300);
    _autoFadeTimer = null;
  }, FADE_OUT_MS);
}

export function hide() {
  const el = ensureToastElement();
  if (!el) return;
  if (_autoFadeTimer) {
    clearTimeout(_autoFadeTimer);
    _autoFadeTimer = null;
  }
  el.style.opacity = "0";
  setTimeout(() => {
    el.hidden = true;
    el.textContent = "";
    el.dataset.state = "";
  }, 300);
}

export const JUDGE_TOAST_ID = TOAST_ID;
