/**
 * M5 — Unit tests for src/ui/qualityPanel.js.
 *
 * The panel is framework-free DOM only; we stub `document.createElement`
 * with a minimal element shim sufficient to verify (a) the four meter rows
 * are mounted, (b) tooltips include the documented copy, and (c) update()
 * reflows percentages.
 */

import assert from "node:assert/strict";
import test from "node:test";

function makeElement(tag) {
  const node = {
    tagName: tag.toUpperCase(),
    children: [],
    attrs: {},
    style: {},
    dataset: {},
    className: "",
    textContent: "",
    parentNode: null,
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = node.children.indexOf(child);
      if (i !== -1) {
        node.children.splice(i, 1);
        child.parentNode = null;
      }
      return child;
    },
    setAttribute(key, val) {
      node.attrs[key] = String(val);
    },
    getAttribute(key) {
      return node.attrs[key] ?? null;
    },
    querySelector(_selector) {
      // The panel never uses querySelector internally; return null.
      return null;
    }
  };
  return node;
}

function installDocumentStub() {
  globalThis.document = {
    createElement(tag) {
      return makeElement(tag);
    }
  };
}

function installWindowStub() {
  const handlers = new Map();
  globalThis.window = {
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      handlers.get(type)?.delete(fn);
    },
    dispatchEvent(evt) {
      const set = handlers.get(evt.type);
      if (set) for (const fn of set) fn(evt);
      return true;
    }
  };
  return handlers;
}

// One-time stubs.
installDocumentStub();
const winHandlers = installWindowStub();

const { createQualityPanel } = await import("../src/ui/qualityPanel.js");

function flatten(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) flatten(child, out);
  return out;
}

function findByDataset(panel, key, value) {
  return flatten(panel.element).find((n) => n.dataset?.[key] === value);
}

test("renders four meter rows with documented labels", () => {
  const mount = makeElement("div");
  const panel = createQualityPanel({ mountEl: mount });

  // Heading + 4 rows.
  const rows = flatten(panel.element).filter((n) => n.dataset?.meterRow);
  assert.equal(rows.length, 4, "must render four meter rows");
  for (const key of ["cleanliness", "length", "closurePrecision", "symmetry"]) {
    assert.ok(rows.some((r) => r.dataset.meterRow === key), `missing row for ${key}`);
  }
  panel.destroy();
});

test("each row carries a tooltip explaining what it measures", () => {
  const mount = makeElement("div");
  const panel = createQualityPanel({ mountEl: mount });

  const cleanRow = findByDataset(panel, "meterRow", "cleanliness");
  assert.ok(cleanRow.attrs.title.includes("Cleanliness"), "cleanliness tooltip names the axis");
  assert.ok(
    cleanRow.attrs.title.includes("composite"),
    "cleanliness tooltip mentions the composite formula"
  );

  const lengthRow = findByDataset(panel, "meterRow", "length");
  assert.ok(lengthRow.attrs.title.includes("2.5"), "length tooltip cites the cap");

  const closureRow = findByDataset(panel, "meterRow", "closurePrecision");
  assert.ok(closureRow.attrs.title.includes("ring"), "closure tooltip mentions the ring");

  const symmetryRow = findByDataset(panel, "meterRow", "symmetry");
  assert.ok(symmetryRow.attrs.title.toLowerCase().includes("symmetry"));

  panel.destroy();
});

test("update() reflows percentage values on each meter", () => {
  const mount = makeElement("div");
  const panel = createQualityPanel({ mountEl: mount });

  panel.update({
    cleanliness: 0.7,
    length: 1.25, // half of LENGTH_CAP → 50%
    closurePrecision: 1.0,
    symmetry: 0.45
  });

  const cleanValue = findByDataset(panel, "meter", "cleanlinessValue");
  assert.equal(cleanValue.textContent, "70%");
  const lengthValue = findByDataset(panel, "meter", "lengthValue");
  assert.equal(lengthValue.textContent, "50%");
  const closureValue = findByDataset(panel, "meter", "closurePrecisionValue");
  assert.equal(closureValue.textContent, "100%");
  const symmetryValue = findByDataset(panel, "meter", "symmetryValue");
  assert.equal(symmetryValue.textContent, "45%");

  // Bars track the same percentages.
  const cleanBar = findByDataset(panel, "meter", "cleanliness");
  assert.equal(cleanBar.style.width, "70%");

  panel.destroy();
});

test("reset() zeroes every meter back to 0%", () => {
  const mount = makeElement("div");
  const panel = createQualityPanel({ mountEl: mount });
  panel.update({ cleanliness: 0.9, length: 2, closurePrecision: 0.9, symmetry: 0.9 });
  panel.reset();
  for (const key of ["cleanliness", "length", "closurePrecision", "symmetry"]) {
    const valueNode = findByDataset(panel, "meter", `${key}Value`);
    assert.equal(valueNode.textContent, "0%");
  }
  panel.destroy();
});

test("subscribes to window 'spell:compiled' and reflects spellIR.qualityMetrics", () => {
  const mount = makeElement("div");
  const panel = createQualityPanel({ mountEl: mount });

  globalThis.window.dispatchEvent({
    type: "spell:compiled",
    detail: {
      spellIR: {
        qualityMetrics: {
          cleanliness: 0.8,
          length: 0.5,
          closurePrecision: 0.95,
          symmetry: 0.6
        }
      }
    }
  });

  const cleanValue = findByDataset(panel, "meter", "cleanlinessValue");
  assert.equal(cleanValue.textContent, "80%");
  panel.destroy();
});

test("destroy() unsubscribes the spell:compiled listener", () => {
  const before = winHandlers.get("spell:compiled")?.size ?? 0;
  const mount = makeElement("div");
  const panel = createQualityPanel({ mountEl: mount });
  const middle = winHandlers.get("spell:compiled")?.size ?? 0;
  assert.equal(middle, before + 1, "creation adds one listener");
  panel.destroy();
  const after = winHandlers.get("spell:compiled")?.size ?? 0;
  assert.equal(after, before, "destroy removes its listener");
});
