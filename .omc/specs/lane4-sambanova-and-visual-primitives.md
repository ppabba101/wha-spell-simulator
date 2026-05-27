# Lane 4 — SambaNova Streaming Judge + Visual Primitives

Two threads: (A) SambaNova Llama 4 Maverick as a *continuously updating* judge while the user draws; (B) DeepSeek's *Thinking with Visual Primitives* paper for the recognizer. Both are exciting; only one is unambiguously a win. See bottom for ranked actions.

---

## A. SambaNova as the Streaming LLM Judge

### A.1 What's available (May 2026)

SambaNova hosts **`Llama-4-Maverick-17B-128E-Instruct`** with vision input: **up to two images/request** (JPG/PNG), **64K context**, OpenAI-compatible REST. Pricing **$0.63 / $1.80 per 1M in/out tokens** (blended ~$0.92).

Per Artificial Analysis: SambaNova serves Maverick at **~643 tok/s output** — fastest of any provider, 3.2× the next (Amazon 203 tok/s). TTFT is not the leader (DeepInfra FP8 at 0.67s, Amazon 0.85s); throughput dominates for a streaming-while-drawing loop.

Other SambaNova vision options (Llama 3.2 11B/90B Vision) exist, but Maverick is the strategic pick: native multimodal MoE with early-fusion vision, actively maintained, dramatically faster than the 90B dense model.

### A.2 API surface

- **OpenAI-compatible** chat completions endpoint. Drop-in for `openai` SDK by overriding `base_url`.
- **SSE streaming** via `stream=True`. Chunked token deltas.
- **Image input:** standard OpenAI vision payload — `content: [{type:"text",...},{type:"image_url", image_url:{url:"data:image/png;base64,..."}}]`. Base64 data URLs work; SambaNova does **not** fetch external URLs reliably (community AI SDK notes confirm). Treat it as base64-only.
- **CORS: not supported for direct browser calls.** Multiple community threads (2024–2025) confirm CORS errors from frontend-only apps, and unlike Anthropic there is no `dangerous-direct-browser-access` escape hatch. You will need a thin proxy (Cloudflare Worker, Vercel Edge Function, or a tiny Node relay).
- **Unsupported OpenAI params:** `presence_penalty`, `frequency_penalty`, `logit_bias`. `n>1` blocked with tool use. Multi-modal models don't honor `seed`.
- **Rate limits:** Free Tier 20 RPM / 20 RPD / 200K TPD. Developer Tier (card on file) 60–240 RPM, 12K–48K RPD, capped at 20M tokens/day across all models. **20 RPM on free tier is a hard ceiling at ~1 call every 3 seconds — not enough for a 500ms drawing-poll loop.** Developer tier at 60 RPM is exactly one call per second, still tight. Realistic plan: assume you must pay, and budget around 240 RPM (one call every 250ms).

### A.3 Continuous-judge UX patterns

Krea Realtime, Tldraw's AI agent, Leonardo Realtime Canvas, and Excalidraw's text-to-diagram all converged on two combined patterns:

1. **Diff-gated submission.** Ping when the canvas has changed *enough*, not on a timer. Krea/Leonardo use perceptual-hash thresholds; Tldraw uses stroke-end + dwell.
2. **Streaming partial responses → progressive UI.** Tldraw streams shape mutations, Krea streams diffusion frames, ChatGPT Canvas streams text. User sees model "thinking" and can stop early.

For WHA (small canvas, ~10s draw, 5–20 glyph vocab):

- Stroke-end debounce (150ms after pointer-up) OR idle-tick (every 750ms while drawing) — whichever fires first.
- dHash diff vs last sent frame; skip if Hamming distance < 6.
- 256×256 grayscale PNG, no antialiasing on the export path.
- Cancellable in-flight via `AbortController` — never pipeline; only latest judgment matters.
- Streamed structured JSON (`{primitives, guess, confidence, hint}`) so UI paints primitives as they arrive, before the final guess lands.

