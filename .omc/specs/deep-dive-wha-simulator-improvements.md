# Deep Dive Spec: WHA Spell Simulator v0.2 ("The Big One")

**Status:** Ready for execution
**Source:** /oh-my-claudecode:deep-dive
**Ambiguity:** ~12% (below 20% threshold)
**Trace artifacts:**
- `.omc/specs/deep-dive-trace-wha-simulator-improvements.md` (synthesis)
- `.omc/specs/lane1-codebase-audit.md` (current implementation)
- `.omc/specs/lane2-wha-canon.md` (Witch Hat Atelier magic system canon)
- `.omc/specs/lane3-tooling-llm-judge.md` (LLM/graphics/testing options)
- `.omc/specs/lane4-sambanova-and-visual-primitives.md` (SambaNova streaming + Visual Primitives paper)

---

## Goal

Transform the WHA Spell Simulator from a single-ring template-matcher demo into a **canon-faithful, LLM-augmented spell drawing instrument** with:

1. A **continuous streaming LLM judge** (Llama 4 Maverick on SambaNova primary / Groq fallback) that critiques the drawing live as the user is still moving the pen, outputting structured **WHA-DSL primitives** (Ring, Line, Arc, Dot, Symmetry) inspired by DeepSeek's *Thinking with Visual Primitives*.
2. **Canon-faithful mechanics** previously stubbed or absent: nested rings ("circles in circles"), prepared-vs-active spells with gap-closure, sign-flip = effect-reverse, ~5–7 new signs, explicit line-cleanliness + line-length as power modifiers.
3. **Graphics overhaul** matching the manga's sumi-e aesthetic: perfect-freehand strokes, PixiJS effect stage, tsParticles, ink-wash post-process shader, glow-on-ring-closure.
4. **Layered judge UX**: spatial primitive overlays on the canvas + streaming reasoning side panel + cursor-tip hint bubbles.
5. **Robustness foundation**: recognition benchmark + golden-image renderer tests + judge-fixture regression suite in CI.
6. **No bundle budget**: full PixiJS + tsParticles + offline SmolVLM lazy-loaded.

The headline UX: as the user draws, ghost primitives glow onto the canvas where the LLM judge "sees" them, the side panel streams the judge's reasoning token-by-token, and when the ring closes the canvas erupts in the WHA silver-glow spell-forming animation.

## Constraints

### Provider & deployment
- **Primary judge:** SambaNova Llama 4 Maverick (`Llama-4-Maverick-17B-128E-Instruct`), vision input, 64K context, OpenAI-compatible REST + SSE. ~643 tok/s output.
- **Fallback judge:** Groq Llama 4 Maverick (TTFT leader at ~180ms). Same prompt, same DSL output contract; settings toggle picks default.
- **Optional escalation:** Anthropic Sonnet 4.6 for explicit "deep review" user action (frontier vision quality on low-confidence cases).
- **Key handling:** Cloudflare Worker proxy holds project keys (rate-limited per IP, no logging). User-key escape hatch in settings (paste own SambaNova/Groq/Anthropic key, stored in `localStorage`).
- **CORS:** SambaNova/Groq require proxy; Anthropic supports `dangerous-direct-browser-access` if user supplies own key.
- **Static deploy preserved:** gh-pages stays static. Worker proxy is the only server-side component.

### Performance
- **End-to-end latency:** < 300ms p50 from `stroke-end` event to first hint token rendered.
- **Streaming cadence:** dHash-gated submissions (Hamming distance ≥ 6) OR stroke-end debounce (150ms after pointer-up) OR idle-tick (every 750ms while drawing) — whichever fires first.
- **In-flight cancellation:** `AbortController` per request; only the latest judgment counts.
- **Bundle:** No hard cap. PixiJS, tsParticles, perfect-freehand all eagerly loaded. Transformers.js + SmolVLM weights lazy-loaded only when offline mode toggled.
- **Recognition accuracy:** Judge identifies primitives at ≥ 90% top-1 on a 50–100 fixture test corpus of clean drawings.

### Architectural
- **Existing template matcher stays:** Fast path remains free + offline. Judge invoked only when template confidence is ambiguous OR user has enabled "always critique" mode.
- **DSL is the contract:** Every judge output, every canonical glyph definition, every nested-ring composition goes through the WHA-DSL JSON schema. Output drift across model versions is prevented by strict JSON tool calls.
- **Layered judge UX = three toggleable surfaces:** inline canvas overlay, streaming side panel, cursor-tip bubbles. All three render the same DSL stream; each can be hidden.
- **No `--no-verify`:** Pre-commit + CI hooks remain enforced.

