/**
 * Settings panel (M3).
 *
 * Lives next to Dictionary / Diagnostic as a third panel tab. Persists every
 * setting to localStorage under the `wha.settings.*` namespace. Provider keys
 * are namespaced separately under `wha.userKey.*` so a Forget All Keys click
 * can wipe them in one place without touching the rest of settings.
 *
 * On every change, fires a `settings:change` CustomEvent on the document so
 * other modules can hot-swap.
 */

export const SETTINGS_NS = "wha.settings";
export const USER_KEY_NS = "wha.userKey";

const DISCLOSURE_COPY =
  "Your provider key is stored locally in your browser. We never see it. " +
  "Only paste keys you own and can rotate. You can wipe it by clicking 'Forget all keys' above.";

const PROVIDERS = ["sambanova", "groq", "anthropic"];

const DEFAULTS = Object.freeze({
  judge: {
    enabled: false,
    mode: "parallel", // parallel | groq-only | sambanova-only | anthropic | smolvlm-offline
    alwaysCritique: false
  },
  surfaces: {
    canvasOverlay: true,
    sidePanel: true,
    hintBubbles: false // Architect T7 — default OFF
  },
  graphics: {
    bloom: true,
    paperTexture: true,
    perElementShaders: true,
    particleQuality: "high" // low | med | high
  }
});

