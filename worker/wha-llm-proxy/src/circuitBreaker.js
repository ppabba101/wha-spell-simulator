/**
 * Per-provider circuit breaker (Pre-mortem D mitigation).
 *
 * - 3 consecutive failures (5xx / network error) trip the breaker.
 * - While tripped, requests fast-fail with `{ kind: 'error', reason: 'breaker-open' }`.
 * - Auto-probe every 60 seconds: a single 1-token completion ping; on success,
 *   the breaker closes.
 *
 * The module is JS (not TS) so it can be imported directly by both the Worker
 * and miniflare tests without needing a separate compile step.
 */

const REGISTRY = new Map();

export class CircuitBreaker {
  constructor(provider, opts = {}) {
    this.provider = provider;
    this.threshold = opts.threshold ?? 3;
    this.probeIntervalMs = opts.probeIntervalMs ?? 60_000;
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this._state = "closed"; // "closed" | "open" | "half-open"
    this._now = opts.now ?? (() => Date.now());
  }

  static forProvider(provider, opts = {}) {
    if (!REGISTRY.has(provider)) {
      REGISTRY.set(provider, new CircuitBreaker(provider, opts));
    }
    const breaker = REGISTRY.get(provider);
    // Allow tests to override the clock; production usage uses Date.now() default.
    if (opts.now) breaker._now = opts.now;
    return breaker;
  }

  static reset() {
    REGISTRY.clear();
  }

  static snapshot() {
    const out = {};
    for (const [k, v] of REGISTRY.entries()) {
      out[k] = { state: v._state, failures: v.consecutiveFailures, openedAt: v.openedAt };
    }
    return out;
  }

  isOpen() {
    if (this._state !== "open") return false;
    // Auto-probe transition: if interval has elapsed, flip to half-open so the
    // next request acts as the probe.
    if (this._now() - this.openedAt >= this.probeIntervalMs) {
      this._state = "half-open";
      return false;
    }
    return true;
  }

  recordFailure() {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      this._state = "open";
      this.openedAt = this._now();
    }
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this._state = "closed";
    this.openedAt = 0;
  }

  state() {
    return this._state;
  }
}

/**
 * Execute `fn` under a breaker. Returns the result on success; on thrown
 * error records the failure and rethrows so the caller decides the response.
 */
export async function withBreaker(breaker, fn) {
  try {
    const out = await fn();
    return out;
  } catch (err) {
    breaker.recordFailure();
    throw err;
  }
}

export function getBreakerState() {
  return CircuitBreaker.snapshot();
}