### Testing & QA — MANDATORY
- **Playwright runs HEADLESS at all times.** No window pop-ups during dev or CI. Use `chromium.launch({ headless: true })` everywhere. Visual diffing uses `toHaveScreenshot()` with stable rendering; no headed runs unless explicitly invoked via a separate `npm run test:e2e:headed` debug command (not the default).
- **Thorough UI debugging via Playwright is REQUIRED for every feature shipped in v0.2.** Each new UI surface (judge overlay, side panel, cursor bubbles, dictionary editor, spell replay, gallery) gets:
  - A golden-image screenshot baseline (`tests/golden/<feature>-{state}.png`).
  - Interaction tests covering golden path + 2 edge cases.
  - Console-error assertions: no unexpected `console.error` / `console.warn` during the test run.
  - Network-request assertions: judge calls go to the proxy, not directly to providers; expected payloads logged.
  - Animation-frame stability: tests run with `animations: 'disabled'` for screenshot diff; a separate timed test verifies the glow-on-closure animation duration is within spec.
- **CI runs Playwright headless on every PR.** Failures block merge.
- **Visual regression tolerance:** 0.1% pixel diff threshold; diffs surfaced as CI artifacts.

### Non-goals
**Explicitly NONE — everything stays in scope.** The user confirmed all four candidate cut features remain in v0.2:
- Offline SmolVLM/transformers.js fallback is IN scope (lazy-loaded WebGPU path).
- Public spell gallery / sharing is IN scope (R2 + Worker share endpoint).
- Dictionary editor UI for community contributions is IN scope.
- Spell replay / stroke playback is IN scope.

(Quality bar: each of these must integrate cleanly with the DSL. If integration would compromise the DSL contract, the integration design escalates to a critic review before implementation.)

## Acceptance Criteria

### Performance + accuracy (all required)
1. **AC-P1** Judge identifies primitives ≥ 90% top-1 on the fixture corpus (50–100 hand-drawn clean fixtures across the supported glyph set).
2. **AC-P2** End-to-end latency < 300ms p50 from `stroke-end` to first hint token rendered, measured in production-equivalent network conditions (Cloudflare Worker → SambaNova).
3. **AC-P3** Recognition-accuracy benchmark + golden-image renderer tests + judge-fixture regression tests run in CI on every PR; CI fails on regression.

### Feature milestones (all required)
4. **AC-F1** Nested rings work end-to-end: user can draw concentric rings, ring detector accepts them (not rejects), GlyphAST represents nested topology, compiler composes inner-element + annular-modifiers per the convention (inner sigil = element, annular signs = modifiers, outer ring = activation gate), renderer animates the composed effect.
5. **AC-F2** Line cleanliness + line length explicitly feed spell power:
   - Cleanliness score (smoothness, stroke continuity, closure precision, symmetry) exposed in `SpellIR`.
   - Length score (total ink length normalized to ring radius) exposed in `SpellIR`.
   - Both visible in the UI's Spell Quality panel.
   - Judge prompt requires the judge to report on both in its critique.
6. **AC-F3** 5+ new signs shipped as complete vertical slices (template + dictionary entry + judge prompt few-shot + animation):
   - **Dispersion** (spread/pour) · **Direction** (vector control) · **Window** (on-surface limiter) · **Diamond** (nearby-objects limiter) · **Repetition** (rewind/restore) · (Stretch: **Bolt**, **Enlarge/Reduce** pair).
7. **AC-F4** Glow-on-ring-closure animation: at the moment the ring closes, the ink briefly flashes silver-pale, radial sparks burst, the spell-effect materializes upward from the sigil, contained by the ring. Prepared-vs-active visual distinction: prepared spells render inert/dim until the closing dot is added.
8. **AC-F5** Streaming WHA-DSL judge end-to-end: stroke → diff-gated submission → SSE stream → progressive JSON parse → three UX surfaces render simultaneously. SambaNova primary, Groq fallback toggle works.
9. **AC-F6** Sign-flip = effect-reverse: flipping the orientation of a sign in the drawing inverts its effect (Enlarge↔Reduce, Wall-Breaker↔Integration, etc.) per canon. Visible in the IR.
10. **AC-F7** Prepared-spell gap closure UX: user can leave the ring open, save the prepared glyph, then "fire" it by adding the closing dot. Engine treats them identically once closed.
11. **AC-F8** Cloudflare Worker proxy live, project keys held server-side, rate-limited per IP, no logging of drawing payloads. User-key escape hatch in settings panel stores keys in `localStorage`.

