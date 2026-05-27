# WHA Spell Simulator – Codebase Audit

**Lane 1 Investigation** | Evidence-based architectural and robustness audit
**Date**: May 26, 2026 | **App Version**: 0.1.0-poc | **Total LOC**: 5887

---

## 1. Architecture Overview

### Pipeline Summary

The simulator follows a classic AI recognition → parsing → compilation → rendering flow:

```
User Input (Pointer events)
    ↓ drawingCapture.js (src/input/drawingCapture.js:115)
Strokes + Store (strokeStore.js)
    ↓ strokeCleaner.js (src/parser/strokeCleaner.js:46)
Clean Strokes
    ↓ ringDetector.js (src/parser/ringDetector.js:509)
Ring Detection + Activation Event
    ↓ classifyDrawing() (src/parser/drawingClassifier.js:163)
GlyphAST (Abstract Syntax Tree)
    ↓ compileSpell() (src/compiler/spellBuilder.js:110)
SpellIR (Intermediate Representation)
    ↓ Render Pipeline (src/renderer/*)
Canvas Effects + Diagnostics
```

**Module Ownership**:

- **Input Layer** (`src/input/`): `drawingCapture.js`, `strokeStore.js`, `pointerNormalizer.js` – captures pointer events, buffers strokes, normalizes coordinates.
- **Parser Layer** (`src/parser/`): Ring detection, stroke grouping, symbol candidate building, template matching, and recognition scoring.
- **Compiler Layer** (`src/compiler/`): `spellBuilder.js` (validity checks, state), `spellQuality.js` (neatness/quality scoring), `semanticRules.js` (manifestation aggregation), `spellDirection.js` (paper-local 3D direction).
- **Renderer Layer** (`src/renderer/`): Canvas 2D effects (fire/water/wind/earth/light), glyph overlay, paper background, particle state.
- **UI Layer** (`src/ui/`): Diagnostics panels, dictionary reference, spell summary meters, tab management.
- **Config**: `src/config.js` (74 lines) – all numeric thresholds, layer boundaries, recognition confidence floors, particle counts.

**Entry Point**: `src/main.js:107` – `init()` sets up event listeners, loads dictionary, starts animation loop.

---

## 2. Recognition / Matching System

### Strategy: Template-Based Rasterized Ink Matching

The recognizer is **NOT** Hu moments, DTW, or hand-crafted features. It is a **two-stage rasterized ink-score system**:

**Stage 1: Ink Overlap** (`src/parser/templateMatcher.js:14-80`)
- Rasterizes candidate and template strokes into a 10×10 pixel grid (`REGION_GRID_SIZE`)
- Tests `8` rotation angles for sigils (`rotationSet()` at line 14), `1` for signs at fixed canonical pose
- Computes soft-radius ink masks (core `CORE_RADIUS=1`, soft `SOFT_RADIUS=2`, loose `LOOSE_RADIUS=4`)
- Outputs: `inkScore`, `candidateExplainedRatio`, `templateCoveredRatio`, `softDiceScore`, `contaminationRisk`

**Stage 2: Structural Compatibility** (`src/parser/symbolRecognizer.js:164-203`)
- **Aspect ratio**: width/height match with rotation-corrected blend (lines 56-71)
- **Stroke count**: penalizes missing or extra strokes (line 103-108)
- **Stroke profile**: length-sorted strokes normalized by total (lines 78-101), compared via L1 distance
- **Orientation**: dominant axis angle match (undirected, lines 73-76)
- **Size range**: normalized sigil size `0.045..0.46` (line 298)
- **Layer fit**: dictionary `allowedLayers` bonus (lines 18-32)
- **Neatness**: overdraw amount and endpoint closure penalties (lines 226-237)

**Final Confidence Formula** (lines 318-327):
```javascript
contextualScore = 
  templateMatch.confidence * 0.68 +
  structuralMatch.score * 0.13 +
  layerScore * 0.1 +
  sizeScore * 0.04 +
  candidate.neatness * 0.05;

confidence = clamp(
  min(contextualScore, contextLiftCap) * 
  simpleSignStructureMultiplier * 
  simpleSignIncompleteCap * 
  grossStructureMismatchCap
)
```

