# RALPLAN-DR — WHA Spell Simulator v0.2 ("The Big One") — Iteration 2

**Mode:** DELIBERATE consensus planning (high-risk: new server surface, new LLM dependency, new graphics stack, ~10x existing module count).
**Input spec:** `.omc/specs/deep-dive-wha-simulator-improvements.md` (12% ambiguity, ratified).
**Iteration 1 reviews addressed:** Architect APPROVE_WITH_SYNTHESIS (6 revisions, all incorporated) + Critic ITERATE (8 required changes, all incorporated).
**Source-of-truth LOC:** 5,887 across 42 files (Lane 1 audit). Recognition core is `src/parser/templateMatcher.js` (368 LOC, 0% test coverage); ring detector already *detects* nested rings at `ringDetector.js:534–542` but rejects them; compiler hard-rejects multi-ring + multi-sigil at `spellBuilder.js:115–120`.

---

## 1. Principles (5)

1. **WHA-DSL is the universal contract.** Every judge response, every canonical glyph definition, every nested-ring composition rule, and every renderer hand-off serialises through one strict JSON schema (`Ring | Line | Arc | Dot | Symmetry`). The DSL is the *only* coupling between the LLM and everything downstream — swap models freely; never let any model's idiom leak into render or compiler code. **AST↔DSL parity is enforced by an explicit bidirectional mapper module (`src/parser/llmJudge/astDslMapper.js`) shipped in M1 with round-trip tests on every M4 fixture** (Architect Principle 1 fix).
2. **Template matcher remains the privileged offline fast path.** Lane 1 confirmed the 8-rotation raster matcher runs in ~5ms and is deterministic. Judge is invoked only when (a) template top-1 < 0.85 OR (b) the user toggles "always critique." The judge never overrides a confident template match silently; it can *flag* one, never *replace* it without UX confirmation. The new 0.85 threshold is reconciled against existing `config.js:38,42` floors (0.48 / 0.065) in M5 with a sensitivity test (Critic minor); they coexist because 0.85 is the *judge-trigger* threshold, not the *match-accept* threshold.
3. **Headless Playwright is the only Playwright.** `chromium.launch({ headless: true })` is enforced in `playwright.config.ts`, **which is committed in M1** (Architect T5). A separate `npm run test:e2e:headed` exists only as a debug escape hatch and is *not* wired into CI or any `npm test*` default. Every new UI surface ships with a golden-image baseline + interaction test + console-error assertion in the same PR — no "we'll add tests later."
4. **Streaming is structured-JSON-first, not text-first.** SSE chunks accumulate into a *progressive* JSON parser (partial-object emit), not a markdown-then-extract pipeline. **The Worker normalises three different SSE dialects (OpenAI-style Groq, OpenAI-style SambaNova, Anthropic event-typed) into one uniform shape `{ kind: 'token-delta' | 'done' | 'error', text?, reason? }`** (Architect T3). Three UX surfaces (overlay, side panel, cursor bubbles) all subscribe to the same event stream of well-typed `WHADSLPartial` events.
5. **Magic numbers get sensitivity tests before they get changed.** Lane 1 flagged 40+ magic numbers (e.g. `RING_*` thresholds, confidence floors at `config.js:38,42`, duration exponent `1.45` at `spellBuilder.js:31`). Any v0.2 retune (especially line-quality formula) must ship with a unit test that asserts behaviour at the tuned value *and* a snapshot at ±0.05. M5 baselines pre-change duration exponent behaviour as a regression fixture before adjacent changes land.

---

## 2. Decision Drivers (top 3)