### A.4 Cost back-of-envelope

Scenario: 30s draw, ping every 500ms = 60 calls. With diff-gating realistically ~20 calls. 256×256 PNG ≈ ~250 tokens after the vision tokenizer. Prompt overhead ~250 tokens. Output ~100 tokens.

Per spell, with diff-gating (20 calls):
- **SambaNova Maverick:** 20 × (500 in × $0.63/M + 100 out × $1.80/M) = **~$0.0099**
- **Gemini 2.5 Flash:** 20 × (500 × $0.30/M + 100 × $2.50/M) = **~$0.0080**
- **Claude Sonnet 4.6:** 20 × (500 × $3/M + 100 × $15/M) = **~$0.060**

Sonnet is **~6× more expensive**. Gemini Flash is actually slightly *cheaper* than SambaNova on raw cost. **The SambaNova win is not price — it's latency.** At 643 tok/s vs Gemini Flash's ~250 tok/s and Sonnet's ~85 tok/s, a 100-token response lands in ~155ms on SambaNova vs ~400ms on Flash vs ~1.2s on Sonnet. For an *interactive* judge, that's the entire game.

### A.5 Latency table (vision-capable, comparable quality tier)

| Provider | Model | Output tok/s | TTFT (approx) |
|---|---|---|---|
| SambaNova | Llama 4 Maverick | 643 | ~0.9s |
| Cerebras | Llama 4 (text-fast paths) | 525+ | ~0.2s |
| Groq | Llama 4 Maverick | 480 | 0.18s |
| Amazon Bedrock | Llama 4 Maverick | 203 | 0.85s |
| Google | Gemini 2.5 Flash | ~250 | 0.62s |
| Anthropic | Claude Sonnet 4.6 | ~85 | ~1.5s |
| OpenAI | GPT-4o vision | ~90 | ~0.8s |

Cerebras and Groq beat SambaNova on TTFT; SambaNova beats them on sustained throughput. For *continuous* judging with short outputs, **TTFT dominates** — Groq is arguably a better pick if vision quality on their hosted Maverick is comparable. Worth A/B-ing both.

### A.6 Risks

- **CORS forces a proxy** (+30–80ms, deploy surface). Key lives server-side, which is correct anyway.
- **20 RPM free tier kills the demo.** Need developer tier or per-user key flow.
- **Model deprecation:** expect Maverick replaced within ~12 months; keep model ID in config.
- **Vision quality:** Maverick is benchmark-competitive but not frontier-class like Sonnet 4.6 / Gemini 3.5. Probably fine for a 5–20 glyph vocabulary; spot-check adversarial sketches.
- **Quota cliff:** dev tier caps at 20M tokens/day total ≈ ~1,600 spells/day across all users. Fine for demo, not for traffic.
- **No `seed` reproducibility on multi-modal** — tests need fuzzy assertions.

### A.7 Integration sketch — `src/parser/streamingLlmJudge.js`

```js
// streamingLlmJudge.js — continuous vision judge over a drawing canvas
import { dHash, hammingDistance } from './perceptualHash.js';

const PROXY_URL = '/api/judge';           // your Worker/Edge endpoint
const MODEL = 'Llama-4-Maverick-17B-128E-Instruct';
const DIFF_THRESHOLD = 6;
const IDLE_TICK_MS = 750;
const DEBOUNCE_MS = 150;

export function createStreamingJudge(canvas, onHint) {
  let lastHash = null;
  let inflight = null;
  let idleTimer = null;
  let debounceTimer = null;

  function snapshot() {
    const off = document.createElement('canvas');
    off.width = off.height = 256;
    off.getContext('2d').drawImage(canvas, 0, 0, 256, 256);
    return off.toDataURL('image/png');
  }

  async function submit() {
    const dataUrl = snapshot();
    const h = await dHash(dataUrl);
    if (lastHash && hammingDistance(h, lastHash) < DIFF_THRESHOLD) return;
    lastHash = h;

    inflight?.abort();
    inflight = new AbortController();

    const body = {
      model: MODEL, stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_WITH_PRIMITIVE_VOCAB },
        { role: 'user', content: [
          { type: 'text', text: 'Identify primitives + best-guess glyph. JSON only.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ]}
      ],
    };

    const res = await fetch(PROXY_URL, {
      method: 'POST', body: JSON.stringify(body),
      signal: inflight.signal,
    });

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // parse SSE lines, accumulate JSON, fire onHint with partials
      for (const line of extractSseEvents(buf)) {
        const delta = JSON.parse(line).choices?.[0]?.delta?.content;
        if (delta) onHint(progressiveJsonParse(delta));
      }
    }
  }

  canvas.addEventListener('pointermove', () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(submit, IDLE_TICK_MS);
  });
  canvas.addEventListener('pointerup', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(submit, DEBOUNCE_MS);
  });
}
```