### Recognition Status Classification (lines 239-266)

- `unknown`: No candidate match or score below threshold
- `contaminated`: Extra unmatched ink detected (line 212-223)
- `ambiguous`: Low structural match OR close competing symbol (line 247, 259-260)
- `valid_messy`: Passes confidence but high overdraw/neatness penalty (lines 226-237)
- `valid`: Clean, unambiguous match

### Thresholds

- `CONFIG.recognition.minConfidence = 0.48` (src/config.js:38)
- `RECOGNITION_AMBIGUITY_GAP = 0.065` (src/parser/symbolRecognizer.js:13) – gap between 1st and 2nd match required
- `PRIMARY_SIGIL_AMBIGUITY_GAP = 0.05` (src/compiler/spellBuilder.js:12) – stricter compiler check
- Contamination risk threshold: `0.62` (line 212)

### Accuracy / Failure Modes

**Known Issues**:
1. **Dumb simple version**: README explicitly states "not perfect" (README.md:33-34)
2. **Valid-looking drawings may fail**: Clean drawings can still miss if aspect ratio distorts beyond tolerance
3. **Rough drawings may pass**: High overdraw tolerance (line 169: `0.82` template coverage okay) can accept sloppy matches
4. **No stroke order recovery**: Cannot extract sequence from raster, so directional intent unclear if sign orientation matters
5. **Sign templates fixed at bottom-of-ring**: Rotation canonicalization (src/parser/signRotation.js:98) rotates candidates into `270°` frame, assumes orientation-agnostic matching

---

## 3. Glyph Dictionary

### Supported Sigils (Primary Elements)

**File**: `src/dictionary/sigils.json` (93KB, 5 sigils)

| ID | Display Name | Element | Layers | Semantic |
|---|---|---|---|---|
| `fire` | Fire | `fire` | center, middle, outer | force +0.12, focus +0.04, spread +0.02, range +0.08, lifetime +0.08 |
| `water` | Water | `water` | center, middle, outer | force +0.16, focus +0.02, spread +0.10, range +0.20, lifetime +0.12 |
| `wind-directs-air` | Wind (Directs Air) | `wind` | center, middle, outer | force +0.08, focus +0.06, spread +0.00, range +0.24, lifetime -0.08 |
| `earth` | Earth | `earth` | center, middle, outer | force +0.04, focus +0.00, spread +0.06, range +0.10, lifetime +0.04 |
| `light` | Light | `light` | center, middle, outer | force +0.20, focus +0.16, spread -0.04, range +0.14, lifetime +0.02 |

Each sigil has a normalized `strokeTemplate` with 0–1 point coordinates and source aspect ratio.

### Supported Signs (Modifiers)

**File**: `src/dictionary/signs.json` (13KB, 3 signs)

| ID | Display Name | Manifestation | Direction Mode | Layers | Semantic |
|---|---|---|---|---|---|
| `column` | Column | `column` | `inward` | middle, outer | force +0.30, focus +0.35, spread -0.24, range +0.18 |
| `levitation` | Levitation | `levitation` | `orientation` | middle, outer | force +0.12, focus +0.02, spread +0.08, range +0.18, lifetime +0.28 |
| `convergence` | Convergence | `convergence` | `inward` | middle, outer | force +0.08, focus +0.36, spread -0.32, range -0.04, lifetime +0.08 |

**Direction Modes**:
- `position`: direction from sign's radial position around ring
- `orientation`: direction from sign's drawn stroke orientation
- `inward`: opposite of position (left-side sign pushes right)

### Sample Spells

**File**: `src/dictionary/sample-spells.json` (24KB, reference layouts only)
- Visual reference drawings in the Dictionary panel
- Do NOT load strokes, do NOT affect parser or compiler
- Used for player learning by eye

### Glyph Definition Format

