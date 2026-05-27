# Lane 3 — Tooling, Graphics, and LLM-as-Judge Design Research

*Target: WHA Spell Simulator (Vite, vanilla JS, Canvas 2D, local stroke-template matching). Audience: maintainer evaluating LLM-as-judge for glyph interpretation, richer graphics, and broader tooling. Date: 2026-05.*

---

## 1. Where the existing recognizer sits today

Current recognizer (`src/parser/`) is a normalized stroke-template matcher with rotation invariance and topological ring detection — a well-engineered **$P-family-style** pipeline (point-cloud-ish + Procrustes-shape normalization). It is deterministic, offline, free, and ~5 ms per glyph. Its weaknesses are exactly what people complain about in fan demos: a slightly sloppy sigil "feels right" to a human but doesn't pass the cosine-distance cutoff, and "why didn't this work?" has no diagnosable answer.

This is the gap an LLM-as-judge fills — not raw accuracy, but **explainability + grace under sloppy input**.

---

## 2. Five candidate LLM-as-judge architectures

| # | Architecture | Pros | Cons | Best for |
|---|---|---|---|---|
| **A** | **Pure vision**: rasterize canvas → multimodal LLM → JSON `{glyph, confidence, critique}` | Simplest. No coupling to existing matcher. Handles novel/messy input. | Higher latency (1–4 s). Per-call cost. Vocabulary drift across model versions. Needs internet. | Free-form drawing mode, demos |
| **B** | **Hybrid rank-then-validate**: template matcher returns top-K candidates → LLM picks the best and writes critique | Cheapest LLM call (small prompt, few-shot fits). Template matcher stays authoritative for closed set. LLM only resolves ties / low-confidence cases. | Ceiling = whatever template matcher can list as candidates; novel glyphs invisible. | **Default path** — production sigil/sign recognition |
| **C** | **Stroke-aware multimodal**: send rendered PNG **and** normalized stroke JSON (point lists, timing) | LLM sees temporal information matter for direction-of-stroke cues. Better at "did they draw the rune backwards?" | More prompt tokens, more prompt engineering, more places to break. | Pedagogical mode ("how to draw") |
| **D** | **LLM-as-critic only**: template matcher does ID, LLM scores cleanliness / closure / line continuity on a rubric and writes feedback | LLM never has to "know" the spell vocabulary, just judge artistry. Cheap and stable. Can be cached by template ID. | Doesn't help recognition itself; purely a UX layer. | Tutorial / feedback mode |
| **E** | **Local SLM-as-judge** (SmolVLM ~2B / Qwen2.5-VL-3B via transformers.js + WebGPU) | Offline, free at inference, private (fan-project + kids = matters). Plane-friendly. | Accuracy gap vs. frontier. Cold-start download cost (~1–2 GB). Older browsers fail back to slow WASM. | Offline fallback / kiosk |

**Headline recommendation:** ship **B (Hybrid) as the default cloud path**, **D (critic) as a free UX bonus on every recognition**, and **E (SmolVLM) as the privacy/offline fallback** behind a flag.

---

## 3. Multimodal model comparison (2026 pricing, vision-relevant)

All prices are **per million tokens**. Image cost is a function of pixel budget converted to tokens.

