/**
 * Progressive JSON parser for the streaming judge.
 *
 * Streaming chunks accumulate into a buffer. On each chunk we attempt to close
 * the buffer with one of a handful of bracket completions and try `JSON.parse`.
 * On success we emit a `partial` event with the largest valid prefix; on the
 * final `end()` call we emit `final` with the fully-validated object.
 *
 * The implementation is deliberately small (~150 LOC) and tolerant of model
 * pre-/post-amble (markdown fences, ```json banners, prose). Anything that
 * isn't part of the JSON region is stripped before parse attempts.
 */

import { validatePartial, validateDsl } from "./dslValidator.js";

/**
 * Strip non-JSON pre/post amble. The model may answer:
 *     ```json
 *     { ... }
 *     ```
 * or include a banner like "Here is the result:" before/after. We slice to the
 * outermost balanced `{...}` region we can locate.
 *
 * Returns the candidate text from the first `{` up to and including the matching
 * closing `}` if one exists; otherwise returns everything from `{` to the end of
 * the buffer (the balancer fills in missing closers).
 */
function findJsonRegion(buffer) {
  const start = buffer.indexOf("{");
  if (start < 0) return null;

  // Walk the buffer and locate the matching outer `}` using string-aware
  // bracket counting. If we find it, return up to and including that `}` so
  // trailing markdown fences don't bleed into the JSON parse.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return buffer.slice(start, i + 1);
      }
    }
  }

  return buffer.slice(start);
}

/**
 * Attempt to balance an unterminated JSON region by counting open brackets and
 * appending the necessary closers + string-quote termination. Returns the
 * candidate JSON text, or null if the structure is unrecoverable.
 *
 * State machine handles: strings (with escapes), arrays, objects.
 */
function balanceBrackets(region) {
  let inString = false;
  let escape = false;
  const stack = [];

  for (let i = 0; i < region.length; i += 1) {
    const ch = region[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}") {
      if (stack[stack.length - 1] === "{") stack.pop();
      else return null;
    } else if (ch === "]") {
      if (stack[stack.length - 1] === "[") stack.pop();
      else return null;
    }
  }

  let completion = "";
  if (inString) completion += "\"";

  // Trim a trailing comma so `[1, 2,` + `]` doesn't blow up.
  let candidate = region;
  while (candidate.length > 0) {
    const last = candidate[candidate.length - 1];
    if (last === "," || last === ":" || last === " " || last === "\n" || last === "\t") {
      candidate = candidate.slice(0, -1);
      continue;
    }
    break;
  }

  // After string termination, if we just closed a key with no value, drop it.
  // Conservative path: if the last non-ws non-quote char is ':' or ',' we already trimmed it above.

  while (stack.length) {
    const open = stack.pop();
    completion += open === "{" ? "}" : "]";
  }

  return candidate + completion;
}

/**
 * Public factory.
 * @param {{ schema?: object }} opts - schema accepted for symmetry but unused
 *   at parser level; validation happens via the imported validator.
 */
export function createProgressiveJsonParser(_opts = {}) {
  let buffer = "";
  let lastPartialString = null;
  let final = null;

  const partialListeners = [];
  const finalListeners = [];
  const errorListeners = [];

  function emitPartial(value) {
    const snapshot = JSON.stringify(value);
    if (snapshot === lastPartialString) return;
    lastPartialString = snapshot;
    for (const fn of partialListeners) {
      try {
        fn(value);
      } catch (err) {
        for (const ef of errorListeners) ef(err);
      }
    }
  }

  function emitFinal(value) {
    final = value;
    for (const fn of finalListeners) {
      try {
        fn(value);
      } catch (err) {
        for (const ef of errorListeners) ef(err);
      }
    }
  }

  function tryParsePartial() {
    const region = findJsonRegion(buffer);
    if (!region) return;
    const candidate = balanceBrackets(region);
    if (!candidate) return;
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return;
    }
    const result = validatePartial(parsed);
    if (result.ok) {
      emitPartial(result.value);
    }
  }

  return {
    onPartial(fn) {
      partialListeners.push(fn);
    },
    onFinal(fn) {
      finalListeners.push(fn);
    },
    onError(fn) {
      errorListeners.push(fn);
    },
    feed(chunk) {
      if (typeof chunk !== "string") return;
      buffer += chunk;
      tryParsePartial();
    },
    end() {
      tryParsePartial();
      const region = findJsonRegion(buffer);
      if (!region) return null;
      // Final parse: do NOT auto-balance. The model must have closed the JSON.
      // If it didn't, try once with balancing as a last resort but validate strictly.
      let parsed = null;
      try {
        parsed = JSON.parse(region);
      } catch {
        const balanced = balanceBrackets(region);
        if (balanced) {
          try {
            parsed = JSON.parse(balanced);
          } catch {
            parsed = null;
          }
        }
      }
      if (parsed) {
        const strict = validateDsl(parsed);
        if (strict.ok) {
          emitFinal(strict.value);
          return strict.value;
        }
        for (const fn of errorListeners) fn(new Error(`Strict DSL validation failed: ${JSON.stringify(strict.errors)}`));
      }
      return null;
    },
    /** Inspect state, mainly for tests. */
    _state() {
      return { buffer, final };
    }
  };
}