Proxy: a 30-line Cloudflare Worker that forwards `Authorization: Bearer ${SAMBANOVA_KEY}` and streams the SSE response back unchanged.

---

## B. Thinking with Visual Primitives

### B.1 The paper

- **Title:** *Thinking with Visual Primitives*
- **Authors:** DeepSeek-AI (Ruijie Lu, Yiyang Ma, et al.)
- **Status:** Released on alphaXiv / HuggingFace mirrors. The official version was briefly published and then quietly retracted by DeepSeek; a community mirror exists on HuggingFace (`NodeLinker/deepseek-ai-Thinking-with-Visual-Primitives-deleted-repo`) and a clone is at `mitkox/Thinking-with-Visual-Primitives` on GitHub. No stable arXiv ID — treat it as gray literature.
- **Lineage:** Continues DeepSeek's vision-architecture sequence Janus → VL2 → OCR → V4-Flash backbone.

### B.2 Core thesis

Multimodal models can *look* at an image but *reason* purely in language. For tasks needing positional tracking — counting, mazes, spatial relations — natural language is a lossy referencing system and the model drifts. DeepSeek's cure: elevate **points and bounding boxes** to first-class chain-of-thought tokens. Instead of "the third circle from the left," the model emits `<ref>circle</ref><box>120,80,180,140</box>` *inline*, anchoring reasoning to specific image coordinates. These aren't tool calls; they're native vocabulary, learned via 5-stage SFT+RL with separate reward heads for format, reasoning, and answer. The model can *re-reference* primitives in later steps without re-describing them. A 284B MoE (13B active) with 7,000× pixel→KV compression matches GPT-5.4 / Sonnet-4.6 / Gemini-3-Flash on counting/spatial benchmarks. They call this the **"reference gap"** — distinct from the perception gap most 2024-era work targeted.

### B.3 Mechanism

- **Primitive vocabulary:** `<ref>label</ref>`, `<box>x1,y1,x2,y2</box>`, `<point>x,y</point>`. Coordinates are normalized integer tokens.
- **Interleaving:** primitives stream inline with text reasoning. Example: *"To count vials I'll find each one. <ref>vial</ref><point>120,80</point> first. <ref>vial</ref><point>240,90</point> second…"*
- **Training:** five stages — (1) base VLM pre-train, (2) grounding specialist (image→box), (3) pointing specialist (image→point), (4) merge + interleaved-reasoning SFT, (5) RL with three reward heads (format validity, reasoning trace quality, final-answer accuracy).
- **Compression:** every 4 visual tokens collapsed into one KV-cache entry — drastically reduces image-token consumption while keeping cognitive depth.
- **Eval:** maze navigation (67% vs ~49% for peers), object counting, spatial relations. Authors explicitly *don't* claim general capability gain.

### B.4 Direct applicability to WHA glyphs

The lane's most interesting finding. WHA glyphs are literally primitive compositions: outer ring, inner ring, symmetric lines, arcs, rotationally-arranged dots. The paper's vocabulary (points, boxes) is too coarse for sketch shape, but the *idea* — primitives as first-class reasoning tokens — fits exactly. Extended vocab:

