# Critic Evaluation — RALPLAN-WHA-v0.2 (Iteration 3, convergence pass)

**Reviewer:** Critic agent
**Mode:** DELIBERATE consensus (iter 3 of max 5)
**Verdict:** **APPROVE_WITH_RESERVATIONS** → effectively **APPROVE** (reservations are non-blocking; routed as Open Questions for the executor, not as further planner iteration)

---

## 1. Architect iter-2 5-item additions — absorbed?

| # | Architect ask | Plan location | Status |
|---|---|---|---|
| a | M7b scope: per-element shaders + bloom + paper texture + particle physics | §4 M7b "Files to create" lines 311–318; iter-3 changelog line 516 | **Absorbed.** All 5 element `.frag` files + `bloomPass.js` + `paperTexture.js` + `particlePhysics.js` listed explicitly. |
| b | M7b promoted non-optional in v0.2 | §4 M7b lead paragraph line 305; §8 ADR Consequences line 478 | **Absorbed.** Verbatim sentence: *"M7b ships in v0.2; only M9 is best-effort. The risk-split exists to derisk AC-F4 ... not to permit graphics deferral."* |
| c | Multiplex conflict precedence in M2 | §4 M2 `streamingJudge.js` bullet line 159 | **Absorbed.** *"deep `guess` overrides fast `guess` on arrival; overlay re-renders, side-panel updates, and a `judge.guessRevised` event fires."* |
| d | M0 stroke format versioned | §4 M0 INDEX.json line 94; stroke-format note line 97 | **Absorbed.** `strokeFormat: 'raw-points-v1'` in INDEX schema; M7a constrained to preserve raw capture. |
| e | Placeholder CSP in M1 | §4 M1 `index.html` mod line 133 | **Absorbed.** Concrete CSP string committed in M1; M2 only widens `connect-src`. |

All 5 absorbed cleanly. No subtle misreadings.

## 2. Critic iter-1 8 changes — still present?

- M0 corpus (≥3 drawers, 70/30 stratified) — line 99 ✓
- AC-P2 relaxed (<500/<1000 p50/p95, two regions) — line 22, 174 ✓
- M8a observability + alert thresholds — §4 M8a lines 360–376, §6 Risk 10 ✓
- M7 split into M7a/M7b — §4 M7a line 280, M7b line 302 ✓
- AC-F3/F4 distinctness — line 272 (≥15% pairwise), line 294 (≥30% silver histogram) ✓
- Pre-mortem E (fixture bias) — §7 line 452 ✓
- XSS/CSP threat-model — §8 line 484, Risk 9 line 437 ✓
- Adopt Architect revisions — see §1 above ✓

All 8 still in place. Iter-3 surgery was additive only; nothing regressed.

## 3. New iter-3 risk surface — pressure-tested

**a) 5 GLSL shaders on M-series headless Chromium — compile-failure risk.**
Real concern. Headless Chromium on Apple Silicon uses SwiftShader by default unless `--enable-gpu` is passed; complex fragment shaders (curl noise, fbm) can fail to compile or fall back to software-render with massive frame-time penalties that break the `animations: 'allow'` timing budgets. The plan does not explicitly require a shader-compile fallback path. **Severity: MAJOR**, but bounded — `glowOnClosure.js` in M7a is already the Canvas-2D safety net for AC-F4, and Risk 7 already mentions `webgl: 'on'` + retries. Realist check: detection is fast (Playwright fails loudly), fix is per-shader (drop to `precision mediump`, simpler noise function). → Park as Open Question; executor must add a per-shader try/compile guard that falls back to flat element-tinted fill if `gl.LINK_STATUS === false`.

**b) AC-F4-extended pairwise ≥20% pixel-diff across 5 elements — achievable?**
The 5 elements all render on a dark canvas with the same glyph silhouette underneath. With bloom on, all five could converge toward similar high-luminance halos and fail pairwise ≥20% at frame 5. Pinning the assertion to *frame 5 of effect playback* (early — particle systems still anisotropic) and the strong palette differences (red/orange vs blue/cyan vs white/gold vs brown/ochre vs translucent-white) make 20% plausible but not guaranteed. **Severity: MINOR concern.** Mitigation: executor should run the diff matrix in M7b dev before locking the threshold; if 20% proves unachievable, the planner-approved fallback is to assert per-element vs *baseline neutral* ≥20% (5 assertions) instead of pairwise (10 assertions). Document in Open Questions.

**c) Trajectory-hash assertion on particle systems — flakiness.**
Particle physics with curl-noise advection is **inherently nondeterministic** unless seeded. The plan does not state a fixed RNG seed for particle emission. **Severity: MAJOR.** If `Math.random()` drives emission jitter, the trajectory-hash assertion is guaranteed to flake. Realist check: this is detected immediately on first CI run, and fix is one line (seed the emitter PRNG). → Park as Open Question requiring executor to (i) seed `particlePhysics.js` emitter PRNG from a Playwright-injected fixed seed, (ii) hash trajectories at integer frame numbers only, (iii) accept hashes within Hamming distance ≤2 rather than strict equality.

