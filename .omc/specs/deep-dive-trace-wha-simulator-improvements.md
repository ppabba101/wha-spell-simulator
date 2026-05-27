# Deep Dive Trace: WHA Simulator Improvements

## Observed Result / Problem Statement
The Witch Hat Atelier Spell Simulator works but feels brittle: a raster template matcher with hand-tuned thresholds covers only 5 sigils + 3 signs, single rings only, no canonical mechanics for line cleanliness/length, no LLM-judge, and Canvas 2D effects that don't match the WHA aesthetic. User wants robustness, richer canon coverage, LLM-as-judge (especially fast streaming via SambaNova Maverick), and ideas from "Thinking with Visual Primitives."

## Ranked Hypotheses (Improvement Opportunities)

| Rank | Hypothesis | Confidence | Evidence Strength | Why it leads |
|------|------------|------------|-------------------|--------------|
| 1 | Define a **WHA primitive DSL** (Ring/Line/Arc/Dot/Symmetry) and route both template matcher + LLM judge through it | High | Strong — Visual Primitives paper + WHA glyph structure both literally are primitive compositions | Solves nested rings, rotation/scale invariance, explainability, AND enables a "polish my sigil" renderer in one architectural move |
| 2 | **Streaming Llama 4 Maverick on SambaNova/Groq** as continuous-judge (live feedback while drawing) | High | Strong — 643 tok/s output, OpenAI-compatible, vision-native, ~$0.01/spell | The UX unlock — canvas *responds* in real time, not post-hoc. TTFT > raw cost for interactive feel |
| 3 | **Expand canon coverage**: nested rings + ~20 unimplemented signs + prepared/active gap closure + sign-flip = reverse + line quality as explicit power modifier | High | Strong — Lane 2 found every one of these is unambiguously canonical | These are the actual missing features; biggest delta vs. canon |
| 4 | **Graphics overhaul**: perfect-freehand strokes + PixiJS effect stage + tsParticles + sumi-e ink-wash shader + glow-on-closure | High | Strong — concrete library set, none speculative | Aesthetic alignment with WHA manga look |
| 5 | **Robustness layer**: Hough/RANSAC pre-pass, golden-image tests, recognition benchmark suite, judge-regression fixtures, property-based parser tests | Medium-High | Moderate — Lane 1 found 0% coverage on the 368-LOC template matcher | Reliability before features; current thresholds are eyeballed magic numbers |

## Evidence Summary by Hypothesis

- **H1 (Primitive DSL):** Lane 4 confirmed DeepSeek's *Thinking with Visual Primitives* shows that elevating geometric primitives to first-class CoT tokens closes the "reference gap" on counting/spatial tasks. WHA glyphs are *literally* primitive compositions inside bounded rings — this is the highest-leverage architectural change. Same DSL serves: LLM judge output schema, canonical glyph storage, symbolic set-diff matching, polish-renderer, nested-ring composition.
- **H2 (Streaming SambaNova judge):** Lane 4 confirmed Llama 4 Maverick on SambaNova has vision, 64K context, $0.63/$1.80 per MTok, 643 tok/s output. Groq actually beats it on TTFT (~180ms). Latency, not cost, is the differentiator. ~$0.01 per 30s spell with diff-gating.
- **H3 (Canon expansion):** Lane 2 documented ~20 unimplemented signs (Dispersion, Pull, Crush, Direction, Diamond, Window, Collection, Bolt, Billowing, Rain, Bird, Repetition, Vision, Weave, Enlarge/Reduce, Eye/Bend, Crosshair, Radial) and 3 missing sigil variants (Wind-Underfoot, Aeriform, Crystal). Nested rings are explicitly canonical: "wrap a spell inside another ring and fill the gap between them." Prepared-spell gap closure is canonical. Sign-flip = effect-reverse is canonical. Line quality is canonical: "neatly drawn seals last longer than messy ones."
- **H4 (Graphics):** Lane 3 produced a concrete stack: Canvas 2D for input → perfect-freehand for stroke polys → PixiJS for effect stage → tsParticles for sparks → single GLSL ink-wash post-process. Matches WHA aesthetic without 3D.
- **H5 (Robustness):** Lane 1 found 0% test coverage on the 368-LOC template matcher; 40+ magic numbers with no sensitivity analysis; silent dictionary-load failure; ring fitting has no condition checks; nested-rings detected but rejected (`ringDetector.js:534-542` — stubbed).

## Evidence Against / Missing Evidence