```json
{
  "id": "fire",
  "displayName": "Fire",
  "element": "fire",
  "allowedLayers": ["center", "middle", "outer"],
  "recognitionRotationInvariant": false,
  "semantic": {
    "force": 0.12,
    "focus": 0.04,
    "spread": 0.02,
    "range": 0.08,
    "lifetimeBias": 0.08
  },
  "strokeTemplate": {
    "sourceAspectRatio": 1,
    "strokes": [
      [{"x": 0.5, "y": 0}, {"x": 0.5, "y": 1}]
    ]
  }
}
```

**Dictionary Loading** (src/dictionary/dictionaryLoader.js:9-14):
- Fetches JSON in parallel via `Promise.all()`
- No validation of template structure, missing fields, or semantic bounds
- No runtime warnings for typos in element names or manifestation labels

---

## 4. Parser / Compiler / IR

### Data Flow: GlyphAST → SpellIR

**GlyphAST** (parsed glyph abstract syntax tree) – parser output.
- Ring detection result + completeness
- Symbol candidates grouped from strokes
- Recognized primary sigil (highest confidence)
- Unsupported extra sigils (other matches above threshold)
- Recognized signs (direction, manifestation modifiers)
- Unknown marks (unrecognized candidates)
- Global metrics: neatness, radial symmetry, instability
- Warnings (ring incomplete, multiple sigils, contaminated symbols, etc.)

**SpellIR** (spell intermediate representation) – compiler output.
- Validity state (valid/prepared/active/invalid)
- Element choice and confidence
- Manifestations object (levitation, column, convergence, aura)
- Direction 3D vector (x, y, z components + tilt angles)
- Gameplay parameters: force, spread, focus, range, duration, stability, quality
- Effect scale (normalized by sigil size)

### Compiler Validation Rules (src/compiler/spellBuilder.js:110-226)

1. Ring must be detected → `invalid_spell("No ring detected")` (line 111-112)
2. Multiple rings unsupported → reject (lines 115-116)
3. Multiple recognized sigils unsupported → reject (lines 119-120)
4. Primary sigil required and confidence ≥ 0.62 (lines 123-129)
5. Confidence gap ≥ 0.05 from second-best sigil (lines 132-134)
6. Element must be in SUPPORTED_ELEMENTS (lines 137-142)

### Quality & Stability Scoring

**Quality** (src/compiler/spellQuality.js:38-54):
```
quality = (
  ringNeatness * 0.25 +
  primaryConfidence * 0.25 +
  (signConfidence || primaryConfidence * 0.7) * 0.20 +
  globalNeatness * 0.15 +
  radialSymmetry * 0.10 +
  (1 - unknowns/7) * 0.05
)
```
Range: 0–1. Higher = cleaner, more confident, fewer unknowns.

**Stability** (src/compiler/spellQuality.js:57-92):
```
stability = clamp(
  ringNeatness * 0.36 +
  symbolNeatness * 0.34 +
  radialSymmetry * 0.12 +
  inverseInstability * 0.18 -
  unknownPenalty -
  ambiguityPenalty -
  boundaryPenalty -
  centerPenalty
)
```
Penalizes: unknown counts, competing sigil matches, symbols near layer boundaries, center contamination.

### Spell Parameter Tuning (src/compiler/spellBuilder.js:16-32)

All gameplay parameters derived from base formula + sigil semantic + sign semantics + quality/neatness:

| Parameter | Base | Quality Modifier | Formula |
|---|---|---|---|
| **force** | 0.34 | +0.18*quality | base + primary.force + signs.force + quality*0.18 |
| **focus** | 0.46 | +0.20*quality | base + primary.focus + signs.focus + quality*0.20 |
| **spread** | 0.32 | +(1-focus)*0.28 | base + primary.spread + signs.spread + (1-focus)*0.28 |
| **range** | 0.42 | +0.18*signPower | base + primary.range + signs.range + signPower*0.18 |
| **duration** | 0.65–8.5s | 0.35*quality + 0.65*neatness | min + (quality*0.35 + neatness*0.65 + lifetimeBias)^1.45 * scale |

All clamped to [0, 1] except duration (0.65–8.5 seconds).

### Manifestations Aggregation