**d) Bloom / paperTexture toggles — stage re-mount risk.**
Plan line 323 explicitly states: *"each toggle hot-swaps the corresponding Pixi filter/emitter without re-mounting the stage."* This contract is stated but not test-asserted. **Severity: MINOR.** Add an Open Question: M7b test plan should include `pixi.app.renderer` instance-identity assertion before/after each toggle.

None of (a)–(d) is a planner-iteration blocker. All are executor-phase concerns with clear remediation paths and fast detection. Realist Check supports keeping these as Open Questions rather than forcing iter 4.

## 4. Graphics ambition test — does §M7b satisfy the user mandate?

Reading §M7b as a sceptical user: nine new files (5 element shaders + bloom + paper texture + particle physics + Pixi stage), explicit per-element artistic direction (fire-flicker curl noise / water caustic / wind volumetric / earth dust-cluster / light radial bloom), four user-facing graphics quality controls in settings, pairwise-distinctness AC at the visual layer, particle-trajectory hash AC at the motion layer, and bloom-toggle + paper-texture-toggle deltas as separate ACs.

This reads as **considerable** effort, not a checkbox. The §8 ADR Consequences line 478 directly states M7b is in-scope for v0.2 ship — the demotion-to-stretch escape hatch is closed. The user mandate is honoured.

## 5. Final verdict — APPROVE

Plan is ready for autopilot. The remaining concerns are executor-phase quality gates, not planner-phase gaps. Forcing iter 4 would yield diminishing returns and burn a planner cycle on issues better resolved against running code.

**Open Questions (executor must address — non-blocking on planner):**
1. Per-shader GLSL compile-fallback (Canvas-2D tinted-fill on link failure).
2. Pairwise-vs-baseline diff fallback for AC-F4-extended if pairwise ≥20% proves over-tight in M7b dev.
3. PRNG seeding for `particlePhysics.js` to make trajectory-hash assertions deterministic.
4. `pixi.app.renderer` instance-identity assertion across bloom/paperTexture toggles.

**Realist-Check recalibrations applied:**
- Shader compile risk downgraded from CRITICAL to MAJOR-as-OpenQuestion (mitigated by: M7a Canvas-2D safety net for AC-F4, fast Playwright detection, simple per-shader fallback).
- Trajectory-hash flakiness downgraded from CRITICAL to MAJOR-as-OpenQuestion (mitigated by: one-line PRNG seed fix, immediate CI detection).

**Adversarial-mode escalation:** Not triggered. Zero CRITICAL findings post-Realist-Check; only 2 MAJOR findings, both with clear executor-phase remediation.

---

## Final ADR delta (iter 3 vs iter 2)

Iter 3 absorbs the Architect iter-2 5-item synthesis and honours the user's mid-loop graphics mandate via additive scope expansion only. M7b grows from a thin "PixiJS stage + sumi-e shader" stub into a full graphics milestone with 5 per-element fragment shaders (fire/water/wind/earth/light), an `AdvancedBloomFilter` bloom pass, slow-scroll fbm paper-texture substrate, and per-element particle physics (gravity for earth/water, wind-field drag for wind/fire, light-decay curves for light/fire). M7b is now in-scope for v0.2 ship (only M9 remains stretch); §8 ADR Consequences and §6 Risk 6 are updated accordingly. Four user-facing graphics controls (`bloom`, `paperTexture`, `perElementShaders`, `particleQuality`) join the M3 settings panel. AC-F4-extended adds pairwise pixel-diff ≥20% at frame 5 across the 5 elements, bloom/paper-texture toggle-delta ≥10%, and per-element particle-trajectory hash distinctness. The M2 multiplex contract is sharpened with explicit fast→deep `guess` override precedence and a `judge.guessRevised` event. M0 INDEX.json gains a `strokeFormat: 'raw-points-v1'` version field, and M7a is bound to preserve raw-points capture. A placeholder CSP (`default-src 'self'`) lands in M1 so the security baseline precedes provider code in M2. No iter-1/iter-2 decisions reopened. Plan converges.

---

*Ralplan summary row:*
- Principle/Option Consistency: **Pass** — Principle 1 (DSL contract) preserved through M7b additions; Principle 3 (headless Playwright) extended into shader-level ACs.
- Alternatives Depth: **Pass** — Iter 3 was additive synthesis, not a new alternative set; prior Option-set work (A–E) remains intact.
- Risk/Verification Rigor: **Pass-with-OpenQuestions** — 4 executor-phase risks parked but documented with concrete remediation paths.
- Deliberate Additions: **Pass** — Pre-mortem (5 scenarios including E) intact; expanded test plan covers unit + property + AST↔DSL round-trip + Playwright golden + colour-histogram + pairwise-distinctness + trajectory-hash + observability synthetic.