function safeJSON(s) {
  if (typeof s !== "string" || !s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function getStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base && typeof base[k] === "object") {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Read every wha.settings.* key from localStorage and merge over DEFAULTS.
 */
export function readSettings(storage = getStorage()) {
  const merged = deepMerge({}, DEFAULTS);
  if (!storage) return merged;
  for (const section of Object.keys(DEFAULTS)) {
    const raw = storage.getItem(`${SETTINGS_NS}.${section}`);
    const parsed = safeJSON(raw);
    if (parsed && typeof parsed === "object") {
      merged[section] = deepMerge(DEFAULTS[section], parsed);
    }
  }
  return merged;
}

/**
 * Persist a single section of settings (deep merge over existing) and emit
 * the `settings:change` CustomEvent.
 */
export function writeSettings(section, patch, storage = getStorage()) {
  const current = readSettings(storage);
  const next = deepMerge(current, { [section]: patch });
  if (storage) {
    storage.setItem(`${SETTINGS_NS}.${section}`, JSON.stringify(next[section]));
  }
  emitChange(next, section, patch);
  return next;
}

export function readUserKey(provider, storage = getStorage()) {
  if (!storage) return "";
  return storage.getItem(`${USER_KEY_NS}.${provider}`) ?? "";
}

export function writeUserKey(provider, value, storage = getStorage()) {
  if (!storage) return;
  if (value) storage.setItem(`${USER_KEY_NS}.${provider}`, value);
  else storage.removeItem(`${USER_KEY_NS}.${provider}`);
  emitChange(readSettings(storage), "userKeys", { [provider]: !!value });
}

export function forgetAllUserKeys(storage = getStorage()) {
  if (!storage) return;
  for (const p of PROVIDERS) {
    storage.removeItem(`${USER_KEY_NS}.${p}`);
  }
  emitChange(readSettings(storage), "userKeys", { forgotAll: true });
}

function emitChange(next, section, patch) {
  if (typeof document === "undefined" || typeof CustomEvent !== "function") return;
  try {
    document.dispatchEvent(
      new CustomEvent("settings:change", { detail: { settings: next, section, patch } })
    );
  } catch {
    // ignore
  }
}

/**
 * Mount the settings UI inside `mountEl`. Returns a teardown handle.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.mountEl
 */
export function createSettingsPanel({ mountEl } = {}) {
  if (!mountEl) {
    return { destroy() {}, refresh() {}, getSettings: readSettings };
  }

  mountEl.innerHTML = `
    <section class="settings-panel" aria-label="Settings">
      <section class="settings-section">
        <h3>Judge</h3>
        <label class="toggle">
          <input type="checkbox" id="settingsJudgeEnabled">
          <span>Enable judge</span>
        </label>
        <div class="settings-radio-group" role="radiogroup" aria-label="Judge mode">
          ${[
            { id: "parallel", label: "Parallel" },
            { id: "groq-only", label: "Groq-only" },
            { id: "sambanova-only", label: "SambaNova-only" },
            { id: "anthropic", label: "Anthropic (your key)" },
            { id: "smolvlm-offline", label: "SmolVLM offline (coming soon)" }
          ]
            .map(
              (m) => `
            <label class="settings-radio-row">
              <input type="radio" name="settingsJudgeMode" value="${m.id}">
              <span>${m.label}</span>
            </label>
          `
            )
            .join("")}
        </div>
        <label class="toggle">
          <input type="checkbox" id="settingsAlwaysCritique">
          <span>Always critique (even confident template matches)</span>
        </label>
      </section>

      <section class="settings-section">
        <details class="settings-details">
          <summary>Provider keys</summary>
          ${PROVIDERS.map(
            (p) => `
            <label class="settings-key-row">
              <span>${p[0].toUpperCase()}${p.slice(1)}</span>
              <input type="password" id="settingsKey_${p}" autocomplete="off" spellcheck="false" data-provider="${p}">
            </label>
          `
          ).join("")}
          <button type="button" id="settingsForgetAllKeys" class="settings-danger">Forget all keys</button>
          <p class="settings-disclosure" id="settingsDisclosureCopy">${DISCLOSURE_COPY}</p>
        </details>
      </section>

      <section class="settings-section">
        <h3>Surfaces</h3>
        <label class="toggle">
          <input type="checkbox" id="settingsSurfaceOverlay">
          <span>Canvas overlay</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="settingsSurfacePanel">
          <span>Side panel</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="settingsSurfaceHints">
          <span>Hint bubbles</span>
        </label>
      </section>

      <section class="settings-section">
        <h3>Graphics</h3>
        <label class="toggle">
          <input type="checkbox" id="settingsGraphicsBloom">
          <span>Bloom</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="settingsGraphicsPaperTexture">
          <span>Paper texture</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="settingsGraphicsShaders">
          <span>Per-element shaders</span>
        </label>
        <div class="settings-radio-group" role="radiogroup" aria-label="Particle quality">
          ${[
            { id: "low", label: "Low" },
            { id: "med", label: "Med" },
            { id: "high", label: "High" }
          ]
            .map(
              (q) => `
            <label class="settings-radio-row">
              <input type="radio" name="settingsParticleQuality" value="${q.id}">
              <span>${q.label}</span>
            </label>
          `
            )
            .join("")}
        </div>
      </section>
    </section>
  `;

  const refs = {
    judgeEnabled: mountEl.querySelector("#settingsJudgeEnabled"),
    judgeMode: mountEl.querySelectorAll('input[name="settingsJudgeMode"]'),
    alwaysCritique: mountEl.querySelector("#settingsAlwaysCritique"),
    keyInputs: PROVIDERS.reduce((acc, p) => {
      acc[p] = mountEl.querySelector(`#settingsKey_${p}`);
      return acc;
    }, {}),
    forgetAllKeys: mountEl.querySelector("#settingsForgetAllKeys"),
    surfaceOverlay: mountEl.querySelector("#settingsSurfaceOverlay"),
    surfacePanel: mountEl.querySelector("#settingsSurfacePanel"),
    surfaceHints: mountEl.querySelector("#settingsSurfaceHints"),
    bloom: mountEl.querySelector("#settingsGraphicsBloom"),
    paperTexture: mountEl.querySelector("#settingsGraphicsPaperTexture"),
    shaders: mountEl.querySelector("#settingsGraphicsShaders"),
    particleQuality: mountEl.querySelectorAll('input[name="settingsParticleQuality"]')
  };

  function refresh() {
    const s = readSettings();
    if (refs.judgeEnabled) refs.judgeEnabled.checked = !!s.judge.enabled;
    if (refs.alwaysCritique) refs.alwaysCritique.checked = !!s.judge.alwaysCritique;
    refs.judgeMode.forEach((el) => {
      el.checked = el.value === s.judge.mode;
    });
    for (const p of PROVIDERS) {
      const input = refs.keyInputs[p];
      if (input) input.value = readUserKey(p);
    }
    if (refs.surfaceOverlay) refs.surfaceOverlay.checked = !!s.surfaces.canvasOverlay;
    if (refs.surfacePanel) refs.surfacePanel.checked = !!s.surfaces.sidePanel;
    if (refs.surfaceHints) refs.surfaceHints.checked = !!s.surfaces.hintBubbles;
    if (refs.bloom) refs.bloom.checked = !!s.graphics.bloom;
    if (refs.paperTexture) refs.paperTexture.checked = !!s.graphics.paperTexture;
    if (refs.shaders) refs.shaders.checked = !!s.graphics.perElementShaders;
    refs.particleQuality.forEach((el) => {
      el.checked = el.value === s.graphics.particleQuality;
    });
  }

  // ---- Event listeners ----

  const listeners = [];
  function bind(el, type, handler) {
    if (!el) return;
    el.addEventListener(type, handler);
    listeners.push({ el, type, handler });
  }

  bind(refs.judgeEnabled, "change", () => {
    writeSettings("judge", { enabled: refs.judgeEnabled.checked });
    // Legacy localStorage flag the streamingJudge orchestrator reads.
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("wha.llmJudge.enabled", refs.judgeEnabled.checked ? "true" : "false");
      }
    } catch {
      // ignore
    }
  });

  bind(refs.alwaysCritique, "change", () => {
    writeSettings("judge", { alwaysCritique: refs.alwaysCritique.checked });
  });

  refs.judgeMode.forEach((el) => {
    bind(el, "change", () => {
      if (el.checked) writeSettings("judge", { mode: el.value });
    });
  });

  for (const p of PROVIDERS) {
    const input = refs.keyInputs[p];
    if (!input) continue;
    bind(input, "change", () => {
      writeUserKey(p, input.value);
    });
  }

  bind(refs.forgetAllKeys, "click", () => {
    forgetAllUserKeys();
    for (const p of PROVIDERS) {
      const input = refs.keyInputs[p];
      if (input) input.value = "";
    }
  });

  bind(refs.surfaceOverlay, "change", () => {
    writeSettings("surfaces", { canvasOverlay: refs.surfaceOverlay.checked });
  });
  bind(refs.surfacePanel, "change", () => {
    writeSettings("surfaces", { sidePanel: refs.surfacePanel.checked });
  });
  bind(refs.surfaceHints, "change", () => {
    writeSettings("surfaces", { hintBubbles: refs.surfaceHints.checked });
  });

  bind(refs.bloom, "change", () => {
    writeSettings("graphics", { bloom: refs.bloom.checked });
  });
  bind(refs.paperTexture, "change", () => {
    writeSettings("graphics", { paperTexture: refs.paperTexture.checked });
  });
  bind(refs.shaders, "change", () => {
    writeSettings("graphics", { perElementShaders: refs.shaders.checked });
  });
  refs.particleQuality.forEach((el) => {
    bind(el, "change", () => {
      if (el.checked) writeSettings("graphics", { particleQuality: el.value });
    });
  });

  refresh();

  return {
    destroy() {
      for (const { el, type, handler } of listeners) {
        el.removeEventListener(type, handler);
      }
      listeners.length = 0;
      mountEl.innerHTML = "";
    },
    refresh,
    getSettings: () => readSettings()
  };
}

export const SETTINGS_DEFAULTS = DEFAULTS;
export const SETTINGS_DISCLOSURE_COPY = DISCLOSURE_COPY;