Signs contribute to `SpellIR.manifestations` by semantic `manifestation` field:
- `levitation`: reduces gravity (line 191: `gravity = 1 - levitation * 0.42`)
- `column`: output as entry with strength (lines 149)
- `convergence`: output with point, radius, rigidity (lines 149, semanticRules.js)

Multiple manifestations coexist. Primary manifestation is the strongest by aggregated strength.

---

## 5. Renderer / Animations

### Canvas Architecture

**Two Canvas Layers** (index.html:78-79):
- `#glyphCanvas` (2D): strokes, ring, glyph overlay, diagnostics
- `#effectCanvas` (2D): spell particle effects

**Effect Rendering** (src/renderer/spellEffectRenderer.js:56-160)
- `render()` called each animation frame
- Clears effect canvas, composes lighter blend mode (line 117)
- Dispatches to element-specific effect function

### Element Effects (Canvas 2D Particles)

All effects defined in `src/renderer/effects/`:

| Element | Particle Type | Motion | Key Properties |
|---|---|---|---|
| **Fire** | Radial glowing dots | Fast stream or suspended cloud | force→speed, gravity→suspension, stability→flicker |
| **Water** | 3D-projected droplets | Projectile arc or blob suspension | pressure, height physics, core/outline rendering |
| **Wind** | Curved line particles | Directional with curl | force→speed, stability→curl damping, trail length |
| **Earth** | Square blocky particles | Slow heavy stream | force→speed (lower), damping, size growth |
| **Light** | Trail particles | Deterministic lanes | laneCohesion, trailLength, stabilty→smoothness |

**Shared Renderer Model** (docs/effect-rendering.md:8-17):
1. `activePortalPlane()` – projects ring into tilted ellipse for particle source
2. `portalOutDirection()` – converts paper 3D direction to 2D screen direction
3. `elementFlow()` – bundles direction, focus, convergence, effect scale
4. `narrowedByFocusAndConvergence()` – narrows source width
5. `convergenceFlow()` – builds centerline compression profile

**Tuning Constants** (src/config.js:47-73):
- `particleBaseCount: 130` – baseline particle budget
- `particleCap: 360` – hard cap
- `effectSize.baseScale: 1.28` – baseline visual scale
- `effectSize.sigilSizeInfluence: 2.1` – sigil size multiplier
- `effectSize.minScale / maxScale: 1.0 / 2.35` – renderer clamps

**Prepared vs Active Ring Glow** (src/renderer/spellEffectRenderer.js:122-141):
- Prepared (open ring): cyan pulsing glow, base alpha 0.08–0.13
- Idle (no ring): faint orange glow, alpha 0.06
- Failed spell: red dashed flicker, alpha 0.14–0.30 (lines 143-159)

---

## 6. IMPLEMENTED vs STUBBED vs MISSING

### Implemented Features

✓ **Single primary sigil** (5 elements: fire, water, wind, earth, light)
✓ **Ring detection** (prepared + activated states)
✓ **Sign modifiers** (3 types: column, levitation, convergence)
✓ **Layer system** (center/middle/outer ring zones)
✓ **Direction encoding** (paper 3D + tilt angles)
✓ **Manifestation aggregation** (multiple signs coexist)
✓ **Quality/stability scoring** (neatness-based, multifactorial)
✓ **Canvas 2D particle effects** (all 5 elements)
✓ **Diagnostics output** (Parser, AST, IR panels)
✓ **Dictionary reference** (sample spells, sigil/sign cards)
✓ **Prepared spell preparation** (open ring shows glow, can activate when sealed)

### Explicitly Unsupported (Documented)

✗ **Circles-in-circles (nested rings)** – README line 31, detected as error, parser warns `unsupported_nested_ring`
✗ **Multiple primary sigils** – README line 32, detected as error, compiler rejects
✗ **Multiple distinct rings** – README line 31, parser detects extras and marks invalid

### Partially Implemented / Unclear

⚠ **Line cleanliness as power modifier** – NOT IMPLEMENTED as a direct power source
  - `neatness` affects quality and stability (spellQuality.js), which then affects duration
  - No direct "clean line = more force" rule
  - Overdraw penalties exist (symbolRecognizer.js:232-237) but are recognition-quality signals, not gameplay parameters