### Stretch (best-effort, not blocking ship)
12. **AC-S1** Offline SmolVLM / transformers.js WebGPU judge as opt-in toggle. Same DSL schema. Works on M-series MacBooks with WebGPU.
13. **AC-S2** Public spell gallery: share button generates a `?spell=<base64-SpellIR>` URL; gallery page lists user-submitted spells via Worker + R2.
14. **AC-S3** In-app dictionary editor: CRUD over `sigils.json`/`signs.json`, import/export JSON.
15. **AC-S4** Spell replay: button re-animates the user's exact stroke sequence + judge critique side-by-side with the resulting spell effect.

## Assumptions Exposed

1. **The 5 prioritized new signs** (Dispersion, Direction, Window, Diamond, Repetition) are reasonable based on Lane 2's canon research and the existing Column/Levitation/Convergence trio. If the user disagrees, swap order in implementation.
2. **Nested-ring convention** — inner sigil supplies the element, annular signs modify, outer ring is the activation gate. Canon shows this but doesn't formalize; this is the simulator's adopted convention.
3. **Line cleanliness formula** — combination of stroke smoothness (curvature variance), continuity (pen-lift count), closure precision (ring join-point gap distance), and symmetry (keystone radial-angle balance). Initial weights from Lane 1's existing neatness chain; tuned via the fixture corpus.
4. **Line length → power** — total ink length normalized to ring radius. Multiplicative on base spell power. Capped (otherwise users will draw infinite spirals).
5. **Latency budget breakdown:** ~80ms for proxy round-trip, ~180ms TTFT on SambaNova, ~40ms for image encode/diff — fits under 300ms p50 with headroom.
6. **Judge accuracy on closed set** is much higher than open-set; Llama 4 Maverick vision should handle 5 sigils + ~10 signs + nested rings without trouble.
7. **User-supplied keys** are trusted: stored in `localStorage`, never sent to anywhere except the chosen provider. Documented in the settings panel.

## Technical Context

### Architecture (v0.2 target)
```
Input layer:
  Pointer events → perfect-freehand polylines → Canvas 2D ink layer

Pre-pass (in-browser, free, <5ms):
  Hough transform → circle/line candidates
  RANSAC → ring fit
  Existing stroke grouper + cleaner

Recognition:
  Existing template matcher → topK=3 with confidences
  ├── confident: skip judge, accept top-1
  └── ambiguous OR "always critique" mode:
        Streaming judge invoked

Judge (streaming, optional):
  Throttler: dHash diff-gate + stroke-end debounce + idle-tick
  AbortController: cancel in-flight on new submission
  POST to Cloudflare Worker proxy
    → SambaNova (or Groq, or Anthropic) Llama 4 Maverick
    → SSE stream of WHA-DSL JSON
  Progressive JSON parse → emit events

UX surfaces (three, all driven from same DSL stream):
  ├── Inline canvas overlay: ghost primitives glow where judge sees them
  ├── Streaming side panel: token-by-token reasoning render
  └── Cursor-tip bubbles: urgent hints near pointer

Compose:
  GlyphAST (extended: nested rings, sign orientation, quality metrics)
  → SpellIR (extended: line cleanliness, length, power formula, prepared state)

Render:
  Glyph layer:  Canvas 2D ink (perfect-freehand outlines, sumi-e wash filter)
  Effect layer: PixiJS stage + tsParticles + glow-on-closure shader
  Post-process: lightweight WebGL ink-wash composite

Robustness:
  Recognition-accuracy benchmark (npm run bench:recognize)
  Golden-image renderer tests (Playwright + toHaveScreenshot)
  Judge-fixture regression tests (fixed prompt + fixed images → expected JSON, pinned per model version)
  Property-based parser tests (fast-check)
```

