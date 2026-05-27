# Architect Review — RALPLAN-WHA-v0.2 (DELIBERATE)

**Reviewer:** Architect agent
**Mode:** DELIBERATE consensus
**Verdict:** APPROVE_WITH_SYNTHESIS

The plan is a credible architectural posture for the v0.2 scope and the 5 principles. Several decisions are good (DSL-as-contract, C2 tree AST, lazy PixiJS overlay, headless Playwright). Several others are under-justified, inconsistent with the principles, or under-explored. Steelman first, then specific tensions, then synthesis.

---

## 1. Steelman antithesis

The strongest peer-architect counter-position is **"this is a v1, not a v0.2 — stage it."**

> The plan delivers in one release: (a) a new Worker we don't currently operate, (b) three new SSE provider integrations, (c) a streaming-JSON contract with non-trivial partial-parse semantics across three SSE dialects, (d) a new graphics stack (PixiJS + tsParticles + perfect-freehand + GLSL ink-wash), (e) the largest compiler diff this codebase has ever taken (M4+M5+M6+M7 all amend `spellBuilder.js`), (f) a fixture corpus that doesn't yet exist and which AC-P1 is conditioned on, and (g) the project's first Playwright + CI surface. Every one is a shippable v0.2 on its own. Bundling them creates a single critical path with eight serial gates.
>
> The 5 principles read like v1 architecture, not v0.2 scope discipline. Principle 1 justifies *only* the LLM judge tier — it doesn't require the graphics overhaul, new signs, prepared-spell UX, or sign-flip. Those are canon-mechanic adds that could ship as v0.2.x dot releases without touching the LLM judge.
>
> The right v0.2 is: M1 + M2 (one provider, Groq) + minimal M3 (side panel only). Ship. Then v0.3 is M4–M5. v0.4 is M6. v0.5 is M7. v0.6 is M8. Three to six months of confident dot releases instead of one all-or-nothing big bang.

**Does the Planner's choice survive?** Conditionally yes. The user's spec (§Non-goals) explicitly removed every candidate cut: "Explicitly NONE — everything stays in scope." The Planner is obeying the spec. But the antithesis still scores a real hit: the plan does not surface its own *sequencing risk* — what happens if M2 lands and M4 slips by two weeks. There is no explicit "ship M1–M3 as a usable v0.2-alpha if M4+ slip" branch. The plan should add a release-train fallback in §8 — see Synthesis.

---

## 2. Real tradeoff tensions

### T1 — Groq-primary is right; parallel-double-request is the *actually* better answer (HIGH)

The TTFT math is correct. Lane 4 §A.5: Groq Maverick TTFT ~180ms, SambaNova ~900ms; Lane 4 §A.4: Groq ~480 tok/s, SambaNova ~643 tok/s. AC-P2 budget is 80 + 180 + 40 = 300ms with **zero headroom**. SambaNova's TTFT alone exceeds budget by 600ms. The spec's "SambaNova primary" was written before Lane 4; Lane 4 §A.5 says directly: *"For continuous judging with short outputs, TTFT dominates — Groq is arguably a better pick."* E2 survives.

But the plan under-explores a third option that the spec hints at and Lane 4 §A.3 implies: **fire both providers in parallel from the Worker** — Groq for cursor-bubble first-hint (TTFT-dominated, <50 tokens), SambaNova for side-panel deep critique (throughput-dominated, 200–500 tokens). §3 Option E mentions this in passing ("possibly in parallel") but doesn't elevate it to roadmap. This matters:

1. Removes the failover discontinuity. Today's plan: if Groq 429s, fall back to SambaNova and eat 900ms TTFT. Parallel: SambaNova is already in flight; promote it.
2. Side-panel quality matters more than the bubble. SambaNova's 643 vs Groq's 480 tok/s is a 30% UX win for the panel.
3. Cost bounded — ~20 calls/spell × ~$0.005 ≈ $0.10/spell at 2x providers (Lane 4 §A.4).