⚠ **Line length as power modifier** – PARTIALLY IMPLEMENTED
  - Sign `lengthNorm` (normalized stroke length / ring circumference) affects sign influence weight (drawingClassifier.js:61)
  - Directional bias calculation uses sign lengthNorm as weight multiplier (line 61: `Math.max(0.3, sign.sizeNorm + sign.lengthNorm)`)
  - Sigil size (sizeNorm) drives effect scale directly (spellBuilder.js:157-161)
  - But no explicit "longer line = higher force" in `SPELL_PARAMETER_TUNING`

⚠ **Stroke order / direction sensitivity** – SIGN-ONLY
  - Sigils: orientation ignored (recognitionRotationInvariant: false, but rotation is baked out for raster matching)
  - Signs: `directionMode` controls how orientation contributes (`position`, `orientation`, `inward`)
  - Cannot recover true stroke order from final raster—only the drawn mark shape

⚠ **Prepared vs active spell distinction** – FULLY IMPLEMENTED but simple
  - `prepared = valid && !ring.complete` (spellBuilder.js:155)
  - `active = valid && ring.complete` (line 154)
  - Prepared spells show diagnostics glow, no effect animation (spellEffectRenderer.js:87-103)
  - No player-facing actions available in prepared state (no "ready" button—must physically seal the ring)

⚠ **Non-elemental glyphs beyond 3 signs** – NO ADDITIONAL SIGILS WIRED
  - Dictionary only has 5 sigils, 3 signs
  - No other glyphs (damage/protective barriers, status effects, summons, etc.) mentioned in docs or code
  - Extensible architecture (semantic deltas), but no additional entries

### Gaps and Missing Features

✗ **No LLM-based recognition** – all raster-template matching
✗ **No compound spells** (multi-element mixing)
✗ **No spell stacking/interaction** (two spells active simultaneously)
✗ **No user-drawn custom sigils** (dictionary is static JSON)
✗ **No animation state machine for spell lifecycle** (spells just fade out after duration)
✗ **No fallback element** – invalid sigil = invalid spell, no default
✗ **No per-player difficulty/assist modes** (recognition threshold is global CONFIG)

### TODO/FIXME/HACK Comments

**Search result**: None found via grep. Codebase is production-focused with no visible debug placeholders.

---

## 7. Extension Points

### Adding a New Sigil

1. Edit `src/dictionary/sigils.json`, add entry with:
   - `id`, `displayName`, `element` (required)
   - `allowedLayers`, `recognitionRotationInvariant`
   - `strokeTemplate` (use `/tools/strokeTemplateMaker.html`)
   - `semantic` (force, focus, spread, range, lifetimeBias deltas)

2. No code changes needed—dictionary is loaded dynamically (dictionaryLoader.js)

3. Test via app Diagnostics panel to verify confidence scores

### Adding a New Sign

Same as sigil, but:
- Add to `src/dictionary/signs.json`
- Require `semantic.manifestation` (column/levitation/convergence/custom)
- Require `semantic.directionMode` (position/orientation/inward)
- No `element` field
- Template authored at bottom-of-ring (270°) canonical pose

### Adding a Nested Ring Detector

The nested-ring detection is stubbed:
- `ringDetector.js:534-542` detects and reports nested rings
- Marked as `unsupportedNestedRings` in GlyphAST
- Compiler rejects spell (spellBuilder.js:115-116)

To enable:
1. **Parser**: Keep ring detection as-is, but store distinct inner rings separately in GlyphAST
2. **Compiler**: Extend `compileSpell()` to handle multiple ring entries, decide composition rule (mix elements? layer? pick strongest?)
3. **Renderer**: Extend SpellIR to include per-ring manifestations, update effect particle spawning

### Adding an LLM Judge

No API endpoints exist, but integration points:
1. **Recognition stage** (symbolRecognizer.js): After template matching, could call LLM with confidence and visual features to refine scoring
2. **Quality stage** (spellQuality.js): Could use LLM to evaluate overall spell coherence (is this a sensible spell combo?)
3. **Compiler stage** (spellBuilder.js): Could use LLM to decide multi-element composition rules if nested rings become supported