| Model | Input $ / MTok | Output $ / MTok | Image budget | Tokens / image (~512px) | $ / 1k judgments (≈1k in / 200 out) | Notes |
|---|---:|---:|---|---:|---:|---|
| **Claude Opus 4.7** | $5 | $25 | 3.75 MP, 2576 px long edge | ~1,500 | $4.50 + $5 = **$9.50** | Top accuracy; 35% tokenizer inflation vs 4.6; vision SOTA |
| **Claude Sonnet 4.6** | $3 | $15 | 1.15 MP recommended | ~1,200 | $2.70 + $3 = **$5.70** | Sweet spot for production |
| **Claude Haiku 4.5** | $1 | $5 | same | ~1,200 | $0.90 + $1 = **$1.90** | Cheap; good for critic |
| **GPT-5** vision | ~$10 | ~$10 | 400K ctx | ~1,200 | **$10–12** | Strong but pricey for this |
| **GPT-5-mini** | ~$0.3 | ~$1.2 | smaller | ~800 | **~$0.50** | Cheapest hosted option |
| **Gemini 2.5 Pro** | $1.25 | $5 | flexible | per-image $0.039 ≈ 1290 tok | **~$2.50** | Decent vision, batch 50% off |
| **Gemini 2.5 Flash** | $0.075 | $0.30 | per image $0.039 | 1290 tok | **~$0.20** | Effectively free; great for critic |
| **Qwen2.5-VL-3B / 7B** (self-host) | infra only | — | — | — | ~$0 marginal | Open-weights, GPU server needed |
| **SmolVLM ~2B** (transformers.js WebGPU) | $0 | $0 | small | — | $0 + bandwidth | Browser-runnable today |

**1,000 judgments/day budget:**
- Sonnet 4.6 as primary judge: **~$170/mo**
- Haiku 4.5 as primary: **~$57/mo**
- Gemini 2.5 Flash as primary: **~$6/mo**
- Gemini 2.5 Flash critic + Sonnet validator on low-confidence 20%: **~$40/mo**

For a fan project the **Gemini Flash + Haiku validator** stack is the obvious cost-leader. For maximum quality, **Sonnet 4.6** is the right primary. Opus 4.7 only earns its keep for *meta*-evaluation (judge-the-judge regression tests), not per-glyph.

---

## 4. Prompt-engineering patterns that work for visual judging

1. **Strict-tool JSON schema** — define an Anthropic tool with `strict: true` (or OpenAI `response_format: json_schema` strict mode). Constrains tokens to schema-valid output. Production receipt-OCR pipelines hit high-90s accuracy this way; the same idea ports cleanly. Required fields: `glyph_id`, `confidence` (0–1), `alternatives[]`, `critique`, `errors[]`, `rotation_deg`.
2. **Rubric-style prompts** — explicit dimensions: *closure*, *cleanliness*, *line continuity*, *recognizability*, *stroke direction*. Each scored 1–5 with an anchor example.
3. **Few-shot with reference glyphs** — include 2–3 reference renderings per candidate sigil (the existing `sigils.json` templates rasterize into perfect few-shot anchors).
4. **Anchored calibration** — current research (Adnan Masood, Apr 2026; SurePrompts 2026) shows judges drift across criteria; pin a known-good "5/5" and a known-bad "1/5" image in the prompt.
5. **Chain-of-thought, but truncated** — let the model think in a `reasoning` field, then commit to `glyph_id` last. With Claude 4.7 extended thinking, set a tight budget (~512 tokens).
6. **Confidence-gated fallback** — `if confidence < 0.6: surface critique to user, do not fire spell`. Same pattern as receipts.
7. **Adversarial pinning** — keep a fixture of "almost-fire-but-actually-just-a-circle" images. Run the prompt against this set in CI; flag regressions across model upgrades.