```
<ring r="R" cx="cx" cy="cy"/>
<line a1="0" a2="180" len="L"/>
<arc a1="30" a2="150" r="r"/>
<dot a="90" r="r"/>
<symmetry n="4"/>     // 4-fold rotational
```

Then a judge response looks like:

> *I see a `<ring r="120"/>` enclosing two `<line a1="0" a2="180"/>` and a small `<arc a1="60" a2="120" r="40"/>`. This is consistent with the **Fire** sigil but missing the keystone dot at the apex. Add `<dot a="90" r="100"/>` to complete it.*

Solves four real problems:

1. **Free explainability.** "Your ring is solid but your top line is 15° off" instead of "82% confidence."
2. **Nested-circle problem dissolves.** Templates struggle with rings-inside-rings; a primitive program nests trivially.
3. **Symbolic match replaces pixel templating.** Canonical glyphs become DSL programs; matching is set-diff, rotation/scale-invariant, wobble-robust.
4. **Judge becomes a glyph compiler.** LLM outputs the program → you can *render* a cleaned version of the user's sketch → instant "polish my sigil" feature.

### B.5 Concrete design ideas to import

1. **Define a WHA-DSL** of primitives (`Ring`, `Line`, `Arc`, `Dot`, `Symmetry`) as a strict JSON grammar.
2. **Make the LLM judge output the DSL**, not free text. Use SambaNova's JSON-mode + few-shot exemplars.
3. **Store canonical glyphs as DSL programs**, one per spell. ~20 lines of JSON each, hand-authored from canon (Lane 2's deliverable).
4. **Set-diff matcher:** compare extracted program to canonical programs via primitive-set Jaccard with angle/radius tolerance. Replaces template correlation entirely.
5. **Interleaved CoT in the system prompt:** show the model how to reason inline ("First I locate the outer ring… `<ring r=…>`… then the symmetry…"), per the paper.
6. **Hough + RANSAC pre-pass** in JS for circles and lines. Feed *detected* primitives into the prompt as a hint; the LLM verifies and adds what classical CV missed. This is the paper's "grounding specialist" idea, ported.
7. **Two-stage reward in your eval harness:** score primitive extraction and final-glyph-guess separately. Don't conflate.
8. **KV compression analog:** downsample canvas to 256² before vision tokenization — same spirit, much simpler.
9. **Progressive primitive streaming UI:** as the LLM streams `<ring/>` then `<line/>` then `<dot/>`, overlay each on the user's canvas as it arrives. The paper's inline-anchoring becomes a live UI affordance.
10. **Failure mode logging:** any time set-diff matches but final guess wrong (or vice-versa), log the primitive program — cheap dataset for later fine-tune.

### B.6 What to skip

- **Don't train your own VLM.** Vocabulary and CoT format transfer; the SFT+RL pipeline doesn't.
- **Don't use raw bounding boxes** — WHA isn't object-detection. Use shape primitives.
- **Skip the 7,000× compression** — backbone-level; 256×256 PNG is enough.
- **Skip the "two specialist models" split** — single prompt + few-shots is fine for v1.

### B.7 Related techniques worth combining

- **Program-Aided LMs (PAL, Gao et al. 2023):** LLM outputs code; deterministic interpreter runs it. Here the "program" is the DSL.
- **Neuro-symbolic visual reasoning** (NS-VQA, Yi et al.): scene-graph extraction → symbolic solver. Same shape.
- **Hough transform** for ring/line detection — robust to sketch noise, runs in <5ms in JS, gives the LLM a strong prior.
- **RANSAC circle fitting** for the outer ring — the most stable anchor in every WHA glyph.
- **Sketch-RNN / SketchGPT stroke models** for online recognition — overkill for v1 but worth bookmarking if the LLM judge proves too slow.

---

## Top 5 SambaNova / Streaming-Judge Action Items (impact / effort)

1. **Ship a Cloudflare Worker proxy that streams SambaNova SSE back to the browser.** Impact: unblocks the entire pattern (CORS). Effort: ~1 hour. **Do this first.**
2. **Implement diff-gated submission with dHash and AbortController cancellation.** Impact: turns the loop from a money-burner into a sensible UX. Effort: ~3 hours. The single biggest UX-per-dollar lever.
3. **A/B SambaNova Maverick vs Groq Maverick on a fixed glyph eval set.** Impact: TTFT matters more than throughput for short responses; Groq might actually feel faster. Effort: ~2 hours. Pick the winner; don't assume.
4. **Streamed structured JSON output with progressive UI rendering** (paint primitives as they arrive). Impact: the "canvas responds in real time" wow factor lives entirely here. Effort: ~6 hours.
5. **Move to Developer tier and budget for ~240 RPM.** Impact: removes the 20 RPM free-tier cliff that kills any real demo. Effort: 5 minutes + credit card.

## Top 5 Visual-Primitives Ideas to Implement (impact / effort)

1. **Define WHA-DSL** (`Ring`, `Line`, `Arc`, `Dot`, `Symmetry`) as strict JSON grammar and force LLM output through it. Impact: explainability, set-diff matching, polish-my-sigil feature all unlock. Effort: ~4 hours including few-shot tuning. **The single highest-leverage idea in this lane.**
2. **Represent canonical glyphs as DSL programs**, replace template-correlation matching with primitive set-diff. Impact: solves nested-rings problem and rotation/scale invariance in one shot. Effort: ~6 hours (depends on Lane 2 canon).
3. **Hough + RANSAC pre-pass in JS**, inject detected primitives into the LLM prompt as a grounding hint. Impact: cuts LLM errors on noisy sketches dramatically; classical CV does what it's good at. Effort: ~5 hours.
4. **Progressive primitive overlay UI** — render `<ring/>`, `<line/>`, `<dot/>` on the canvas as they stream in. Impact: this is the demo. Effort: ~4 hours after DSL exists.
5. **Two-stage eval harness** scoring primitive-extraction accuracy and final-glyph-guess accuracy separately. Impact: without this you can't tell *why* a regression happened. Effort: ~3 hours. Boring but load-bearing.

---

## Sources

- [SambaNova × Llama 4 Maverick blog](https://sambanova.ai/blog/sambanova-partners-with-meta-to-deliver-lightning-fast-inference-on-llama-4)
- [Artificial Analysis — Llama 4 Maverick providers](https://artificialanalysis.ai/models/llama-4-maverick/providers)
- [SambaNova Cloud pricing](https://cloud.sambanova.ai/plans/pricing)
- [SambaNova Maverick 64K context + vision announcement](https://community.sambanova.ai/t/llama-4-maverick-17b-128e-instruct-context-window-is-now-64k/1120)
- [SambaNova OpenAI compatibility docs](https://docs.sambanova.ai/docs/en/features/openai-compatibility)
- [SambaNova rate limits](https://docs.sambanova.ai/docs/en/models/rate-limits)
- [SambaNova CORS issue thread](https://community.sambanova.ai/t/cors-issue-with-sambanovas-api-endpoint/290)
- [Thinking with Visual Primitives — alphaXiv](https://www.alphaxiv.org/overview/visual-primitives)
- [MindStudio — 5 Technical Breakthroughs](https://www.mindstudio.ai/blog/deepseek-thinking-visual-primitives-5-technical-breakthroughs-paper)
- [HuggingFace mirror of the deleted paper](https://huggingface.co/datasets/NodeLinker/deepseek-ai-Thinking-with-Visual-Primitives-deleted-repo)
- [Krea Realtime docs](https://docs.krea.ai/user-guide/features/realtime)
- [Tldraw AI agent starter kit](https://tldraw.dev/starter-kits/agent)
- [Gemini 2.5 Flash pricing/perf](https://artificialanalysis.ai/models/gemini-2-5-flash)