All would require async coordination in `classifyDrawing()` (drawingClassifier.js:163) and `compileSpell()`.

---

## 8. Build / Test / Dev Setup

### Build Configuration

**Vite Config** (vite.config.js):
- Base: `./` (relative, GitHub Pages friendly)
- Output: `dist/`
- Minify: esbuild
- Inputs: main `index.html` + 4 tools HTML pages
- No source maps in production

**Package.json**:
```json
{
  "name": "witch-hat-atelier-spell-simulator",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "start": "npm run dev",
    "build": "vite build",
    "test": "node --test tests"
  },
  "devDependencies": {
    "vite": "^6.4.0"
  }
}
```

**No external dependencies** (runtime), only Vite for dev/build.

### Test Framework

**Native Node.js Test Runner** (Node 18+)
- Import: `import test from "node:test"`
- Assertion: `import assert from "node:assert/strict"`

**Test Files**:
1. `tests/ringDetector.test.js` (5974 bytes) – ring detection robustness
2. `tests/symbolRecognition.test.js` (13140 bytes) – recognizer accuracy on templates
3. `tests/spellBuilder.test.js` (11291 bytes) – compiler validity and parameter tuning

**Test Coverage Gaps**:
- No template matcher unit tests (templateMatcher.js:368 LOC, untested in isolation)
- No stroke grouper tests (strokeGrouper.js:147 LOC)
- No stroke cleaner tests (strokeCleaner.js:46 LOC)
- No renderer/effect tests (effects/*.js = 1200+ LOC, untested)
- No UI tests (tabs, diagnostics panels)
- No integration tests (full drawing → effect pipeline)

**Run Tests**:
```bash
npm test
```

### GitHub Pages Deploy

- Base URL: `./` allows relative imports
- Served from `dist/` after `npm run build`
- Repository: ytnrvdf/wha-spell-simulator (README.md:7)
- Live: https://ytnrvdf.github.io/wha-spell-simulator

### Asset Pipeline

- CSS: `assets/css/styles.css` (linked in index.html)
- Images: `assets/demo.gif` in README
- Favicon: `assets/favicon.ico`
- Vite handles bundling (no explicit asset loader config)

---

## 9. Tools Directory

### Stroke Template Maker

**File**: `tools/strokeTemplateMaker.js` (2898 bytes)
**Purpose**: Export normalized stroke templates for dictionary
**Workflow**:
1. Draw one clean sigil/sign on paper canvas
2. Click "Export"
3. Copies JSON `strokeTemplate` object to clipboard
4. Paste into dictionary entry

**Output format**:
```json
{
  "sourceAspectRatio": 1.12,
  "strokes": [
    [{"x": 0, "y": 0.5}, {"x": 1, "y": 0.5}]
  ]
}
```

### Stroke Template Viewer

**File**: `tools/strokeTemplateViewer.js` (4385 bytes)
**Purpose**: Visualize stored templates from JSON
**Input**: Raw `strokeTemplate` or full dictionary entry
**Output**: Reconstructed drawing + metrics (aspect ratio, stroke count, point count)
**Validation**: Detects mismatches between stored and rendered shape

### Sigil/Sign Detector Lab

**File**: `tools/sigilSignDetectorLab.js` (18238 bytes)
**Purpose**: Test recognizer on custom drawings before dictionary commit
**Workflow**:
1. Draw a candidate mark
2. Select a template from the loaded dictionary
3. Visualize raster matches, rotation trials, confidence scores
4. Inspect template match details (ink overlap, structural scores)

**Outputs**: Recognition confidence, top matches, detailed match metrics

### Spell Effect Lab

**File**: `tools/spellEffectLab.js` (17010 bytes)
**Purpose**: Tune visual effects and particle parameters
**Workflow**:
1. Draw a spell (or use preset)
2. Adjust `force`, `spread`, `focus`, `range`, `stability`, `gravity` sliders
3. Preview effect in real-time
4. Inspect particle count, emission rate, motion curves

**Export**: JSON spell IR snapshot for reference

---

## 10. Documentation in docs/

### Design Documents

- **`glyph-ast.md`** (178 lines) – parser output contract, field descriptions, example
- **`spell-ir.md`** (150 lines) – compiler output contract, behavior fields, manifestations, example
- **`dictionary-authoring.md`** (435 lines) – how to add sigils/signs/sample spells, field meanings, tools usage
- **`play-rules.md`** (50 lines) – compact behavioral rules, core shape contract, recognition terms
- **`effect-rendering.md`** (94 lines) – renderer model, element-specific behaviors, shared calculations

### Quality

All docs are comprehensive and up-to-date. AST and IR contracts include full JSON examples. Dictionary authoring covers step-by-step workflows with tool links. Play rules explicitly list what's unsupported.

---

## Top 10 Gaps / Robustness Risks (Ranked by Impact)

### 1. **No Template Matcher Unit Tests** (HIGH RISK)
   - **Impact**: Core ink-scoring logic untested in isolation. A regression in raster scoring or rotation tie-breaks could silently break recognition without test failure.
   - **File**: `src/parser/templateMatcher.js:368 LOC`
   - **Mitigation**: Add tests for `scoreStrokeTemplate()` with known candidate/template pairs, validate rotation priority (line 14: rotation order matters).

### 2. **Magic Numbers in Scoring—No Sensitivity Analysis** (HIGH RISK)
   - **Impact**: 40+ numeric tuning constants (`SPELL_PARAMETER_TUNING`, `QUALITY_TUNING`, `STABILITY_TUNING`, `RING_*_*` thresholds) with no documented basis or bounds testing.
   - **Files**: `src/config.js:16-73`, `src/compiler/spellBuilder.js:16-32`, `src/compiler/spellQuality.js:4-28`, `src/parser/ringDetector.js:15-28`
   - **Examples**:
     - Ring activation completeness floor: `0.64` (ringDetector.js:19) – why not 0.60 or 0.70?
     - Primary sigil confidence threshold: `0.62` (config.js:42) – tuned by eye?
     - Spell duration exponent: `1.45` (spellBuilder.js:31) – impacts spell lifetime nonlinearly
   - **Mitigation**: Document intent for top-10 thresholds, add sensitivity test showing how ±0.05 changes behavior.

### 3. **Ring Detection Geometry—Undocumented Circle Fitting Robustness** (HIGH RISK)
   - **Impact**: Ring is the spell boundary. If circle fitting fails or produces wrong center, all downstream symbol classification (layer assignment, radial position, direction) breaks silently.
   - **File**: `src/parser/ringDetector.js:73-128`
   - **Issue**: Gaussian elimination solve (lines 38-71) for circle fit has no condition-number check, fallback to bounds-based circle (lines 130-136) is crude, no warning if fit residual is high.
   - **Mitigation**: Log residual, test with wobbly/elliptical user drawings, add visual indicator when ring roundness is low.

### 4. **Sign Rotation Canonicalization Assumes Symmetry** (MEDIUM-HIGH RISK)
   - **Impact**: All signs are rotated into a bottom-of-ring (270°) canonical pose for template matching. If a sign's upside-down orientation has a different meaning (e.g., inverted levitation sign), the game mechanic is lost.
   - **File**: `src/parser/signRotation.js:98`, dictionary-authoring.md:243-247
   - **Issue**: No test of rotated-sign semantics. Docs note "sometimes shown inverted, unclear how this changes the effect" (signs.json).
   - **Mitigation**: Capture player intent: test if sign orientation matters before matching. Add optional `directionSensitive` flag to sign semantic.

### 5. **Line Cleanliness as Power—Implicit, Not Exposed** (MEDIUM RISK)
   - **Impact**: "Clean drawings last longer" is a core design rule (play-rules.md:24), but `neatness` → `quality` → `duration` chain is buried in utility functions. No gameplay affordance shows the player their drawing cleanliness directly affects spell power.
   - **Files**: `src/parser/ringDetector.js:270` (ring neatness), `src/parser/strokeGrouper.js:73` (candidate neatness), `src/compiler/spellQuality.js:82-92` (stability)
   - **Issue**: Player cannot easily understand why spell lifetime varies.
   - **Mitigation**: Add explicit `lineCleanlineScore` meter to UI, visualize in diagnostics.

### 6. **Contamination Risk Heuristic—Brittle Edge Cases** (MEDIUM RISK)
   - **Impact**: Symbols with extra unmatched ink marked as "contaminated" instead of "valid" (symbolRecognizer.js:205-224). If user draws a stray mark near a sigil, it can fail entire spell.
   - **File**: `src/parser/symbolRecognizer.js:205-224`
   - **Thresholds**: `contaminationRisk >= 0.62 && unexplainedInkRatio >= 0.34`, `forbiddenCellInkRatio >= 0.42`
   - **Issue**: No test of partial-overlap or intersecting-stroke scenarios.
   - **Mitigation**: Test with cluttered spells (multiple signs very close), allow tolerance for minor jitter.

### 7. **No Fallback for Unsupported Element** (MEDIUM RISK)
   - **Impact**: If sigil JSON has `element: "unknown"` or typo, compiler rejects spell entirely—no graceful fallback to fire/aura.
   - **File**: `src/compiler/spellBuilder.js:141-142`
   - **Mitigation**: Log warning, emit aura effect or default element instead of hard failure.

### 8. **Dictionary Load Failure Silent** (MEDIUM RISK)
   - **Impact**: If sigils.json or signs.json has malformed JSON or network error, canvas blocks and user sees "Dictionary load failed" with no recovery.
   - **File**: `src/main.js:127-130`
   - **Issue**: No retry logic, no inline fallback dictionary, no user guidance.
   - **Mitigation**: Add retry button, ship minimal fallback dictionary, validate JSON schema at load time.

### 9. **Particle State Not Deterministic** (LOW-MEDIUM RISK)
   - **Impact**: Renderer maintains global particle state (spellEffectRenderer.js:61) that resets when spell signature changes. If signature hash collides (unlikely but possible), old particles may leak into new spell.
   - **File**: `src/renderer/spellEffectRenderer.js:62-85`
   - **Issue**: Signature is a concatenated string, not a hash. Two different spells could theoretically have the same signature.
   - **Mitigation**: Use deterministic hash (e.g., SHA-256 of key fields) instead of string concat.

### 10. **No Bounds Checking on Configuration** (LOW RISK)
   - **Impact**: If CONFIG values are edited to invalid ranges (e.g., `minConfidence: 1.5`), parser behavior degrades silently.
   - **File**: `src/config.js:1-74`
   - **Issue**: No schema validation at startup.
   - **Mitigation**: Add `CONFIG.validate()` check in `main.js:init()`, warn on out-of-range values.

---

## Summary

The WHA Spell Simulator is a well-architected, fan-made prototype with clean separation of concerns (parser → compiler → renderer). The recognition system is **raster-template-based**, not LLM or hand-crafted features. It is **deliberately limited** (one ring, one sigil, three sign types), with unsupported features explicitly detected and rejected.

**Strengths**:
- Clear data contracts (GlyphAST, SpellIR)
- Extensible dictionary (add sigils/signs without code changes)
- Rich diagnostics (parser, AST, IR panels)
- Documented design rules and thresholds in `docs/`

**Weaknesses**:
- 40+ magic numbers with no sensitivity analysis or justification
- Limited test coverage (missing template matcher, stroke grouper, renderer, integration tests)
- Implicit mechanics ("clean drawing = longer spell" buried in `neatness` chain)
- Brittle error handling (dictionary load, unsupported elements, contamination detection)
- Ring detection robustness unvalidated against wobbly/elliptical user input

**Test Coverage**: ~30% of codebase (3 test files, ~30KB tests vs. ~5887 LOC source). Major gaps in recognition and effect rendering.

**LOC by Layer**:
- Parser: ~2400 LOC (ring, symbols, recognition)
- Compiler: ~660 LOC (quality, direction, semantics)
- Renderer: ~1100 LOC (effects, canvas)
- UI: ~380 LOC (diagnostics, panels)
- Utils/Config: ~347 LOC
- Total: ~5887 LOC (excluding tests, tools, assets)