**Recommendation:** Promote parallel-double-request to a stated M2 design, not a footnote. Identical DSL contracts; multiplex in `streamingJudge.js`. Add a 60ms Groq head-start guard so SambaNova doesn't fire if Groq has already returned a complete short response. **Severity HIGH** — difference between "satisfies AC-P2 fragily" and "satisfies AC-P2 robustly."

### T2 — C2 tree AST is right, but migration cost is understated (MEDIUM)

§3 Option C claims: "current AST already has only one ring slot, so the diff is a rename + add `children: []` — not a refactor cliff." Misleading. Verified at `ringDetector.js:552-557`: ring is returned as a flat object **spread** into the parent with `...ring`, with `unsupportedNestedRings`/`unsupportedMultipleRings` as sibling arrays. `spellBuilder.js:115-116` rejects on `unsupportedMultipleRings`, not nested rings. Ring representation is **a flat scalar embedded via spread**, not a slot-shaped node ready to grow children.

C2 migration touches: `ringDetector.js` return shape (the spread becomes `rings: [...]`), every consumer that reads `glyphAST.ring.*` (~8 sites per grep across `spellBuilder.js`, plus `drawingClassifier.js`, every renderer pulling `ring.centerX/centerY/radius`), and all three existing tests.

C1 (flat `rings: Ring[]` with `parentIndex`) is genuinely tempting:
- Serialisable trivially (no cycle guard, JSON round-trips into `localStorage` for prepared spells in M4).
- Testing is combinatorial, not tree-shape traversal.
- Maps 1:1 to WHA-DSL JSON array shape (`primitives: Primitive[]`) — AST and canonical glyph storage share the same flat shape, a Principle 1 win.

C2 still wins on render recursion clarity and canon-shape fidelity, so I don't reject the pick. But the plan should cite actual files touched, add an explicit "AST migration" sub-milestone inside M4 sequenced before any nested-ring logic, and document the cycle guard in `dslValidator.js`. **Severity MEDIUM**.

### T3 — Client-side progressive JSON parsing across three SSE dialects is a hazard (MEDIUM-HIGH)

§3 Option B picks B1 (client progressive parser) with "Worker forwards SSE unchanged, ~30 LOC." This assumes SSE dialect parity. Lane 4 §A.2 contradicts this for SambaNova (no `presence_penalty`, no `n>1` with tools, no `seed`, no external URL fetch). Groq is OpenAI-flavour but has its own deltas. **Anthropic's streaming format is not OpenAI-style at all** — it uses event-typed messages (`message_start`, `content_block_delta`, `content_block_stop`, `message_delta`).

The plan picks Anthropic as escalation (§4 M2) but doesn't acknowledge that the client parser must handle three different SSE shapes to extract `delta.content` (OpenAI: `choices[0].delta.content`; Anthropic: `content_block_delta.delta.text`). Either:

1. Worker normalises all three to one SSE shape (~200 LOC not 30, slight latency), OR
2. Client has three SSE branches before feeding the JSON parser.

(1) is correct. The plan should commit. This is meaningful re-scoping of M1's Worker complexity. **Severity MEDIUM-HIGH** — discovering this in M2 means re-architecting the Worker after it ships.

### T4 — Bundle assertion contradicts the spec (LOW-MEDIUM)

§6 Risk 6: "Vite chunk split asserted in M7 unit test. Spec dropped bundle budget so this is cosmetic." The plan asserts a chunk split it doesn't need. Either the bundle matters (then it's a Principle) or it doesn't (then the assertion is dead code). Right answer: lazy-load PixiJS because first-paint matters even without a hard budget — a *behavioural* principle. M7 test asserts "PixiJS not in entry chunk's import graph," provable structurally. **Severity LOW-MEDIUM**.

### T5 — M3 ships UI before goldens infrastructure exists (MEDIUM)

`playwright.config.ts` is committed in M8 (§4 M8 Files to create) but Principle 3 says **"every new UI surface ships with a golden-image baseline + interaction test + console-error assertion in the same PR — no 'we'll add tests later.'"** M3 ships three UI surfaces with golden tests at `tests/golden/judge-overlay-*.png` (§4 M3 Test plan). Without `playwright.config.ts` committed, those goldens have no canonical capture conditions (viewport, animations-disabled, diff tolerance) and will drift between developers' machines.