### New modules
- `src/parser/llmJudge/streamingJudge.js` — orchestrator, throttler, AbortController
- `src/parser/llmJudge/dsl.js` — WHA-DSL JSON schema + validators
- `src/parser/llmJudge/prompts.js` — system prompt, few-shot anchors, tool definition
- `src/parser/llmJudge/providers/sambanova.js` — SambaNova SSE client
- `src/parser/llmJudge/providers/groq.js` — Groq SSE client
- `src/parser/llmJudge/providers/anthropic.js` — Anthropic streaming client (deep-review escalation)
- `src/parser/llmJudge/providers/smolvlm.js` — transformers.js + WebGPU offline path
- `src/parser/preprocess/hough.js` — Hough + RANSAC primitive detector
- `src/renderer/effectsPixi/` — PixiJS effect stage (one file per element, plus glow + closure animation)
- `src/renderer/effectsPixi/inkWashFilter.js` — sumi-e post-process shader
- `src/ui/judgeOverlay.js` — inline canvas overlay surface
- `src/ui/judgePanel.js` — streaming side panel
- `src/ui/judgeHintBubbles.js` — cursor-tip bubbles
- `src/ui/dictionaryEditor/` — CRUD over sigils/signs (stretch)
- `src/ui/spellReplay/` — stroke playback (stretch)
- `src/ui/spellGallery/` — share + gallery (stretch)
- `worker/wha-llm-proxy/` — Cloudflare Worker source
- `tests/fixtures/glyphs/` — labelled fixture corpus
- `tests/judge-fixtures/` — pinned-prompt judge regression
- `tests/golden/` — renderer screenshot baselines

### Extended data structures
- **`GlyphAST`** gains: `rings: Ring[]` (replaces single `ring`), `signOrientation` per sign (flip = reverse), `qualityMetrics: { cleanliness, length, closurePrecision, symmetry }`, `prepared: boolean`.
- **`SpellIR`** gains: `compositionMode: "single" | "nested" | "linked"`, `linkedSeals: SealRef[]`, `power: Number` (derived from quality), `duration: Number` (derived from quality), `preparedGapPosition: Point | null`.
- **`WHA-DSL` (judge output)**: strict JSON tool schema with `primitives[]` (each `{type, params}`), `guess: { glyphId, confidence }`, `alternatives[]`, `critique: { closure, cleanliness, continuity, recognizability, score: 1..5 }`, `errors[]`, `hint: string`.

## Ontology

| Term | Meaning in this spec |
|------|---------------------|
| **Sigil** | Central element selector (fire / water / wind / earth / light / + variants) |
| **Sign / Keystone** | Modifier symbol placed around the sigil; flippable for inverse effect |
| **Ring** | The enclosing circle; activation gate |
| **Nested rings** | Two or more concentric rings; inner = element, annular = modifiers, outer = activation gate |
| **Prepared spell** | Glyph drawn with ring left open; dormant until closing dot added |
| **Active spell** | Glyph drawn with ring closed in the moment |
| **WHA-DSL** | The JSON primitive vocabulary the judge outputs: Ring, Line, Arc, Dot, Symmetry |
| **Judge** | LLM that interprets the drawing into DSL primitives + critique; streams as user draws |
| **Quality** | Composite of cleanliness, length, closure precision, symmetry → multiplier on spell power and duration |
| **Glow-on-closure** | Canonical visual moment: ring closes → silver flash → spell forms |

## Ontology Convergence

Stable across all 5 interview rounds. No term drift detected. The DSL primitive vocabulary (Ring/Line/Arc/Dot/Symmetry) is intentionally a subset of the canon glyph vocabulary — it's the building-block layer below glyphs, not a replacement for them.

## Trace Findings

### Lane 1 (Codebase audit) — top relevant findings
- Recognition is **raster-template-based with 8 rotations**, NOT Hu moments / DTW (a misconception worth correcting in any future doc).
- Confidence blending: ink (0.68) + structural (0.13) + layer (0.10) + size (0.04) + neatness (0.05); floor 0.48; ambiguity gap 0.065.
- **`ringDetector.js:534–542` already detects nested rings but rejects them** — the lift to support them is in the compiler and renderer, not the detector.
- 0% test coverage on the 368-LOC template matcher core. The benchmark+fixture requirement (AC-P3) directly addresses this.
- 40+ magic numbers tuned by eye, no sensitivity analysis.
- Tools directory already includes a stroke template maker; reuse as the kernel of the dictionary editor (stretch).