- **H1:** Risk of over-engineering — a small vocabulary may not actually need a full DSL. Mitigation: start with judge output schema only; canonical-glyph rewrite is Phase 2.
- **H2:** CORS blocks browser-direct calls on SambaNova (unlike Anthropic); proxy is mandatory. 20 RPM free tier kills demos — need Developer tier. Vision quality below frontier (Sonnet 4.6 / Gemini 3.5).
- **H3:** Scope risk — 20+ signs is a lot of template authoring. Mitigation: prioritize 5–7 highest-canon signs (Dispersion, Direction, Window, Diamond, Repetition, Enlarge/Reduce, Bolt).
- **H4:** Adds dependencies (PixiJS, tsParticles, perfect-freehand). Bundle-size and complexity cost. Mitigation: lazy-load effect stage; keep recognition layer dep-free.
- **H5:** Pure robustness work doesn't ship visible features. User explicitly asked for *more* features. Mitigation: bundle test-corpus work *with* the canon expansion so each new sign ships with fixtures.

## Per-Lane Critical Unknowns

- **Lane 1 (Codebase audit):** What's the **migration appetite**? Big-bang rewrite of recognizer to DSL-based, or incremental layering where LLM judge sits beside the existing template matcher and only the *judge output* uses DSL?
- **Lane 2 (Canon coverage):** Which **slice of canon** matters most to ship first? Sign vocabulary expansion, nested rings, or quality modifiers? They're independent and roughly equal effort.
- **Lane 3 (LLM tooling):** What's the **deployment posture**? Static gh-pages with Worker proxy (current), self-hosted, or "user supplies their own key"? This decides whether SambaNova or Anthropic or local SmolVLM is the default.
- **Lane 4 (SambaNova + Primitives):** Is the **continuous streaming judge** the headline UX, or is one-shot post-draw judging sufficient? They have very different architectures and cost profiles.

## Rebuttal Round

**Best rebuttal to leading hypothesis (DSL-first):** *"This is over-engineering for a fan project — just slap an LLM call on the canvas and call it done."* Why it fails: without a DSL, every model upgrade or provider swap breaks the output schema; the canonical-glyph library can't be expressed compositionally; nested rings remain unsolvable; and the "polish my sigil" / explainability features evaporate. The DSL is ~4h of work that unlocks 5+ downstream features.

**Why DSL holds:** It's a strict-JSON schema, not a parser. The cost is one file. The upside is structural.

## Convergence / Separation Notes

- H1 (DSL) and H2 (streaming judge) are **complementary, not alternatives** — DSL is the judge's output contract, streaming is the judge's transport.
- H3 (canon) and H4 (graphics) are **independent** of each other and of the judge work. Each new sign needs a template, a renderer effect, and a fixture.
- H5 (robustness) is **the foundation** — without it, every new feature degrades the next.

## Most Likely Recommended Architecture

Hybrid layered system:

```
Input layer:    perfect-freehand strokes on Canvas 2D
                    │
Pre-pass:       Hough + RANSAC primitive detection in JS (5ms)
                    │
Recognition:    Existing template matcher (top-K candidates, free, instant)
                    │
                    ├── If top-1 confident → accept, fire spell
                    └── If ambiguous OR user wants critique →
Judge:                   Streaming SambaNova/Groq Llama 4 Maverick
                         Output: WHA-DSL JSON {primitives[], guess, confidence, critique, hint}
                                   │
Compose:                Compiler: GlyphAST → SpellIR (extended for nested rings + sign-flip + quality)
                                   │
Render:                 PixiJS effect stage + tsParticles + sumi-e shader + glow-on-closure
```

## Critical Unknown (synthesized)

**The single most important unresolved question: what is the *first vertical slice* the user wants?** All four lanes converge here. Options are radically different in scope:

- (a) Streaming LLM judge as a *standalone new feature* alongside existing matcher — fastest demo, no canon expansion
- (b) Nested-rings + 5 new signs + line-quality power modifier — biggest canon delta, no LLM
- (c) Full hybrid pipeline rewrite around DSL — highest ceiling, longest path
- (d) Graphics-first overhaul (perfect-freehand + PixiJS) — biggest visual impact per hour

## Recommended Discriminating Probe

Ask the user to **rank scope vs. ambition for v0.2** between four concrete sprint slices: streaming-judge MVP, canon-expansion sprint, DSL-foundation refactor, or graphics-aesthetic overhaul. The answer determines the spec's center of gravity. All four can ship eventually; the question is order.

---

**Artifacts:**
- Lane 1: `.omc/specs/lane1-codebase-audit.md`
- Lane 2: `.omc/specs/lane2-wha-canon.md`
- Lane 3: `.omc/specs/lane3-tooling-llm-judge.md`
- Lane 4: `.omc/specs/lane4-sambanova-and-visual-primitives.md`
