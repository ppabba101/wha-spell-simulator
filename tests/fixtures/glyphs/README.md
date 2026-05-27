# WHA Spell Simulator — Glyph Fixture Corpus

## Origin and Degradation Notice

**This corpus is procedurally generated.** No human drawers were available at
corpus-capture time. Three drawer *personas* are simulated via parametric stroke
generation with a seeded PRNG. This makes the corpus deterministic and suitable
for:

- Regression testing (template matcher smoke tests, AST round-trips)
- CI fixtures (ensuring the recogniser does not regress between code changes)

It is **NOT suitable** for:

- Final AC-P1 accuracy measurement (≥90% top-1 on a held-out human-drawn test split)
- User-fidelity benchmarking
- Training a learned recogniser

Replace with real human-drawn fixtures (≥3 contributors, ≥3 examples per glyph
in the test split) before declaring AC-P1 met.

---

## Persona Definitions

| Drawer ID | Persona               | Noise Amplitude (px) | Speed Variance |
|-----------|-----------------------|----------------------|----------------|
| 1         | steady-hand-expert    | 0.5                  | 0.10           |
| 2         | average-user          | 2.0                  | 0.40           |
| 3         | shaky-hand-beginner   | 6.0                  | 0.90           |

Noise is applied as value-noise perturbation on each point position.
Speed variance jitters the inter-point timing (affects `t_ms` in the stroke format).

---

## Directory Structure

```
tests/fixtures/glyphs/
├── INDEX.json                    # Registry of all fixtures (see below)
├── README.md                     # This file
├── clean/                        # Persona 1 (steady-hand-expert) sigil fixtures
│   ├── fire_clean_001.png
│   ├── fire_clean_001.strokes.json
│   └── ...
├── average/                      # Persona 2 (average-user) sigil fixtures
│   └── ...
├── messy/                        # Persona 3 (shaky-hand-beginner) sigil fixtures
│   └── ...
├── nested/                       # Canon nested-ring spell examples (persona 1)
│   ├── memory-erasure_001.png + .strokes.json
│   ├── sylph-shoes_001.png + .strokes.json
│   └── light-reducing_001.png + .strokes.json
└── signs/                        # Sign fixtures (personas 1 + 3, clean + messy)
    ├── column_clean_001.png + .strokes.json
    ├── dispersion_clean_001.png + .strokes.json  (M6 new sign)
    └── ...
```

**Counts:** 30 sigil fixtures + 32 sign fixtures + 3 nested-ring canon = **65 total**.

---

## Stroke Format (`raw-points-v1`)

Each `.strokes.json` file:

```json
{
  "strokeFormat": "raw-points-v1",
  "canvasWidth": 512,
  "canvasHeight": 512,
  "strokes": [
    {
      "id": "s1",
      "points": [[x, y, t_ms, pressure_0to1], ...]
    }
  ]
}
```

- `x`, `y` — pixel coordinates in `[0, 512]`
- `t_ms` — cumulative timestamp in milliseconds from stroke start
- `pressure_0to1` — simulated pen pressure in `[0.1, 1.0]`

This format is stable across M7a's perfect-freehand renderer rewrite.
`perfect-freehand` polygons are render-only and are never stored in fixtures.

---

## INDEX.json Structure

```json
{
  "version": 1,
  "strokeFormat": "raw-points-v1",
  "degradation_notice": "...",
  "drawers": [{ "id": 1, "persona": "steady-hand-expert", ... }],
  "fixtures": [
    {
      "path": "clean/fire_clean_001.png",
      "strokes_path": "clean/fire_clean_001.strokes.json",
      "drawer_id": 1,
      "quality": "clean",
      "ground_truth": {
        "glyph": "fire",
        "primitives": ["Ring", "Line", "Line", "Line"],
        "signs": []
      },
      "split": "train",
      "strokeFormat": "raw-points-v1"
    }
  ]
}
```

**Train/test split:** 70/30, stratified by `drawer_id × quality` bucket so no
single drawer or quality level dominates either split. The split is deterministic
(seeded shuffle, seed `0xc0ffee42`).

---

## How to Regenerate

```bash
node tools/generateFixtureCorpus.mjs
```

The script is idempotent — running it again produces identical output (seeded PRNG).
It requires only Node.js ≥18 with no external dependencies.

---

## Future: Replace with Human-Drawn Fixtures

Per Plan §4 M0 and Pre-mortem E (fixture corpus bias):

1. Use `tools/corpusCapture.html` (to be built in a future task) to capture real
   strokes from ≥3 different contributors.
2. Each contributor draws ≥5 examples of every sigil and sign.
3. A reviewer (not a contributor) signs off via a commit.
4. Replace these procedural files with the human corpus while preserving the
   `INDEX.json` schema so downstream `bench/recognize.js` continues to work.
5. Re-run the stratified split to ensure the test split is unbiased.