### Lane 2 (WHA canon) — top relevant findings
- Spell anatomy is **{Sigil + Signs + Ring}**, ring activates on closure.
- **Nested rings are unambiguously canonical:** "wrap a spell inside another ring and fill the gap between them with a second spell" (Fandom Magic page).
- **Sign-flip = effect-reverse:** Enlarge↔Reduce, Wall-Breaker↔Integration.
- **Line quality is canonical:** "neatly drawn seals last longer than messy ones"; curved/wobbly lines push/pull "just like you drew it"; missing keystones produce shapeless or biased output.
- The 5 prioritized new signs (Dispersion, Direction, Window, Diamond, Repetition) are all well-documented with chapter citations.
- Forbidden magic (Body magic, transformation, illusion) is out of scope but worth a future failure-state easter egg.

### Lane 3 (Tooling + LLM judge) — top relevant findings
- Recommended architecture is **hybrid template-top-K + LLM-validator**, NOT pure-vision LLM — preserves the project's existing fast offline path.
- **Closed-set classification** dramatically outperforms open-set; never ask "what spell is this?", ask "of {fire, water, wind, earth, light}, which is this?".
- **Strict JSON schema via tool calls** prevents output drift across model upgrades.
- **Cloudflare Worker proxy** is the right pattern for a static gh-pages Vite build.
- PixiJS + tsParticles + perfect-freehand + sumi-e shader is the matched-aesthetic stack.

### Lane 4 (SambaNova + Visual Primitives) — top relevant findings
- **SambaNova Llama 4 Maverick** has vision (2 images/req), 64K context, $0.63/$1.80 per MTok, ~643 tok/s output, OpenAI-compatible.
- **Groq beats SambaNova on TTFT** (~180ms vs ~900ms). For continuous critique, TTFT > throughput → A/B both.
- **No CORS** on SambaNova/Groq — proxy mandatory.
- **DeepSeek Thinking with Visual Primitives** (briefly published, retracted; gray literature) elevates geometric primitives to first-class CoT tokens. Their `<ref><box>` primitives are coordinate-anchored references inside text reasoning, solving the "reference gap."
- **The transfer to WHA:** WHA glyphs *are* literal primitive compositions. Define a WHA-DSL with Ring/Line/Arc/Dot/Symmetry, force the LLM's output through it as a strict JSON tool. Same idea, vocabulary fitted to sketches not photos.
- **Highest-leverage architectural move:** DSL becomes the universal contract — judge output, canonical glyph storage, nested-ring composition rules, polish-renderer all hang off it.

## Critical Unknown — Resolved

Resolved across the interview: **streaming LLM-judge as the headline**, full scope (judge + DSL + nested rings + line quality + 5 signs + glow + everything else), SambaNova primary / Groq fallback, Worker proxy + user-key escape hatch, three-layered UX, no bundle budget, no non-goals. Spec is comprehensive enough to begin planning and execution.

## Interview Transcript (condensed)

- **Round 1 (Goal):** "Streaming LLM-judge headline (Recommended)" → v0.2 center of gravity is the live-critique judge.
- **Round 2 (Scope):** "Judge + DSL + nested rings + line quality + 5 new signs + glow animation" → maximum supporting scope, full headline release.
- **Round 3 (Provider + key handling):** "SambaNova Maverick primary + Groq fallback" + "Cloudflare Worker proxy + user-key escape hatch."
- **Round 4 (UX):** "All three layered (Recommended++)" — inline overlay + side panel + cursor bubbles.
- **Round 5a (Perf criteria):** All four selected — accuracy, latency, CI tests, AND bundle <1MB.
- **Round 5b (Feature criteria):** All four selected — nested rings + line quality + 5 signs + glow.
- **Round 6 (Graphics + non-goals):** "Full PixiJS + tsParticles, drop the 1MB budget"; non-goals: **none** — every candidate cut feature stays in scope.

---

## Recommended Execution Pipeline

The spec is large enough that planning + critique value is high. Recommended:

1. **`/omc-plan --consensus --direct`** with this spec → Planner + Architect + Critic produce a consensus plan in `.omc/plans/`.
2. **`/autopilot`** invoked on the consensus plan → Phase 2 (Execution) onwards.

Alternative (more autonomous):
- **`/ralph`** with this spec as task definition → persistence loop until all acceptance criteria pass.

Or for fastest parallelism on independent slices:
- **`/team`** with the spec as shared plan → coordinated parallel agents.