**Anti-patterns to avoid:** asking the model to *recognize an unknown vocabulary* (don't say "what spell is this?" — say "is this fire, water, wind, earth, light, or none?"). Closed-set classification dramatically outperforms open-set on small symbol vocabularies.

---

## 5. Sketch-recognition prior art worth borrowing

- **$P / $P+ point-cloud recognizer** (Vatavu, Anthony, Wobbrock) — what the current code is approximating. JS reference implementation exists; cheap upgrade if rotation issues persist.
- **$N-Protractor** — fast multistroke, also rotation-invariant.
- **Sketch-RNN / QuickDraw** (Ha & Eck) — 50M sketches, 345 classes; pretrained checkpoints are CC-BY-licensed. Not directly applicable (different vocabulary) but the **vector format** (deltas + pen state) is a useful serialization for prompting LLMs.
- **Sketch-a-Net** — small CNN, good zero-shot baseline.
- **ViSketch-GPT (Mar 2025)** — current SOTA on QuickDraw classification using multi-scale GPT-style transformer; mostly interesting as an aspirational ceiling, not a deployable component.
- **Hu moments + DTW** — classical, still useful for stability heuristics ("is this glyph rotationally ambiguous?").

For a closed vocabulary of ~10–30 symbols, **the existing template matcher + a single LLM critic layer outperforms anything you'd realistically train yourself.** Don't train a sketch CNN; you'll spend three weeks and gain ~3 points of accuracy that the LLM gives you for free.

---

## 6. Better graphics — modern browser options

| Tech | What it buys you | Worth it for WHA? |
|---|---|---|
| **Canvas 2D** (current) | Cheap, debuggable, fine for ~hundreds of particles | Keep as default |
| **WebGL2 / WebGPU raw** | Total control over shaders; access to fluid sims, ink-wash, distance fields | High effort; skip unless one specific effect demands it |
| **PixiJS v8** | WebGL/WebGPU 2D renderer, sprite/particle system, filters (glow, displacement, ripple). Wins canvas-engine benchmarks | **Yes — strongest single upgrade** for spell effects. ~2x more particles than Three.js for 2D |
| **Three.js** | If you ever want pseudo-3D parallax or volumetric fire | Overkill until you go 3D |
| **Konva** | Interactive UI on canvas (drag/select), not effects | Useful for the dictionary editor tool, not for effects |
| **P5.js** | Sketchbook-style API, friendly | Already covered by your effect runtime |
| **SVG + GSAP/Motion-One/anime.js** | Crisp scaleable glyph outlines, ink-stroke animation | **Yes** — use perfect-freehand outlines + GSAP for the "spell forming" animation |
| **perfect-freehand** | Pressure-aware stroke polygons, sumi-e brush feel | **Yes — single highest-ROI input-side upgrade**. ~2 KB, drop-in replacement for `lineTo` |
| **tsParticles** | 320k weekly DLs, mature, declarative config | Yes for fire/light sparks; use over Proton (1.4k DL, less maintained) |
| **WebGL fluid sims** (Pavel Dobryakov, Ghassaei) | Real Navier-Stokes for water/wind — GPU, 60 fps | Worth a 1-day spike for the water spell |
| **Sumi-e shader** (DCtheTall webgl-landscape) | Japanese ink-wash post-processing — vital for WHA aesthetic | **Aesthetic match** — port the wet-on-dry bleed into the final composite pass |
| **Motion-One** | 5× smaller than GSAP, 2.5× faster basic anims | Good for UI; GSAP still wins for choreographed spell sequences |

**Concrete graphics recipe:** Canvas 2D for input → perfect-freehand for stroke polys → PixiJS for the spell-effect stage → tsParticles for sparks/embers → a single GLSL ink-wash post-process pass over the final framebuffer for the WHA look.

---

## 7. Browser ML — the offline story

**SmolVLM (HF) via transformers.js with WebGPU** is the practical 2026 option for in-browser glyph judging. ~2B params, fits in ~1 GB quantized, runs interactively on M-series MacBooks and recent Snapdragons. Florence-2 is *smaller* but is more of a captioning/detection model — less natural for judgment-style tasks.

Recommended packaging:
- Lazy-load the model only when the user toggles **Offline Mode**.
- Cache weights in `Cache Storage` or OPFS (don't rely on HTTP cache).
- Fall back gracefully to WASM if WebGPU absent (Safari iOS still trails).
- Ship a **prompt-compatible** wrapper so the cloud and local judges share fixtures and tests.

For a kid-friendly fan project on a plane: this is *the* feature that differentiates the app.

---

## 8. API-key & deployment patterns for a static Vite site

You cannot put a real API key in client JS. Three workable patterns, in order of practicality:

1. **Cloudflare Worker proxy** (recommended) — 100k req/day free, secret in Worker env, CORS to your gh-pages origin, rate-limit by IP, optional Turnstile to deter scraping. Open-source proxies (`AI-Worker-Proxy-2026`, `ai-proxy-cloudflare`) work out of the box.
2. **User-supplied keys** — settings panel asks the user to paste their own key, stored in `localStorage`. Zero ops cost, but UX-hostile.
3. **OpenRouter / LiteLLM gateway** — one credential, many models, built-in rate limits. Trade off: you carry the bill.

**Recommended:** Worker proxy as the public path; user-key field as the power-user escape hatch; offline SmolVLM as the no-network path. Three tiers, one app.

---

## 9. Tooling additions worth considering (raw list)

- **Spell replay** — re-animate the stroke sequence and the resulting effect side-by-side with the user's drawing.
- **Dictionary editor** — in-app CRUD over `sigils.json` / `signs.json`, with import/export. The `strokeTemplateMaker.html` tool you already ship is 70% of the way there.
- **Reference overlay** — ghosted target glyph behind the drawing canvas, like Procreate's symmetry guides.
- **Stroke-quality heatmap** — visualize point-density / speed / pressure on the user's stroke; great pedagogical signal.
- **Template vs LLM A/B view** — split-screen of "what the template matcher saw" vs "what the LLM saw"; invaluable while tuning.
- **Test corpus tooling** — labelled "good"/"bad" PNGs in `tests/fixtures/`, with a Playwright runner that snapshots both recognition and rendering.
- **Telemetry (privacy-respecting)** — anonymous histogram of "recognized vs rejected" without uploading drawings; PostHog-style or even just a `console.table` for self-tuning sessions.
- **Public spell gallery** — Cloudflare R2 + Workers, share-link a `SpellIR` snapshot, no PII.
- **Recognition-accuracy benchmark** — `npm run bench` over the test corpus, prints confusion matrix.

---

## 10. Testing strategy

1. **Property-based** (fast-check) over the parser: random closed polylines should never crash; random stroke counts produce well-typed `GlyphAST`.
2. **Golden-image** for renderer: `tests/golden/<spell>.png`, regenerate with `npm run golden:update`, Playwright screenshot diff with a small pixel tolerance.
3. **Recognition benchmark suite**: ~50 hand-drawn fixtures per sigil, target ≥90% top-1. CI fails on regression.
4. **LLM-judge regression**: fixed prompt + fixed images → expected JSON. Track judge drift across model versions; pin model SHA when one ships.
5. **Visual regression**: Playwright `toHaveScreenshot({ animations: 'disabled' })`, Docker base for stable rendering.
6. **Cross-judge consensus** as a *test signal*: if cloud judge and local SmolVLM judge disagree on a fixture, surface it for review.

---

## 11. Cost / latency reference (judging only)

For 1,000 glyph judgments/day, ~1k input + ~200 output tokens, single image at ~1k tokens:

| Stack | $/day | $/month | p50 latency |
|---|---:|---:|---:|
| Gemini 2.5 Flash everywhere | $0.20 | $6 | 700 ms |
| Haiku 4.5 everywhere | $1.90 | $57 | 900 ms |
| Sonnet 4.6 everywhere | $5.70 | $170 | 1.4 s |
| Opus 4.7 everywhere | $9.50 | $285 | 2.6 s |
| **Hybrid: Flash critic always + Sonnet validator on bottom-20%** | $1.50 | **$45** | 750 ms avg |
| SmolVLM browser only | $0 | $0 | 2–4 s (M-series) |

---

## 12. Privacy / offline considerations

- Drawings are creative output → treat like text the user typed. Don't upload by default if there's a path to avoid it.
- Add a clear toggle: **Local recognition** (template matcher only — current) / **Enhanced (cloud LLM)** / **Offline AI (SmolVLM)**.
- For kid-friendly framing: never log raw images on the server; the Worker proxy should be stateless or only persist hashed digests for rate-limiting.
- No persistent user accounts unless the spell gallery feature ships; keep the project login-free.

---

## 13. Top 10 Concrete Tooling Improvements (ranked by ROI)

1. **perfect-freehand strokes + Path2D rendering** — half a day; aesthetic upgrade is dramatic; zero risk.
2. **Hybrid LLM-judge (template top-K → Sonnet 4.6 validator) behind a feature flag** — 2 days; finally explains rejections; cheap at small scale.
3. **In-app dictionary editor with import/export** — 2 days; unblocks community contributions; reuses existing template-maker tool.
4. **Recognition-accuracy benchmark + fixtures repo** — 1 day; gives you ground truth for every future change.
5. **Reference glyph overlay (ghosted target)** — 0.5 day; cuts the "I can't even tell what shape to draw" failure mode.
6. **Stroke-quality heatmap visualization** — 1 day; pedagogically delightful; uses data you already capture.
7. **PixiJS effect stage with tsParticles for sparks** — 3 days; visual quality jump; keep Canvas 2D for input layer to avoid coupling.
8. **Cloudflare Worker proxy + user-key escape hatch** — 1 day; unlocks all cloud judging cleanly.
9. **Spell replay (re-animate strokes + effect side-by-side)** — 1 day; perfect screenshot/share material.
10. **SmolVLM-WebGPU offline judge** — 3 days; differentiating feature; works on flights and respects kid privacy.

Items 1–6 are low-risk, single-day wins. 7–10 are bigger but each independently shippable.

---

## 14. Recommended LLM-judge architecture (single best bet)

**Tier-1 cloud path (default when online):**

```
Stroke capture → existing parser → topK=3 candidates from templateMatcher
       │
       └──► If top-1 cosine ≥ 0.85: accept, no LLM call. Use template confidence.
                Else: rasterize 768×768 PNG (1.15 MP cap)
                       ├── Prompt = system rubric + few-shot anchors
                       │           (one perfect, one rough, one negative per candidate)
                       ├── Tool call: judge_glyph(strict JSON schema)
                       │     { glyph_id, confidence, alternatives[], critique,
                       │       errors[], rotation_deg, rubric: {closure, cleanliness,
                       │       continuity, recognizability} }
                       └── Model: Claude Sonnet 4.6  (Haiku 4.5 if rate-limited)
       │
       └──► If LLM confidence ≥ 0.7: accept LLM choice.
            Else: surface critique to user, do not compile spell.
```

**Tier-2 offline path (toggle):**

Same pipeline, same JSON schema, model swapped to **SmolVLM-2B via transformers.js WebGPU**. Tests reuse identical fixtures across both judges; CI compares agreement.

**Tier-3 critique-only (always on, free-ish):**

After every successful recognition (template or LLM), fire a fire-and-forget call to **Gemini 2.5 Flash** for a stroke-cleanliness critique (one of: *clean, slightly wobbly, broken-closure, doubled-stroke*). Display as a non-blocking tip. Cost: pennies per day; UX value: high.

**Why this design:**

- **Template matcher remains authoritative** on confident input (free, instant, deterministic — preserves the project's current good behavior).
- **LLM is invoked only where it adds value** (low-confidence, ambiguous, or pedagogical moments) — keeps cost under $50/mo at hobby scale.
- **Closed-set classification** is what LLMs are best at; we never ask "what is this?" — only "of {fire, water, wind, earth, light, none}, which is this, and why?".
- **Strict JSON schema** prevents output drift across model upgrades.
- **Same schema across all three tiers** means fixtures, regression tests, and UI are written once.
- **Cloudflare Worker proxy** keeps keys safe and lets the gh-pages static deploy stay static.
- **Offline path** preserves the fan-project / kid-friendly / privacy-first ethos that should define this app.

The whole thing fits inside a 2-week sprint and adds one new module: `src/parser/llmJudge.js` plus a `judge_glyph` tool definition. Everything else is config and prompts.

---

*End of Lane 3 report.*