**The plan violates its own Principle 3** by sequencing the config in M8 while expecting M3 to comply. **Severity MEDIUM. Fix:** Move `playwright.config.ts` skeleton + goldens directory + `npm run test:e2e` script into **M1's "Files to create" list**. Goldens accumulate per-milestone. M8 becomes bench corpus + CI workflow + meta-tests.

### T6 — Lazy-load trigger choice is too narrow (LOW)

§4 M7: PixiJS lazy-loads "on first ring-closure." But PixiJS renders the entire effect stage, not just the closure flash. Spell-effect lab or Dictionary panel sample-spell previews also need it. First ring-closure is the *latest possible* moment, making the flash itself feel laggy on cold cache. **Fix:** Lazy-load on `idleCallback` after dictionary loads, or on first canvas `pointerdown`. **Severity LOW**.

### T7 — 3-layered judge UX clutter (LOW, but real)

Cursor-tip bubbles (`judgeHintBubbles.js`) fight for visual real-estate with the pen. The plan does not gate them by skill level or interaction context. Principle 3 mandate forces them to ship, but a default-off setting with an in-context tooltip pointing to it would honour the spec while preserving sanity. Flag for Critic. **Severity LOW**.

---

## 3. Principle violations (DELIBERATE)

| # | Principle | Violation | Where | Severity | Fix |
|---|---|---|---|---|---|
| 1 | DSL is the universal contract | M4's GlyphAST `nestedRings: Ring[]` (tree) is **not** the same shape as DSL's flat `primitives: Primitive[]`. Two representations of the same concept = leak. | §4 M4 vs §4 M1 dsl.js | MED | Either AST uses DSL `primitives[]` directly, or plan adds explicit AST↔DSL bidirectional mapper module + tests it. |
| 2 | Template matcher privileged | Not violated. |  |  |  |
| 3 | Headless Playwright only | M3 ships goldens before `playwright.config.ts` exists (committed in M8). Goldens captured under indeterminate config violate the "0.1% diff + animations disabled" contract. | §4 M3 vs §4 M8 | MED | Move config + dir into M1; see T5. |
| 4 | Streaming structured-JSON-first | Not violated *in spec*, but Worker forward-unchanged violates it *in practice* when Anthropic ships (event-shape SSE not JSON-delta SSE). | §3 B1; §4 M1 worker | MED | Worker normalises SSE; see T3. |
| 5 | Magic numbers get sensitivity tests | M5 retunes `power = base × (1 + cleanliness × 0.4 + min(length, 2.5) × 0.2)` — three new constants. Plan promises sensitivity test but doesn't baseline *current* duration exponent `1.45` (`spellBuilder.js:103` via audit) before adjacent changes land. | §4 M5 | LOW | M5 baselines existing power/duration; sensitivity tests include pre-change behaviour as regression fixture. |

Net: 4 of 5 principles have minor violations. None fatal; all fixable in revision.

---

## 4. Pre-mortem critique

The Planner's three scenarios (A latency wall, B DSL leak, C golden drift) are credible. **Missing failure mode — Pre-mortem D: "The Worker is the new SPOF."** All three providers, both UX tiers, and (in M9) spell-gallery R2 flow through one Cloudflare Worker. Cloudflare *regional outages* will take the judge offline. The IP rate-limit via KV makes the Worker stateful (KV eventually consistent), so partial KV degradation can cascade.

**Mitigation:** The M3 user-key escape hatch is the natural failover. When the Worker is unreachable, the settings panel auto-suggests "enter your own provider key" for direct calls (Anthropic supports `dangerous-direct-browser-access`; SambaNova/Groq still need a proxy and degrade to template-only). The plan should:

1. Detect Worker failure (network error + 5xx) in `streamingJudge.js` and emit a non-blocking toast: *"Judge unavailable — template matching still works. Add your own key in Settings to bypass."*
2. Circuit-breaker: after 3 consecutive Worker failures, default to template-only + toast until manual retry from Settings.
3. M8 includes a Playwright test simulating Worker 503; assert template path stays green and toast appears.

