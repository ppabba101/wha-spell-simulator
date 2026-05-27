/**
 * Unit tests for src/ui/settingsPanel.js.
 *
 * The settings module is framework-free but reaches for `localStorage`,
 * `document`, and `CustomEvent`. We stub each one and inject our own storage
 * via the function signatures so persistence is testable without a DOM.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  forgetAllUserKeys,
  readSettings,
  readUserKey,
  SETTINGS_DEFAULTS,
  SETTINGS_DISCLOSURE_COPY,
  USER_KEY_NS,
  writeSettings,
  writeUserKey
} from "../src/ui/settingsPanel.js";

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    _inspect() {
      return Object.fromEntries(store);
    }
  };
}

function installDocumentStub() {
  if (typeof globalThis.document === "undefined") {
    const listeners = new Map();
    globalThis.document = {
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent(ev) {
        listeners.get(ev.type)?.forEach((fn) => fn(ev));
        return true;
      }
    };
  }
  if (typeof globalThis.CustomEvent === "undefined") {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
  }
  return globalThis.document;
}

test("SETTINGS_DEFAULTS exposes expected sections", () => {
  assert.ok(SETTINGS_DEFAULTS.judge);
  assert.equal(SETTINGS_DEFAULTS.judge.enabled, false);
  assert.equal(SETTINGS_DEFAULTS.judge.mode, "parallel");
  assert.ok(SETTINGS_DEFAULTS.surfaces);
  assert.equal(SETTINGS_DEFAULTS.surfaces.canvasOverlay, true);
  assert.equal(SETTINGS_DEFAULTS.surfaces.hintBubbles, false); // Architect T7
  assert.ok(SETTINGS_DEFAULTS.graphics);
  assert.equal(SETTINGS_DEFAULTS.graphics.particleQuality, "high");
});

test("SETTINGS_DISCLOSURE_COPY contains the required user-facing copy", () => {
  assert.match(SETTINGS_DISCLOSURE_COPY, /stored locally in your browser/i);
  assert.match(SETTINGS_DISCLOSURE_COPY, /Forget all keys/i);
});

test("readSettings returns defaults when storage is empty", () => {
  const storage = makeStorage();
  const s = readSettings(storage);
  assert.deepEqual(s.judge, SETTINGS_DEFAULTS.judge);
  assert.deepEqual(s.surfaces, SETTINGS_DEFAULTS.surfaces);
});

test("writeSettings persists per-section and survives round-trip", () => {
  installDocumentStub();
  const storage = makeStorage();
  writeSettings("judge", { enabled: true, mode: "groq-only" }, storage);
  const next = readSettings(storage);
  assert.equal(next.judge.enabled, true);
  assert.equal(next.judge.mode, "groq-only");
  // alwaysCritique stays at default
  assert.equal(next.judge.alwaysCritique, false);
});

test("writeSettings fires settings:change CustomEvent on document", () => {
  const doc = installDocumentStub();
  const storage = makeStorage();
  let captured = null;
  const handler = (ev) => {
    captured = ev.detail;
  };
  doc.addEventListener("settings:change", handler);
  writeSettings("surfaces", { hintBubbles: true }, storage);
  doc.removeEventListener("settings:change", handler);
  assert.ok(captured);
  assert.equal(captured.section, "surfaces");
  assert.deepEqual(captured.patch, { hintBubbles: true });
  assert.equal(captured.settings.surfaces.hintBubbles, true);
});

test("writeUserKey persists under wha.userKey namespace; readUserKey retrieves it", () => {
  installDocumentStub();
  const storage = makeStorage();
  writeUserKey("groq", "sk-test-123", storage);
  assert.equal(readUserKey("groq", storage), "sk-test-123");
  assert.equal(storage._inspect()[`${USER_KEY_NS}.groq`], "sk-test-123");
});

test("writeUserKey with empty value clears the slot", () => {
  installDocumentStub();
  const storage = makeStorage();
  writeUserKey("anthropic", "sk-anthropic", storage);
  assert.equal(readUserKey("anthropic", storage), "sk-anthropic");
  writeUserKey("anthropic", "", storage);
  assert.equal(readUserKey("anthropic", storage), "");
});

test("forgetAllUserKeys wipes every provider key", () => {
  installDocumentStub();
  const storage = makeStorage();
  writeUserKey("groq", "g", storage);
  writeUserKey("sambanova", "s", storage);
  writeUserKey("anthropic", "a", storage);
  forgetAllUserKeys(storage);
  assert.equal(readUserKey("groq", storage), "");
  assert.equal(readUserKey("sambanova", storage), "");
  assert.equal(readUserKey("anthropic", storage), "");
});

test("readSettings tolerates malformed JSON in storage", () => {
  const storage = makeStorage({ "wha.settings.judge": "{not-json" });
  const s = readSettings(storage);
  // Falls back to defaults rather than throwing.
  assert.deepEqual(s.judge, SETTINGS_DEFAULTS.judge);
});
