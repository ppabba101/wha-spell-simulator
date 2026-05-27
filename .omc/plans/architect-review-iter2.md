# Architect Review — RALPLAN-WHA-v0.2 Iteration 2

**Reviewer:** Architect agent
**Mode:** DELIBERATE consensus (iter 2 — convergence)
**Verdict:** **APPROVE_WITH_SYNTHESIS** (graphics-scope expansion required, all other revisions absorbed cleanly)

---

## 1. Verification of my 6 revisions

| # | Revision | Where landed | Verdict |
|---|---|---|---|
| T1 | Parallel double-request, 60ms Groq head-start, identical DSL | §3 Option E E3, §4 M1 Worker bullet, §4 M2 streamingJudge multiplex, §8 ADR alternatives | **Absorbed correctly.** Multiplex tag `source: 'fast' / 'deep'` (§4 M2) and head-start guard explicit in §3. |
| T3 | Worker normalises 3 SSE dialects to uniform `{kind,text?,reason?}` | §1 Principle 4, §3 Option B B2, §4 M1 Worker bullet (~200 LOC), §8 ADR consequence | **Absorbed correctly.** `_normalisedClient.js` enforces "no per-provider SSE branching on client." |
| T5 | `playwright.config.ts` in M1 | §1 Principle 3, §4 M1 Files to create, §5 verbatim config | **Absorbed correctly.** `tests/golden/.gitkeep` committed in M1; M8 reframed as bench + CI. |
| P1 | Explicit AST↔DSL mapper | §1 Principle 1, §3 Option C C2, §4 M1 `astDslMapper.js`, §4 M4 round-trip ACs | **Absorbed correctly.** Round-trip property stated; runs on every M0 fixture and every M4 fixture. |
| PreD | Worker circuit breaker + auto-probe + toast | §4 M1 `circuitBreaker.js` (60s auto-probe), §4 M2 `judgeToast.js`, §6 Risk 9-pattern, §7 Scenario D | **Absorbed correctly.** Auto-probe with 1-token ping is concrete; toast auto-dismisses on close. |
| RT | Release-train fallback in §8 | §8 Follow-ups bullet 1 | **Absorbed correctly.** Explicit "M1–M3 as v0.2-alpha if M4 slips >2 weeks." |

All six clean. No subtle misreadings.

## 2. Verification of Critic's 8 required changes

All 8 absorbed correctly (M0 corpus, AC-P2 relaxed, M8a observability, M7 split, AC-F3/F4 distinctness, Pre-mortem E, XSS/CSP). See plan §4–§8.

## 3. Graphics mandate ("considerable effort")

M7b is currently **too thin**. Required additions (no milestone restructure):

1. `src/renderer/effectsPixi/elementShaders/{fire,water,wind,earth,light}.frag` — per-element shaders (fire flicker, water caustic, wind curl-noise, earth dust-cluster, light bloom).
2. `src/renderer/effectsPixi/bloomPass.js` — AdvancedBloomFilter on the effect stage container.
3. `src/renderer/effectsPixi/paperTexture.js` — slow-scroll fbm noise, 2s period, 4% opacity drift.
4. `src/renderer/effectsPixi/particlePhysics.js` — per-element emitter configs (gravity/drag/decay).
5. **AC-F4-extended:** 5 distinct shader signatures, pairwise pixel-diff ≥20% at frame 5; bloom + paper-texture toggleable; per-element particle trajectories distinguishable.
6. Settings panel adds: `graphics: { bloom, paperTexture, perElementShaders, particleQuality }`.
7. **Promote M7b non-optional in v0.2.** Currently reads "can slip without breaking AC-F4" — add: "M7b ships in v0.2; only M9 is best-effort. The risk-split exists to derisk AC-F4, not to permit graphics deferral."
8. Soften §6 Risk 6: user authorised graphics investment.

## 4. New architectural concerns

- **Multiplex conflict precedence (Groq vs SambaNova on disagreeing `guess.glyphId`):** Add to M2 — "deep `guess` overrides fast `guess` on arrival; overlay re-renders."
- **M0 stroke format vs M7a perfect-freehand:** Add to M0 INDEX.json — `strokeFormat: 'raw-points-v1'` version field.
- **CSP gap in M1:** Commit placeholder `default-src 'self'` CSP in M1, upgrade to full in M2.

Parallel-double-request race / Worker normaliser overhead / AST↔DSL hot path concerns all checked — low risk.

## 5. Verdict — APPROVE_WITH_SYNTHESIS

5 bounded iter-2 additions, all centered on graphics mandate:

1. Expand M7b scope with per-element shaders, bloom pass, paper texture, particle physics (§3 items 1-5)
2. Promote M7b non-optional in v0.2 with explicit ADR sentence
3. Multiplex conflict precedence in M2
4. Version M0 stroke format
5. Placeholder CSP in M1

Do not reopen settled items.
