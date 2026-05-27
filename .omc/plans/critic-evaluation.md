# Critic Evaluation — RALPLAN-WHA-v0.2 (Iteration 1)

**Reviewer:** Critic agent
**Mode:** DELIBERATE consensus
**Verdict:** ITERATE
**Required changes:** 8 (Planner must address all)

---

## Required changes

### 1. Adopt all six Architect revisions explicitly in plan text

- **T1:** Parallel-double-request as M2 design — Groq for cursor-bubble first-hint (TTFT-dominated); SambaNova for side-panel deep critique (throughput-dominated); both fired from Worker; 60ms Groq head-start guard; identical DSL contract; multiplexed client-side.
- **T3:** Worker normalises SSE event shape (~200 LOC, not 30); absorbs OpenAI-style + Anthropic event-typed SSE; emits uniform `{ kind: 'token-delta' | 'done' | 'error', text?, reason? }`.
- **T5:** Move `playwright.config.ts` skeleton + goldens directory + `npm run test:e2e` script into M1's "Files to create" (currently in M8).
- **Principle 1 fix:** Explicit AST↔DSL mapper in M1 (Critic prefers explicit mapper over collapsing AST shape) with bidirectional round-trip tests on every M4 fixture.
- **Pre-mortem D:** Worker circuit breaker + **auto-probe recovery** + escape-hatch toast in M2. Auto-probe every N minutes after breaker trip.
- **Release-train fallback in §8 ADR:** explicit branch — "If M4 slips >2 weeks, ship M1–M3 as v0.2-alpha (judge-only); resume M4+ as v0.2-beta."

### 2. Add M0 fixture corpus capture (or fold into M8 with resource plan)

Add **M0: Fixture corpus capture** as a pre-M1 milestone OR sequence corpus capture inside M8 with explicit drawer-count (≥3), time budget (person-week), hand-shake/messy variants, and test/train split (e.g., 70/30). **AC-P1 must be measurable on a held-out test split, not the corpus used for tuning.**

### 3. Relax AC-P2 measurement

Relax AC-P2 to **"<500ms p50 / <1000ms p95 to first user-visible WHADSLPartial event, measured by the in-app `?latency-bench` route over ≥100 round-trips, in two regions (US-East and EU-West)."** Keep <300ms as a stretch goal. Define "first user-visible WHADSLPartial event" unambiguously (the moment the first primitive renders on the judge overlay canvas).

### 4. Add observability slice to M1 (or new M8a)

Worker emits per-provider request count, latency p50/p95/p99, status code histogram, breaker-trip counter, judge-disagreement counter (template top-1 vs judge top-1), KV rate-limit hit counter, cost-per-spell estimate. Use Cloudflare Workers Analytics Engine. Define alert thresholds (e.g., breaker-trip > 5% of traffic triggers ops alert).

### 5. Split M7 into M7a + M7b

- **M7a:** perfect-freehand + glow-on-closure (satisfies AC-F4 without GLSL risk).
- **M7b:** PixiJS stage + sumi-e shader + tsParticles.

M7a ships independently.

### 6. Tighten AC-F3 and AC-F4 acceptance

- **AC-F3 (5 new signs):** per-sign Playwright golden + ≥X% pixel-diff (suggest ≥15%) between any two new-sign animations to prove visual distinctness.
- **AC-F4 (glow-on-closure):** colour-histogram or peak-luminance assertion at closure flash frame (e.g., "≥30% pixels in silver/white range #C0C0C0–#FFFFFF at frame 3 of glow animation"), not screenshot-only.

### 7. Add Pre-mortem E (fixture-corpus bias)

Single-team-member corpus achieves 92% on bench but real users hit 65% because corpus is too clean. Mitigation: ≥3 different drawers contributing; explicit hand-shake/messy variant labels; corpus reviewer not from the contributors.

### 8. Add XSS / `localStorage` user-key threat-model paragraph in §8 ADR Consequences

- (a) Committed CSP in `index.html` restricting `connect-src` to Worker + provider domains.
- (b) Disclosure copy in settings panel ("Your key is stored locally; we never see it; only paste keys you own and can rotate").
- (c) Optional `crypto.subtle`-wrapped storage as future hardening.
- Move Open Question item 5 into a required §8 sub-bullet.

---

## Minor (acknowledge, not required to fix)

- Reconcile new threshold 0.85 vs existing `config.js:38,42` floors (0.48 / 0.065). Either retune both or document why they coexist. Principle 5 sensitivity test required.
- Anthropic Sonnet wiring in M2 is partially dead until M9; document why it's pre-wired (so escape-hatch users have a frontier option) or move to M9.
- Pin Node version (22 LTS suggested) in `package.json` engines.