1. **Latency budget AC-P2 (relaxed to <500ms p50 / <1000ms p95 to first user-visible WHADSLPartial event, measured by in-app `?latency-bench` route over ≥100 round-trips in two regions: US-East and EU-West).** "First user-visible WHADSLPartial event" is defined as *the moment the first primitive renders on the judge overlay canvas*, not just SSE byte-arrival. <300ms remains a stretch goal. (Critic required change #3.) Drives provider choice (Groq's 180ms TTFT vs SambaNova's 900ms TTFT — both fired in parallel per Architect T1), drives diff-gating (no submission unless dHash Hamming ≥ 6), drives the Worker location, drives image size (256×256).
2. **DSL stability across model upgrades.** Maverick will be deprecated within ~12 months (Lane 4 risk). Anthropic, Groq, SambaNova all phrase tool calls differently. The DSL JSON schema + a Worker-side per-provider adapter is the only way regression tests stay valid when we swap models. Drives every provider module to expose the same normalised event stream.
3. **Scope rigidity (no non-goals).** User confirmed every candidate cut feature stays. M9 (stretch) being "best-effort, not blocking ship" is the only release valve. **A release-train fallback in §8 ADR (M1–M3 as v0.2-alpha if M4 slips >2 weeks) provides a second valve without violating scope** (Architect revision 6).

---

## 3. Viable Options (≥2 per major choice)

### Option Set A — Streaming throttle primary mechanism

| | A1: dHash-gated submission | A2: stroke-end debounce (150ms) | A3: idle-tick (every 750ms) |
|---|---|---|---|
| Pros | Cheapest (skips unchanged frames); aligns with Krea Realtime / Leonardo Realtime | Aligns with how users naturally pause; matches Tldraw AI agent pattern | Guarantees forward progress even on slow continuous strokes |
| Cons | Hash compute adds ~5–10ms; can starve on very-slow draws | Wastes calls if user redraws the same shape repeatedly; nothing fires mid-stroke | Burns budget when user is just thinking with pen down; worst for AC-P2 |
| Cost @ 20 calls/spell | $0.0099 | ~$0.012 (more calls) | ~$0.020 (most calls) |

**Recommendation: Combine all three** with stroke-end as the trigger, dHash as the gate, idle-tick as a 750ms safety net.

### Option Set B — DSL parser location (client vs Worker)

| | B1: Client progressive JSON parser, Worker forwards unchanged | B2: Worker normalises + strict validates, client consumes uniform event shape |
|---|---|---|
| Pros | Simplest Worker (~30 LOC) | Defence-in-depth; one SSE dialect to test; PII sanitisation surface; mandatory for Anthropic SSE shape (event-typed) |
| Cons | Client must branch on three SSE dialects (OpenAI Groq, OpenAI SambaNova, Anthropic event-typed) — confirmed in Lane 4 §A.2 | ~200 LOC Worker (not 30); +5–15ms latency |
| Compatibility | Breaks on Anthropic SSE | Works for all three providers identically |

**Recommendation: B2 Worker normalises** (Architect T3 promotion). The Worker emits a uniform stream `{ kind: 'token-delta' | 'done' | 'error', text?, reason? }`. The client runs the progressive JSON parser on the *normalised* token stream — keeping the progressive-render UX advantage *and* dialect abstraction.

### Option Set C — Nested-ring representation in the AST

| | C1: Flat `rings: Ring[]` with `parentIndex` | C2: Tree `Ring { children: Ring[] }` |
|---|---|---|
| Pros | Maps 1:1 to DSL `primitives[]` — Principle 1 alignment; trivial JSON round-trip for prepared-spell `localStorage`; combinatorial tests | Models canon precisely; trivial renderer recursion |
| Cons | Compiler reconstructs topology each call | Schema diff; cycle guard needed; AST↔DSL flatten-tree mismatch |
| Test surface | Combinatorial | Structural |

**Recommendation: C2 tree-structured, with explicit AST↔DSL mapper.** Critic prefers the explicit mapper (Required change #1, Principle 1 fix) over collapsing AST shape. The mapper lives in `src/parser/llmJudge/astDslMapper.js` shipped in M1; bidirectional round-trip tests run on every M4 fixture. AST stays canon-shaped (tree); DSL stays flat-serialisable; mapper is the only place that knows both.

### Option Set D — Effect-stage rendering target

| | D1: PixiJS separate overlay over existing `#effectCanvas` | D2: Co-render in existing Canvas 2D |
|---|---|---|
| Pros | Zero changes to existing 5 effect modules; PixiJS particle filters layer cleanly; lazy-loadable | Single render pass; one canvas |
| Cons | DOM has 3+ canvases | Forces rewrite of 1100 LOC of effects; blocks AC-F4 glow until rewrite done |

**Recommendation: D1 separate Pixi overlay.** Lazy-load PixiJS on the first canvas `pointerdown` (Architect T6, broadened from "first ring closure") so the closure flash itself doesn't pay the cold-cache cost.

### Option Set E — Provider routing default

| | E1: SambaNova primary | E2: Groq primary | **E3: Parallel double-request (RECOMMENDED)** |
|---|---|---|---|
| Pros | Sustained throughput | Lowest TTFT | Combines both regimes; no failover discontinuity; SambaNova already in flight if Groq 429s |
| Cons | 900ms TTFT blows AC-P2 | Lower throughput for long critique | ~$0.10/spell at 2x providers (Lane 4 §A.4); slightly more Worker logic |

**Recommendation: E3 parallel double-request** (Architect T1 promotion). The Worker fires both providers in parallel: **Groq for the cursor-bubble first-hint (TTFT-dominated, <50 tokens) and SambaNova for the side-panel deep critique (throughput-dominated, 200–500 tokens).** Identical DSL contract on both sides. Client multiplexes the two normalised streams. **60ms Groq head-start guard**: if Groq returns a complete short response within 60ms after stroke-end, SambaNova request is aborted (saves cost on trivial recognitions). If Groq 429s or errors, SambaNova is already in flight and is promoted to first-hint duty. Anthropic Sonnet is pre-wired (M2) but only fires when user supplies own key via escape hatch — pre-wiring exists so the escape-hatch user gets a frontier-model option without code changes (Critic minor item).

---

## 4. Implementation Roadmap

**Milestone count:** 10 (added M0 fixture corpus, split M7 into M7a/M7b, added M8a observability per Critic required changes #2, #4, #5).

### M0 — Fixture corpus capture (NEW — Critic required change #2)
**Effort: M | Dependencies: none | AC: foundation for AC-P1**

Standalone person-week. Three contributors (≥3 different drawers per Critic Pre-mortem E), each ~1.5 days. Reviewer is *not* one of the contributors.

**Files to create:**
- `tests/fixtures/glyphs/clean/` — 30 clean drawings (5 sigils × 6 examples each); flag `quality: clean`.
- `tests/fixtures/glyphs/messy/` — 20 hand-shake/messy variants; flag `quality: messy`.
- `tests/fixtures/glyphs/nested/` — 10 nested-ring examples (5 two-deep, 5 three-deep); flag `quality: nested`.
- `tests/fixtures/glyphs/signs/` — 40 sign-only fixtures (8 signs × 5 examples), 5 of which include the new M6 signs (Dispersion, Direction, Window, Diamond, Repetition).
- `tests/fixtures/glyphs/INDEX.json` — registry: each entry has `{ path, contributor, drawer_id (1|2|3), quality, ground_truth: { glyph, primitives, signs }, split: 'train' | 'test', strokeFormat: 'raw-points-v1' }`.
- `tools/corpusCapture.html` — minimal capture tool that wraps existing `tools/strokeTemplateMaker.html` to write labelled PNG + stroke JSON to a download.

**Stroke format note:** Every fixture stores raw input points under the `strokeFormat: 'raw-points-v1'` contract (timestamped `[x, y, t, pressure?]` tuples). M7a's perfect-freehand migration must preserve raw-points-v1 capture for fixture validity; perfect-freehand polygons are render-only and are *not* stored in fixtures. This keeps the fixture corpus stable across M7a's renderer rewrite.

**Split rule:** **70% train / 30% test, stratified by drawer + quality bucket** so no drawer dominates either split.

**Acceptance criteria:**
- ≥3 distinct `drawer_id`s in INDEX.
- ≥3 examples of each glyph and each sign in the *test* split.
- ≥30% of the test split tagged `quality: messy`.
- Reviewer sign-off recorded as a commit by a contributor *other than* the capturers.

**Test plan:**
- Meta-test in M8: `bench/recognize.js --split=test` only ever loads `split: 'test'`. Train fixtures cannot accidentally enter the AC-P1 measurement.

---

### M1 — WHA-DSL schema + AST↔DSL mapper + Worker proxy (normalising) + Playwright config (Foundation)
**Effort: L (re-scoped up from M) | Dependencies: M0 | AC: AC-F8, foundation for AC-F5, AC-P3**

**Files to create:**
- `src/parser/llmJudge/dsl.js` — JSON Schema for `WHADSL { primitives: Primitive[], guess: { glyphId, confidence }, alternatives: [], critique: { closure, cleanliness, continuity, recognizability, score }, errors: [], hint: string }`. Primitive union: `Ring | Line | Arc | Dot | Symmetry`. Closed `glyphId` set: `{fire, water, wind, earth, light, none}`.
- `src/parser/llmJudge/dslValidator.js` — Ajv strict-mode `validate(full)` + `validatePartial(obj)` for progressive parsing.
- `src/parser/llmJudge/progressiveJsonParser.js` — accumulator emitting valid partial objects from token chunks.
- `src/parser/llmJudge/astDslMapper.js` — **NEW** explicit mapper `astToDsl(glyphAST) → WHADSLPrimitive[]` and `dslToAst(primitives) → GlyphAST`. Includes cycle guard for the C2 tree shape. Round-trip property: `dslToAst(astToDsl(x)) === x` modulo non-semantic fields.
- `worker/wha-llm-proxy/src/index.ts` — Cloudflare Worker: `POST /api/judge` accepts `{ image, mode: 'fast' | 'deep', settings }` and **fires Groq + SambaNova in parallel when `mode === 'parallel'`** (Architect T1). Normalises three SSE dialects (OpenAI-style for Groq + SambaNova; event-typed for Anthropic) into uniform `{ kind: 'token-delta' | 'done' | 'error', text?, reason?, provider }` stream (Architect T3, ~200 LOC).
- `worker/wha-llm-proxy/src/analytics.ts` — **NEW** observability emitter (Critic required change #4). Per-request: provider, latency_ms (TTFT + total), status_code, mode, breaker_state. Uses Cloudflare Workers Analytics Engine. Counters: request_count, breaker_trip_count, dsl_invalid_count, kv_rate_limit_count, judge_template_disagreement (template top-1 vs judge top-1).
- `worker/wha-llm-proxy/src/circuitBreaker.js` — **NEW** (Architect Pre-mortem D + Critic required change #1). Counts consecutive 5xx / network failures per provider; trips at 3; while tripped, fast-fails with `{ kind: 'error', reason: 'breaker-open' }`. **Auto-probe every 60 seconds while tripped**: fire a single low-cost ping (1-token completion); on success, close breaker.
- `worker/wha-llm-proxy/wrangler.toml` — bindings: `GROQ_KEY`, `SAMBANOVA_KEY`, `ANTHROPIC_KEY`, KV namespace `RATELIMIT`, Analytics Engine dataset `JUDGE_ANALYTICS`.
- `playwright.config.ts` — **moved into M1** (Architect T5). `headless: true`, viewport `1280×800`, `animations: 'disabled'`, `maxDiffPixelRatio: 0.001`, snapshot directory `tests/golden/`.
- `tests/golden/.gitkeep` — directory committed in M1; populated incrementally by M3, M6, M7a, M7b.
- `tests/dsl.test.js` — schema acceptance/rejection (5 valid + 7 invalid).
- `tests/astDslMapper.test.js` — round-trip on every M0 corpus fixture (auto-loaded).
- `tests/dslValidator.fast-check.test.js` — property-based.
- `tests/worker.test.ts` — miniflare: SSE normalisation, breaker trip/recover, KV rate-limit.

**Files to modify:**
- `package.json` — add `ajv`, `fast-check`, `@cloudflare/workers-types`, `@playwright/test`, `miniflare`. Scripts: `worker:dev`, `worker:deploy`, `test:e2e`, `test:e2e:headed`, `golden:update`. **Pin engines: `node >= 22.0.0`** (Critic minor).
- `index.html` — **placeholder Content-Security-Policy meta tag committed in M1** so the security baseline is set before any provider code lands in M2. Baseline: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'">`. M2 upgrades `connect-src` to the full allowlist (Worker + Groq + SambaNova + Anthropic).

**Acceptance criteria (cross-ref):**
- AC-F8: Worker live; circuit breaker functional; `localStorage` user-key escape hatch path exists (UI wired in M3).
- AST↔DSL round-trip passes on 100% of M0 fixtures (Principle 1).
- Worker emits Analytics Engine events for every request (observability slice).
- `playwright.config.ts` committed and `npm run test:e2e -- --list` succeeds (no tests yet, just infra).

**Alert thresholds (Critic required change #4):**
- breaker_trip_count > 5% of traffic over 5min → ops alert.
- dsl_invalid_count > 5% over 1hr → ops alert (informs Pre-mortem B).
- p95 latency > 1500ms → ops alert.
- judge_template_disagreement > 20% → review prompt drift.

**Test plan:**
- Unit: 12+ DSL fixtures; round-trip on all M0 fixtures; cycle-guard on malicious tree input.
- Property: fast-check 100 random DSL trees.
- Worker: miniflare — POST returns normalised SSE; 3 consecutive 5xx trips breaker; auto-probe restores after fake-time advance; rate-limit triggers 429 after 10/min.
- Playwright: N/A (config only; tests start M3).

---

### M2 — Streaming judge module + provider adapters + Worker-failure UX
**Effort: L | Dependencies: M1 | AC: AC-F5, AC-F8, Pre-mortem D**

**Files to create:**
- `src/parser/llmJudge/streamingJudge.js` — orchestrator. Public API: `createStreamingJudge({ canvas, onPartial, onFinal, onError, settings })`. Implements dHash-gate + stroke-end debounce (150ms) + idle-tick (750ms). `AbortController` per request. **Multiplexes the Worker's normalised parallel-double-request stream** (Architect T1): tags primitives from Groq as `source: 'fast'`, from SambaNova as `source: 'deep'`. Cursor-bubble UX subscribes to `fast`; side panel subscribes to `deep`; overlay subscribes to whichever arrives first. **Conflict precedence rule:** when `source: 'fast'` and `source: 'deep'` produce conflicting `guess.glyphId`, the deep `guess` overrides the fast `guess` on arrival; overlay re-renders, side-panel updates, and a `judge.guessRevised` event fires so cursor-bubble UX can swap the hint string. This is the consistency rule — fast is provisional, deep is authoritative.
- `src/parser/llmJudge/perceptualHash.js` — 64-bit dHash + Hamming distance. ~50 LOC.
- `src/parser/llmJudge/providers/_normalisedClient.js` — single client that talks to Worker `/api/judge`; **no per-provider SSE branching on the client** (per Architect T3).
- `src/parser/llmJudge/providers/anthropic.js` — direct call only (escape hatch with `dangerous-direct-browser-access`); used only when user supplies own key. Pre-wired so escape-hatch users get a frontier option (Critic minor).
- `src/parser/llmJudge/prompts.js` — system prompt (closed-set classification), few-shot anchors from `sigils.json`, rubric, separate `fast` vs `deep` prompt variants (fast = primitives + hint only; deep = full critique).
- `src/ui/judgeToast.js` — **NEW** circuit-breaker UX (Architect Pre-mortem D, Critic required change #1). Non-blocking toast: `"Judge unavailable — template matching still works. Add your own key in Settings to bypass."` Triggered by 3 consecutive Worker failures *or* `kind: 'error', reason: 'breaker-open'`. Auto-dismisses when breaker closes (auto-probe success).
- `src/ui/latencyBench.js` — hidden `?latency-bench` route (Pre-mortem A pre-empt + Critic required change #3). Runs 100 mocked + 100 live round-trips, emits JSON to clipboard + console; measures TTFT-to-first-overlay-render in two regions.

**Files to modify:**
- `src/main.js` — wire `createStreamingJudge` when settings.judge.enabled.
- `src/config.js` — add `llmJudge: { proxyUrl: '/api/judge', mode: 'parallel', diffThreshold: 6, idleTickMs: 750, debounceMs: 150, alwaysCritique: false, userKey: null, groqHeadStartMs: 60 }`.
- `index.html` — **upgrade the M1 placeholder CSP** (Critic required change #8a) to the full allowlist: `connect-src 'self' https://wha-llm-proxy.<account>.workers.dev https://api.groq.com https://api.sambanova.ai https://api.anthropic.com;`. M1 already committed `default-src 'self'`; M2 only widens `connect-src`.

**Acceptance criteria:**
- AC-F5: stroke → debounce → dHash gate → parallel Worker request → progressive parse → fast events render in overlay, deep events render in panel.
- **AC-P2 (relaxed per Critic #3):** `?latency-bench` route reports **p50 < 500ms and p95 < 1000ms to first user-visible WHADSLPartial event** (defined as first primitive rendered on `#judgeOverlayCanvas`, not just SSE byte-arrival), over ≥100 round-trips, measured in US-East and EU-West. Stretch target <300ms p50.
- Pre-mortem D mitigation: Worker 503 → circuit breaker trips after 3 → toast appears → auto-probe restores after 60s → toast auto-dismisses.

**Test plan:**
- Unit: dHash deterministic; Hamming threshold; streamingJudge multiplex (mock both providers, assert fast events arrive before deep events given 60ms guard).
- Playwright (using M1's config): mock Worker fixed-latency, draw circle, assert first overlay primitive appears within 500ms p50 over 20 trials.
- Playwright: Worker 503 simulation → assert toast appears + template path stays green + console error count = 0.
- Latency bench manual measurement in two regions before declaring M2 done.

---

### M3 — Three-layered judge UX
**Effort: L | Dependencies: M2 | AC: AC-F5 (UX half), AC-F8 (settings UI)**

**Files to create:**
- `src/ui/judgeOverlay.js` — third canvas `#judgeOverlayCanvas` on top of `#effectCanvas`; renders DSL primitives as glowing ghosts. Subscribes to `streamingJudge` events.
- `src/ui/judgePanel.js` — collapsible right-rail "Judge" tab. Token-by-token render of `critique` (deep stream). Shows current model, latency, confidence bar.
- `src/ui/judgeHintBubbles.js` — DOM div at cursor; `hint` field; auto-fades after 2s. **Default off, opt-in via settings** (Architect T7).
- `src/ui/settingsPanel.js` — "Settings" tab. Controls: judge on/off, mode (parallel/groq-only/sambanova-only/smolvlm-offline), user-key inputs (namespaced `wha.userKey.{provider}` in `localStorage`), three-surface toggles, alwaysCritique. **Graphics controls (NEW — iter 3 user mandate):** `graphics: { bloom: bool, paperTexture: bool, perElementShaders: bool, particleQuality: 'low' | 'med' | 'high' }`. All four default to enabled / `'high'` on first run; graphics quality persists in `localStorage` under `wha.graphics.*`. **Settings panel shows explicit disclosure copy** (Critic required change #8b): *"Your provider key is stored locally in your browser. We never see it. Only paste keys you own and can rotate. You can wipe it by clicking 'Forget Key' below."*

**Files to modify:**
- `index.html` — add `#judgeOverlayCanvas`, "Settings" tab. CSP already committed in M2.
- `assets/css/styles.css` — judge panel, hint bubble, overlay blend mode.

**Acceptance criteria:**
- AC-F5: all three surfaces render from same event stream; toggling any individually hides it without breaking others.
- AC-F8: settings panel writes/reads `localStorage`; user-key escape hatch works; disclosure copy visible.

**Test plan:**
- Playwright goldens (under M1 config): `tests/golden/judge-overlay-{empty,ring-only,full-glyph}.png`, `judge-panel-{empty,streaming,complete}.png`, `hint-bubble-{visible,faded}.png`. Tolerance 0.1%.
- Interaction tests: draw circle → overlay paints Ring within 500ms after pointer-up; toggle off → disappears.
- Console-error assertion: empty over 30s draw session.
- Network assertion: every judge call hits `/api/judge`, not provider URLs directly (CSP also enforces).

---

### M4 — Engine extension: nested-ring AST + compiler + sign-flip + prepared spells
**Effort: L | Dependencies: M1 (mapper) | AC: AC-F1, AC-F6, AC-F7**

**Files to modify:**
- `src/parser/ringDetector.js:534–542` — stop rejecting nested rings; emit `rings: Ring[]` tree (C2). Each Ring: `{ radius, centerX, centerY, completeness, strokeIds, children: Ring[] }`. **AST migration substep** (Architect T2): rewrite the ~8 read-sites of `glyphAST.ring.*` in `spellBuilder.js`, `drawingClassifier.js`, and renderers to walk the tree; substep lands as the first PR of M4 before any nested-ring composition logic.
- `src/parser/drawingClassifier.js` — for each Ring, assign signs whose centroid falls in its annulus.
- `src/compiler/spellBuilder.js:115–116` — remove `unsupportedMultipleRings` hard-reject. Add `composeNestedRings(rings)` that walks the tree.
- `src/parser/signRotation.js` — detect 180° flipped orientation; emit `flipped: true`.
- `src/compiler/semanticRules.js` — flip rule: invert `force/focus/spread/range`. Define paired inversions in `signs.json` (`enlarge ↔ reduce`, `wall-breaker ↔ integration`).
- `src/compiler/spellBuilder.js` — prepared-spell: save `GlyphAST` to `localStorage` when ring open + manual save click.

**Files to create:**
- `src/ui/preparedSpells.js` — list saved glyphs; click to reload; "Fire" mints a closing dot at the gap position.
- `tests/nestedRings.test.js`, `tests/signFlip.test.js`, `tests/preparedSpell.test.js`.

**Acceptance criteria:**
- AC-F1: nested rings → AST tree depth ≥ 2 → SpellIR valid → renderer composes (inner element × outer activation).
- AC-F6: flipped sign inverts semantic; assert pairwise `enlarge.semantic + flipped(enlarge).semantic === reduce.semantic` within 0.01.
- AC-F7: open ring → save → reload page → list → fire → ring closes → spell activates within one animation frame.
- AST↔DSL round-trip passes on all M0 nested fixtures.

**Test plan:**
- Unit: nested AST against 3 canon fixtures (Memory Erasure, Sylph Shoes, Light-Reducing).
- Playwright: draw outer ring + inner ring + fire sigil + flipped-enlarge → SpellIR JSON shows `compositionMode: 'nested'` and reduced `force`.

---

### M5 — Line-quality formula + Quality panel UI
**Effort: M | Dependencies: M4 | AC: AC-F2**

**Files to modify:**
- `src/compiler/spellQuality.js` — emit `cleanliness, length, closurePrecision, symmetry`. Cleanliness = curvature-variance weighted + inverse pen-lift + closure-precision; weights documented inline. Length normalised to `total_ink / (2π × ring.radius)`, capped 2.5×. **Baseline regression fixture**: before changing any formula constant, snapshot current SpellIR output for a known fixture (Principle 5 + Architect Principle 5 fix).
- `src/compiler/spellBuilder.js` — expose `qualityMetrics`; `power = base × (1 + cleanliness × 0.4 + min(length, 2.5) × 0.2)`.
- `src/parser/llmJudge/prompts.js` — judge reports cleanliness + length in `critique`.

**Files to create:**
- `src/ui/qualityPanel.js` — 4 meters: Cleanliness, Length, Closure, Symmetry.
- `tests/quality.sensitivity.test.js` — sensitivity at ±0.05 around new weights.

**Acceptance criteria:**
- AC-F2: SpellIR contains `qualityMetrics.*` in `[0,1]`; quality panel renders; judge response includes cleanliness + length.
- Pre-change baseline regression fixture passes.

**Test plan:**
- Unit: clean circle → cleanliness ≥ 0.85; jittery → ≤ 0.45. Sensitivity at ±0.05.
- Playwright: clean spell vs messy spell → distinct quality-panel screenshots.

---

### M6 — 5 new signs vertical slices
**Effort: M | Dependencies: M4 + M5 | AC: AC-F3 (tightened per Critic #6)**

**Files to modify:**
- `src/dictionary/signs.json` — add Dispersion, Direction, Window, Diamond, Repetition (template + semantic + manifestation + directionMode + flipPair).
- `src/parser/llmJudge/prompts.js` — few-shot anchors per new sign.

**Files to create:**
- `src/renderer/effects/dispersion.js`, `direction.js`, `window.js`, `diamond.js`, `repetition.js` — each 50–150 LOC.
- `tests/signs.{dispersion,direction,window,diamond,repetition}.test.js` (5).
- `tests/golden/signs/{name}-animation-frame{1,3,5}.png` — per-sign goldens.

**Acceptance criteria (tightened per Critic required change #6):**
- AC-F3: each of 5 signs (a) recognised by template matcher ≥ 80% on its M0 test-split fixtures, (b) referenced in dictionary panel, (c) judge identifies it via few-shot test, (d) renderer animates it distinctly. **Distinctness assertion: any two new-sign animations differ by ≥15% pixel-diff at frame 3 (Playwright `toMatchSnapshot` with `maxDiffPixelRatio: 0.85` inverted-assertion).** Per-sign Playwright golden at three frames.

**Test plan:**
- Unit: dictionary load smoke; per-sign template match ≥ 0.95 on own template.
- Playwright × 5: draw sign → SpellIR contains it → renderer goldens at frames 1/3/5; pairwise distinctness assertion across the 5 new signs.

---

### M7a — perfect-freehand strokes + glow-on-closure (SPLIT per Critic required change #5)
**Effort: L | Dependencies: M3 | AC: AC-F4**

Ships independently of M7b. No PixiJS, no GLSL — pure Canvas 2D + `perfect-freehand` + existing effect modules. AC-F4 is satisfiable here.

**Files to modify:**
- `src/input/drawingCapture.js` — replace `lineTo` with `perfect-freehand` polygons; `Path2D` fill. Raw point list preserved for parser.
- `src/renderer/spellEffectRenderer.js:122–141` — prepared = dim, active = trigger glow-on-closure.

**Files to create:**
- `src/renderer/effects/glowOnClosure.js` — silver-flash + radial-spark + materialize, Canvas 2D only. Duration ~600ms (per Lane 2 §10).

**Acceptance criteria (tightened per Critic required change #6):**
- AC-F4: ring closure → silver flash (~200ms) → radial sparks (~300ms) → effect materialises upward. Prepared spells dim until closure dot lands.
- **Colour-histogram assertion (replaces screenshot-only):** at frame 3 of glow animation (≈200ms into flash), ≥30% of pixels in the silver/white range `#C0C0C0–#FFFFFF` (Playwright `evaluate` reads `ImageData`, computes histogram).

**Test plan:**
- Playwright: closure trigger → frame 3 colour-histogram assertion → total glow ≤ 700ms timed assertion.
- Console-error assertion: no warnings.

---

### M7b — PixiJS effect stage + sumi-e shader + per-element shaders + bloom + paper texture + element-aware particle physics (SPLIT per Critic required change #5; SCOPE EXPANDED iter 3 per user mandate)
**Effort: L | Dependencies: M7a, M6 | AC: amplifies AC-F4 visuals; AC-F4-extended (per-element distinctness)**

GLSL-rich milestone. **M7b ships in v0.2; only M9 is best-effort. The risk-split exists to derisk AC-F4 (M7a is the Canvas 2D safety net), not to permit graphics deferral. The user explicitly authorised considerable graphics investment; M7a is the floor, M7b is the target.**

**Files to create:**
- `src/renderer/effectsPixi/stage.js` — PixiJS Application bound to `#effectPixiCanvas`. **Lazy-loaded on first `pointerdown`** (Architect T6).
- `src/renderer/effectsPixi/inkWashFilter.js` — GLSL fragment shader (sumi-e wet-on-dry) applied to the glyph layer.
- `src/renderer/effectsPixi/sparks.js` — tsParticles config per element (replaced/extended by `particlePhysics.js`).
- `src/renderer/effectsPixi/elementShaders/fire.frag` — **NEW** fire flicker noise shader (Perlin/curl noise distorting UV, color-mapped to fire palette of red/orange/yellow gradient, animated over time via `u_time` uniform).
- `src/renderer/effectsPixi/elementShaders/water.frag` — **NEW** caustic refraction shader (sin-overlap on UV with phase offsets, blue-cyan palette, ripple animation driven by `u_time`).
- `src/renderer/effectsPixi/elementShaders/wind.frag` — **NEW** curl-noise volumetric displacement, semi-transparent white wisps, motion bias along a `u_windDir` direction vector.
- `src/renderer/effectsPixi/elementShaders/earth.frag` — **NEW** dust-cluster scatter shader (fbm noise, brown/ochre palette, settling motion via `u_time` decay envelope).
- `src/renderer/effectsPixi/elementShaders/light.frag` — **NEW** radial bloom + chromatic aberration, white-gold palette, intensity peak at center falling off with `1/r²`.
- `src/renderer/effectsPixi/bloomPass.js` — **NEW** PixiJS `AdvancedBloomFilter` applied to the effect-stage container; gated by `settings.graphics.bloom`. Quality steps `low|med|high` map to bloom kernel size and pass count.
- `src/renderer/effectsPixi/paperTexture.js` — **NEW** slow-scroll fbm noise on the substrate layer (z-index below glyph), ~2s period, 4% opacity drift to feel "alive"; gated by `settings.graphics.paperTexture`.
- `src/renderer/effectsPixi/particlePhysics.js` — **NEW** per-element emitter configs replacing tsParticles defaults: **gravity** for earth/water embers (downward acceleration, terminal velocity cap); **wind-field drag** for wind/fire embers (curl-noise advection sampled from wind shader's vector field); **light-decay curves** for light/fire embers (exponential alpha falloff, energy-conserving size growth). Each element exposes `{ emitterRate, lifespan, sizeCurve, velocityField, alphaCurve }`.

**Files to modify:**
- `package.json` — add `perfect-freehand` (M7a), `pixi.js@^8`, `@pixi/filter-advanced-bloom`, `tsparticles`, `tsparticles-engine` (M7b).
- `index.html` — add `#effectPixiCanvas` (z-index between effect and judge overlay).
- `src/ui/settingsPanel.js` — wire the M3 graphics controls (`bloom`, `paperTexture`, `perElementShaders`, `particleQuality`) to the M7b modules: each toggle hot-swaps the corresponding Pixi filter/emitter without re-mounting the stage.

**Acceptance criteria:**
- Sumi-e shader renders on glyph layer without WebGL warnings on M-series headless Chromium.
- PixiJS asserted *not in entry chunk's import graph* (Architect T4 — replaces dead "chunk split asserted" with this structural check).
- **AC-F4-extended (per-element distinctness):** Each of the 5 elements has a visually distinct shader signature; **pairwise pixel-diff ≥20% at frame 5 of effect playback** (Playwright `evaluate` reads `ImageData` per element at frame 5, computes pairwise diff across all 10 pairs, asserts every pair ≥20%); bloom and paper-texture toggleable in settings (toggling either changes ≥10% of pixels in a controlled scene); **per-element particle trajectories distinguishable** (Playwright trajectory-hash assertion: record 30 frames of particle positions per element, hash the trajectory polylines, assert all 5 hashes distinct).

**Test plan:**
- Playwright: visual baseline of ink-wash filter on a known glyph; spark emission count assertion.
- Playwright × 5 elements: per-element golden at frames 1/5/15; pairwise pixel-diff matrix assertion (10 pairs × ≥20% diff at frame 5).
- Playwright: bloom toggle off → bloom toggle on diff ≥10%; paperTexture toggle off → on diff ≥10% in a static empty scene.
- Playwright: particle trajectory hash assertion across 5 elements.
- Build assertion: `import.meta.glob` analysis confirms PixiJS not in entry chunk.

---

### M8 — Recognition bench + judge fixtures + CI workflow
**Effort: M (re-scoped down — observability moved to M8a, corpus to M0) | Dependencies: M0 (corpus exists), M1–M7b | AC: AC-P1 (on test split), AC-P3**

**Files to create:**
- `tests/judge-fixtures/` — pinned `(image + system-prompt + model-id) → expected JSON` per provider.
- `bench/recognize.js` — **runs against M0's `split: 'test'` only** (Critic required change #2). Emits confusion matrix + JSON report. Fails CI if accuracy < 90% on top-1.
- `.github/workflows/ci.yml` — Node 22 + Playwright; runs `npm test`, `npm run bench:recognize -- --split=test`, `npm run test:e2e`. Uploads diff artifacts.

**Files to modify:**
- `package.json` — `"bench:recognize": "node bench/recognize.js"`.

**Acceptance criteria:**
- AC-P1: ≥ 90% top-1 on **held-out test split** (not the corpus used for tuning).
- AC-P3: every PR runs all three test layers; failure blocks merge.

**Test plan:**
- Meta-test: mutate `templateMatcher.js` constant → bench exits non-zero.
- Meta-test: 1-pixel renderer change → golden diff catches it.

---

### M8a — Observability dashboard + alert thresholds (NEW per Critic required change #4)
**Effort: S | Dependencies: M1 (Worker analytics emitter), M2 (real traffic) | AC: AC-P3 amplification**

The Worker already emits to Analytics Engine in M1; M8a wires the dashboard and alerts.

**Files to create:**
- `worker/wha-llm-proxy/dashboard.md` — documented Cloudflare Analytics Engine queries: per-provider p50/p95/p99 latency, status-code histogram, breaker-trip rate, dsl-invalid rate, judge-template-disagreement rate, KV-rate-limit hit rate, cost-per-spell estimate (request count × per-call cost).
- `worker/wha-llm-proxy/alerts.toml` — Cloudflare alert rules (or documented config): breaker_trip > 5% / 5min, dsl_invalid > 5% / 1hr, p95 > 1500ms, judge-template-disagreement > 20%.
- `tests/observability.test.ts` — miniflare: forge events, assert analytics binding called with expected schema.

**Acceptance criteria:**
- Dashboard renders for ≥7 days of live traffic before v0.2 ship.
- Synthetic alert test: forge a breaker_trip storm in staging → alert fires within 5 min.

**Test plan:**
- Synthetic: scripted run-up of 100 fake breaker_trip events → alert triggers.

---

### M9 — Stretch: SmolVLM offline + Dictionary Editor + Replay + Gallery
**Effort: XL | Dependencies: M1–M8a shipped | AC: AC-S1–S4 (best-effort)**

Each is a sealed slice. No blocking on M9 for v0.2 ship. Each gets its own Playwright golden + interaction test before merging.

**Files to create:** `src/parser/llmJudge/providers/smolvlm.js` (transformers.js + WebGPU; OPFS weight cache; WASM fallback), `src/ui/dictionaryEditor/`, `src/ui/spellReplay/`, `src/ui/spellGallery/`, `worker/wha-llm-proxy/src/share.ts` (R2 endpoints).

---

## 5. Headless Playwright Testing Discipline (MANDATORY, M1 onward)

**`playwright.config.ts` committed in M1** (moved from M8 per Architect T5):

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    headless: true,                       // PRINCIPLE 3 ENFORCEMENT
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled' },
  },
  webServer: { command: 'npm run dev', port: 5173, reuseExistingServer: !process.env.CI },
});
```

**Per-milestone checklist:**
1. Goldens at `tests/golden/<feature>-<state>.png`; `--update-snapshots` reviewed manually in PR.
2. Interaction test covers golden path + ≥ 2 edge cases.
3. Console-error assertion: `page.on('console', …)` empty at test end.
4. Network assertion: every `/api/judge` POST verified; no direct provider URLs (CSP also enforces).
5. Animation tests opt into `animations: 'allow'` and assert timing budgets.
6. **Distinctness assertion for M6 signs (≥15% pixel-diff at frame 3 pairwise).**
7. **Colour-histogram assertion for M7a glow (≥30% silver/white range at flash frame).**
8. Headed mode debug-only; not in `npm test*`, not in CI.

---

## 6. Risks & Mitigations (10)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Groq/SambaNova Maverick deprecated mid-sprint | M | H | Provider modules expose identical normalised stream; model ID in `config.js`; Anthropic Sonnet escalation pre-wired (M2). |
| 2 | Worker rate-limit (100k req/day free tier) crushed by viral demo | L | H | KV per-IP 10/min; user-key escape hatch (M3); readme calls out limit. |
| 3 | Judge output drift breaks DSL contract on model upgrade | M | H | Ajv strict-mode rejects malformed output → silent fallback to template top-1. Judge-fixture regression suite (M8) catches drift; observability alert at dsl_invalid > 5% (M8a). |
| 4 | AC-P2 (<500ms p50 relaxed) infeasible on real networks | M | H | **Relaxed thresholds <500ms p50 / <1000ms p95 measured by in-app `?latency-bench` over ≥100 round-trips in US-East + EU-West.** Parallel-double-request gives Groq 180ms TTFT; diff-gating skips redundant calls; 256×256 PNG. If still infeasible, stretch <300ms goal moves to v0.3 backlog; v0.2 ships at relaxed threshold (no "best-effort wording" handwave). |
| 5 | Nested-ring composition produces nonsensical SpellIR | M | M | C2 tree representation makes composition explicit; M4 ships with 3 canon fixtures (Memory Erasure, Sylph Shoes, Light-Reducing); AST↔DSL round-trip on every M0 fixture. |
| 6 | PixiJS bundle bloat slows initial paint | L | M | Lazy-load on first `pointerdown` (Architect T6); M7b unit test asserts PixiJS not in entry chunk's import graph (Architect T4). **User explicitly authorised graphics investment mid-loop (iter 3); bundle budget is no longer a constraint on M7b scope. Lazy-load remains for first-paint UX only, not as a scope-reduction lever.** |
| 7 | Playwright flakes on M-series WebGL headless Chromium | M | M | `webgl: 'on'`, retries=2, animations-disabled for screenshots, ±50ms timing tolerance. Animation tests run serial if flaky. |
| 8 | Magic-number retune breaks existing tests | H | M | Principle 5 + M5 baselines pre-change duration exponent; sensitivity at ±0.05. |
| 9 | **XSS / `localStorage` user-key exfiltration** (Critic required change #8) | L | H | **Committed CSP in `index.html` restricts `connect-src` to Worker + provider domains** (M2). Settings panel shows disclosure copy + "Forget Key" button (M3). `crypto.subtle`-wrapped storage flagged in §8 follow-ups. No `eval`, no `Function()` constructor anywhere in codebase. |
| 10 | **Observability gap → blind degradation** (Critic required change #4) | M | H | M1 ships Workers Analytics Engine emitter. M8a wires dashboard + alerts: breaker_trip > 5%, dsl_invalid > 5%, p95 > 1500ms, judge-template-disagreement > 20%. ≥7 days of live traffic monitored before ship. |

---

## 7. Pre-mortem (DELIBERATE — 5 scenarios)

**Scenario A — "The 300ms wall is a myth in the wild."** Real-world latency averages 600ms p50 because Groq US-East TTFT is 350ms, not 180ms. **Pre-empt:** Relaxed AC-P2 (<500ms p50) absorbs this; `?latency-bench` route measures in both regions before declaring M2 done; <300ms is stretch.

**Scenario B — "The DSL is leaky."** Judge emits `"type": "Spiral"` for the Repetition sign; validator rejects 30% of responses; UX degrades silently. **Pre-empt:** M2 onError surfaces non-blocking toast; Worker emits `dsl_invalid` counter; M8a alerts at >5%.

**Scenario C — "Goldens drift faster than reviewers can keep up."** M4 changes ink colour by 1 RGB; 12 goldens break; reviewers rubber-stamp `--update-snapshots`. **Pre-empt:** PR template requires inline preview of any golden diff > 0.05%; review checkbox asks "did you visually inspect each updated golden?"; CI prints "most-frequently-updated goldens" leaderboard.

**Scenario D — "The Worker is the new SPOF."** (Architect Pre-mortem D + Critic required change #1) Cloudflare regional outage takes the judge offline. **Pre-empt:** Circuit breaker in M1 + auto-probe every 60s + escape-hatch toast (M2). User-key direct calls bypass Worker for Anthropic (M3). M8 includes Playwright Worker-503 simulation; template path stays green.

**Scenario E — "Fixture corpus bias."** (Critic required change #7) Single-team-member corpus achieves 92% on bench but real users hit 65% because corpus is too clean. **Pre-empt:** M0 requires ≥3 distinct drawers; explicit `quality: messy` tag on ≥30% of test split; reviewer is *not* a contributor; test/train split is stratified (no drawer dominates either side). M8 measures AC-P1 on test split only.

---

## 8. ADR — v0.2 Architectural Decisions

**Decision.** Ship v0.2 as 10 milestones (M0 corpus → M1 foundation → M2 streaming → M3 UX → M4 nested rings → M5 quality → M6 signs → M7a glow → M7b PixiJS → M8 bench/CI → M8a observability), with M9 stretch tier. Streaming LLM judge is the headline. **Parallel-double-request: Groq (fast first-hint) + SambaNova (deep critique) fired from a Worker that normalises three SSE dialects into one uniform stream.** DSL is the universal contract; explicit AST↔DSL mapper bridges canon-tree AST to flat DSL primitives. PixiJS lazy-loaded overlay; Playwright headless only with config committed in M1.

**Drivers.**
1. AC-P2 (now <500ms p50 / <1000ms p95) — only parallel Groq + SambaNova robustly meets it.
2. DSL contract decouples model swaps from downstream code.
3. Tree AST matches canon nested-ring semantics 1:1; mapper preserves DSL flatness.
4. Playwright headless + M1-committed config keeps CI green at 0.1% diff tolerance.
5. Observability slice in M1 + M8a gives early warning before user-visible degradation.

**Alternatives considered.**
- **SambaNova-only primary:** rejected — 900ms TTFT cannot meet AC-P2 alone.
- **Groq-only primary:** rejected — gave up SambaNova's 30% throughput win for deep critique.
- **Parallel-double-request (chosen):** Groq + SambaNova both fire; 60ms head-start guard; client multiplexes.
- **Pure-vision LLM (Lane 3 Architecture A):** rejected — kills the deterministic template-matcher fast path.
- **Flat ring array (C1):** rejected — canon is hierarchical; explicit mapper handles AST/DSL shape mismatch.
- **Co-render PixiJS in existing canvas (D2):** rejected — would force rewrite of 1100 LOC.
- **Train a custom sketch CNN:** rejected per Lane 3 §5.
- **Client-side SSE dialect branching (B1):** rejected — Anthropic SSE is event-typed, not delta-typed; Worker-side normalisation (B2) is mandatory.

**Consequences.**
- **M7b is in-scope for v0.2 ship; only M9 stretch tier is best-effort.** (Iteration 3 user mandate.) M7a remains the Canvas 2D safety net for AC-F4, but the v0.2 ship target now includes M7b's per-element shaders, bloom pass, paper texture, and element-aware particle physics. The risk-split exists to derisk graphics regressions, not to permit graphics deferral.
- Two new server surfaces (Worker proxy; R2 gallery in M9) — Worker is stateful (KV rate-limit + Analytics Engine emission); we own a deploy pipeline.
- Worker is now ~200 LOC SSE-normaliser, not 30 LOC pass-through. Higher complexity offset by single client-side SSE shape.
- New runtime dependencies: `perfect-freehand`, `pixi.js`, `tsparticles`, `ajv`.
- Test surface expands ~3× (goldens + judge fixtures + bench corpus + AST↔DSL round-trip + observability synth tests) — fixture maintenance discipline (Pre-mortem C).
- `spellBuilder.js` is the most-touched file in v0.2 (M4 + M5 + M6 all amend). Recommended micro-refactor in M4 to split into `compose.js` + `quality.js` + `params.js`.
- **Threat model: XSS / `localStorage` user-key exfiltration.** (Critic required change #8) (a) **Committed CSP in `index.html`** (M2) restricts `connect-src` to Worker + Groq/SambaNova/Anthropic domains only; rules out exfiltration to attacker-controlled endpoints. (b) **Disclosure copy in settings panel** (M3): *"Your provider key is stored locally in your browser. We never see it. Only paste keys you own and can rotate."* + "Forget Key" button wipes `localStorage`. (c) **`crypto.subtle`-wrapped storage** flagged as future hardening (see follow-ups). No `eval` / `Function()` constructor anywhere in codebase; CSP `script-src 'self'` enforces no inline. Open-question item #5 (XSS hardening) is now closed as ADR consequence.
- Cost-per-spell at parallel double-request: ~$0.10/spell at 20 calls (Lane 4 §A.4). M8a tracks this; if monthly cost exceeds budget, mode falls back to `groq-only` via config flip.

**Follow-ups (deferred or open).**
- **Release-train fallback** (Architect revision 6): If M4 slips >2 weeks past planned start, **ship M1–M3 as v0.2-alpha (judge-only, no nested rings / no new signs / no graphics overhaul)**. Resume M4–M8a as v0.2-beta. Spec disallows feature cuts; this is a *sequencing* fallback, not a feature cut.
- `crypto.subtle`-wrapped user-key storage (XSS hardening tier 2).
- "Three branches" forbidden-magic taxonomy → v0.3 easter-egg.
- Spell linkage by line → M9 if early.
- Brimhat-style broken outer arc → out of scope.
- Hu-moments / DTW template matcher migration → only if AC-P1 < 90% in M8.
- Provider quota dashboard → useful telemetry; partial in M8a, full version deferred.
- Global sensitivity-test sweep across all 40 magic numbers → future refactor; Principle 5 enforces per-retune.

---

## Plan Summary

**Plan saved to:** `/Users/pranavpabba/wha-spell-simulator/.omc/plans/ralplan-wha-v02.md`

**Scope (iteration 2):**
- 10 milestones (M0 corpus → M8a observability) for v0.2 ship; M9 stretch tier.
- New surfaces: Cloudflare Worker proxy (normalising, with circuit breaker + analytics), 3 LLM provider adapters Worker-side, WHA-DSL schema + validator + explicit AST↔DSL mapper, three-layer judge UX with circuit-breaker toast, nested-ring compiler path, line-quality formula, 5 new signs, perfect-freehand strokes + Canvas 2D glow (M7a), PixiJS effect stage with sumi-e shader (M7b), fixture corpus (M0), observability dashboard (M8a), full CI test infrastructure.
- Files created: ~40; files modified: ~14.
- Estimated complexity: **HIGH**.
- Net new tests: ~140 (unit + property + AST↔DSL round-trip + Playwright headless + bench on test-split + observability synth + colour-histogram + distinctness pairwise).

**Iteration 2 changes from iteration 1:**
- All 6 Architect revisions incorporated (T1 parallel-double-request, T3 Worker SSE normalisation, T5 Playwright config in M1, Principle 1 AST↔DSL mapper, Pre-mortem D circuit breaker + auto-probe, §8 release-train fallback).
- All 8 Critic required changes incorporated (M0 corpus with ≥3 drawers + 70/30 split, AC-P2 relaxed to <500ms p50 / <1000ms p95 measured by `?latency-bench`, M8a observability slice with alert thresholds, M7 split into M7a + M7b, AC-F3 pairwise ≥15% pixel-diff + AC-F4 colour histogram, Pre-mortem E fixture bias, XSS / CSP ADR consequence).
- Critic minor items acknowledged: Node 22 pinned in `package.json` engines; Anthropic pre-wiring rationale documented; 0.85 vs 0.48/0.065 threshold reconciliation documented inline.

**Iteration 3 changes (surgical, additive only — Architect iter 2 APPROVE_WITH_SYNTHESIS + user graphics mandate):**
- **M7b scope expanded** with 5 per-element fragment shaders (fire/water/wind/earth/light), `bloomPass.js` (AdvancedBloomFilter), `paperTexture.js` (slow-scroll fbm noise), `particlePhysics.js` (per-element gravity / wind-drag / light-decay).
- **M7b promoted to in-scope for v0.2** — only M9 stretch tier is best-effort. User authorised considerable graphics investment.
- **AC-F4-extended** added: pairwise pixel-diff ≥20% at frame 5 across the 5 elements; bloom + paper-texture toggleable; per-element particle trajectory hashes all distinct.
- **M3 settings panel** extended with `graphics: { bloom, paperTexture, perElementShaders, particleQuality }`.
- **M2 multiplex conflict precedence** documented: deep `guess` overrides fast `guess`; `judge.guessRevised` event fires.
- **M0 stroke format versioned** as `raw-points-v1`; M7a must preserve raw capture, perfect-freehand polygons are render-only.
- **M1 placeholder CSP** committed (`default-src 'self'`) so security baseline lands before any provider code; M2 only widens `connect-src`.
- **Risk 6 softened**: PixiJS bundle budget is not a scope-reduction lever; lazy-load is first-paint UX only.
- **§8 ADR Consequences updated**: M7b in-scope for v0.2 ship.

**Open questions persisted to:** `.omc/plans/open-questions.md` (companion file).
