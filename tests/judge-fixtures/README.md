# Judge regression fixtures (M8)

Pinned (image, prompt, model) → expected-DSL tuples used by
`tests/judgeFixtureRegression.test.js`.

Each fixture file contains:

| field           | meaning                                                               |
|-----------------|-----------------------------------------------------------------------|
| `id`            | Human-readable fixture id                                             |
| `element`       | One of `fire | water | wind | earth | light`                         |
| `image.path`    | Repo-relative path to the rendered PNG (M0 corpus)                    |
| `image.sha256`  | SHA-256 of the PNG bytes — image integrity is part of the regression  |
| `prompt.id`     | `"deep" | "fast"` — which system prompt produced the expected output |
| `prompt.sha256` | SHA-256 of the assembled system prompt (including few-shot anchors)   |
| `model.id`      | Model id whose canonical output we pinned                             |
| `expected`      | Strict WHA-DSL JSON the judge SHOULD return                           |

The `expected` payload is what a perfectly-aligned model would emit; the
regression test validates it through the strict `validateDsl` schema check
so any drift in the WHA-DSL spec breaks the test immediately. The test
does NOT call a live LLM — for real-LLM E2E coverage see
`tests/judgeRealLlm.integration.js` (env-gated by `SAMBANOVA_KEY`).