**Severity HIGH** — single Worker incident takes down headline feature; not addressed.

---

## 5. Synthesis

The plan is fundamentally sound. Six revisions move it from "approve with concerns" to "approve":

1. **T1 — Promote parallel-double-request to M2 design.** Groq for first-hint, SambaNova for deep-critique, both fired from Worker, identical DSL contract. Multiplex client-side; 60ms Groq head-start guard.
2. **T3 — Worker normalises SSE event shape.** Absorbs OpenAI-style and Anthropic-style and emits uniform `{ kind: 'token-delta' | 'done' | 'error', text?, reason? }`. Re-scope Worker to ~200 LOC. Client sees one shape.
3. **T5 — Move `playwright.config.ts` + goldens dir + `test:e2e` script into M1.** Reframe M8 as bench corpus + CI + meta-tests + judge-fixture regression. M3/M6/M7 contribute goldens under M1 config.
4. **Principle 1 fix — AST uses DSL `primitives[]` shape** (or ship an explicit AST↔DSL mapper in M1 and test round-trips on every M4 fixture). Drop `nestedRings: Ring[]` if collapsing; keep but mapped if not.
5. **Pre-mortem D — Worker-failure circuit breaker + escape-hatch toast in M2**, wired before M3 UI lands so the toast surface exists when M3 ships.
6. **Release-train fallback in §8.** Explicit branch: "If M4 slips >2 weeks, ship M1–M3 as v0.2-alpha (judge-only); resume M4+ as v0.2-beta." Spec disallows feature cuts; it does not disallow shipping the foundation first.

Two minor optional items:

7. **T2 — Document AST migration substep in M4** with actual files touched (~8 read-sites of `glyphAST.ring`).
8. **T4 — Replace "Vite chunk split asserted" with "PixiJS not in entry chunk's import graph asserted."** Same goal, no dead bundle-budget reference.

---

## 6. Verdict

**APPROVE_WITH_SYNTHESIS.**

Architecturally sound, faithful to the spec, respects the 5 principles in intent. Six concrete revisions before Critic:

- Parallel-double-request as M2 design (T1).
- Playwright config in M1 (T5, Principle 3).
- Worker normalises SSE shape (T3, Principle 4).
- AST uses DSL `primitives[]` shape or adds explicit mapper (Principle 1).
- Worker-failure circuit breaker + escape-hatch toast in M2 (Pre-mortem D).
- Release-train fallback in §8 (steelman concession).

None is a fundamental architectural flaw; all are corrections the Planner can make in one revision pass.

---

## References

- `src/parser/ringDetector.js:520-558` — confirms ring detection returns flat object spread into GlyphAST, with `unsupportedNestedRings`/`unsupportedMultipleRings` as sibling arrays. C2 migration cost is real, not a rename.
- `src/compiler/spellBuilder.js:115-116` — confirms compiler rejects on `unsupportedMultipleRings`, not nested rings explicitly. Planner's claim is half-right; rejection happens upstream via the detector.
- `src/compiler/spellQuality.js:39-52` — current quality formula. M5's new `cleanliness × 0.4 + length × 0.2` doesn't yet reconcile; Principle 5 fix required.
- Lane 1 audit §2 — `valid_messy` is recognition-quality, not power-modifier. M5 must change this; plan must baseline pre-change behaviour.
- Lane 2 §3 — canon-faithful inner/annular/outer convention. C2 picks this; AST↔DSL flatten/tree mismatch is what creates the Principle 1 leak.
- Lane 4 §A.5 — Groq 480 tok/s @ 180ms TTFT vs SambaNova 643 tok/s @ 900ms TTFT. Plan's math correct; parallel gives both regimes.
- Lane 4 §A.2 — SambaNova CORS + Anthropic SSE event-shape mismatch. Confirms T3.
- Plan §1 Principle 1 vs §4 M4 — direct contradiction on AST shape (tree) vs DSL shape (flat array).
- Plan §4 M3 vs §4 M8 — direct contradiction on Principle 3 timing.
- Plan §6 Risk 6 vs spec §Performance — bundle budget dropped at spec level but plan asserts chunk split. Inconsistent.

