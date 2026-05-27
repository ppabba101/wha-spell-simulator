# Witch Hat Atelier — Canon Magic System Reference (Lane 2)

A research-grade reference for `wha-spell-simulator`. Compiled from the two community wikis (Fandom + Telepedia), the manga by Kamome Shirahama (Kodansha / DENPA), Wikipedia, and several long-form essays. Where a rule is explicit on the page it is marked **[CANON]**; where it is a strong community consensus extrapolation it is marked **[FAN]**.

---

## 1. Core Magic Rules

**Magic is drawing.** A "spell" in WHA is a *seal* (Japanese 紋章, often translated *glyph*) — a 2-D inscription that activates when its outer ring is closed [CANON, ch. 1; Fandom Magic]. Anyone who possesses witch ink and a pen can in principle cast — that is the central transgressive truth Coco stumbles into in chapter 1 [CANON, ch. 1].

The three-component anatomy of every basic glyph is:

1. **Sigil** — central element selector (fire / water / earth / wind / light, plus rarer variants).
2. **Signs / Keystones** — modifiers that decide *how* the element manifests (direction, shape, motion, intensity).
3. **Ring** — the enclosing circle. **Until the ring closes, the spell is dormant.** [CANON]

**The Day of the Pact** (in-world historical event) outlawed any magic drawn on or affecting the human body, plus magic that warps reality or causes excessive harm. The lone exception is the memory-wiping spell, used to police the Pact itself [CANON, ch. 1–3, ch. 24+]. Witches who break the Pact form **The Brimmed Caps / Brimhats** (とんがり帽子 → つば帽子), distinguished by hats with brims that hide their faces [CANON].

**The three magical "branches" referenced in the user's prompt** are not an explicit canon trichotomy. Canon distinguishes (a) *permitted magic* (everything Coco's atelier teaches), (b) *forbidden magic* (Pact-breaking body magic, transformation, teleportation onto bodies, healing, psychological manipulation), and (c) the *Memory-Erasure exception*. Some readers further subdivide forbidden magic into "body magic" vs "world-warping magic," but the wikis treat them under one umbrella [FAN — the simulator should treat "three branches" as Permitted / Forbidden-Body / Forbidden-World].

**Why magic is hidden:** Pre-Pact, magic was a tool of mass destruction. The Pointed-Hat order responded by erasing magic from common knowledge and gating it behind apprenticeship + the Pentacle of Proving (5 tests) [CANON, ch. 5+, Pentagram Test arc].

---

## 2. Spell Anatomy — Every Component

### 2.1 The Ring (boundary)
- A spell *only activates* when the ring is closed [CANON, ch. 1, ch. 3].
- An unclosed ring is dormant. This enables **prepared spells**: draw the whole glyph in advance, leave a small gap, close it with a single dot to fire [CANON; e.g. Qifrey's pre-drawn flip booklets].
- A spell can be **toggled** by drawing half the ring across two surfaces — when the surfaces touch, the ring closes and the spell fires; separating them shuts it off (e.g. shoe-sole flight spells, window-portal pairs) [CANON, ch. 6–7].
- A neatly closed ring → cleaner, longer-lived effect; a sloppy join → weak or unstable [CANON, "neatly drawn seals last longer"].

### 2.2 The Sigil (element core)
Five primary sigils: **Fire, Water, Earth, Wind, Light**. Wiki notes "light is technically a variant of fire." Additional sigil variants appear later:
- **Wind Underfoot** (footwear flight variant) [CANON, Sylph Shoes].
- **Aeriform / Air-Maintenance** sigil (sustained air bubble — Coco's underwater breathing experiment) [CANON].
- **Crystal sigil** — appears in Coco's accidental petrification glyph (forbidden) [CANON, ch. 1].
- Certain *signs* can substitute for a sigil in specialized spells (e.g. Repetition, Vision) [CANON, Signs Explained].

### 2.3 Signs / Keystones — canonical catalog
Arranged radially or bilaterally around the sigil. **Asymmetric placement still works but produces unstable spells** [CANON]. **Flipping a sign reverses its effect** [CANON — Enlarge vs Reduce, Wall-Breaker vs Integration].

Documented signs (from Fandom *Signs Explained* + manga panels):

| Sign | Function | Notes |
|---|---|---|
| **Column** | Beam/column above the glyph | Short stub typically outward. Imbalance steers the beam |
| **Dispersion** | Spreading / pouring effect | Opposite-feel to Column |
| **Levitation** | Float or move object based on orientation | Arrow side inward |
| **Convergence** | Focus to a single point, compact particles | Triangle point inward; used in Serpent's Bed of Sand |
| **Pull** | Attract matching matter | Arrows inward; angled = twisting motion |
| **Crush** | Disintegrate / re-pulverize | Earth-tested only |
| **Float** | Hold midair regardless of gravity | Distinct from Levitation |
| **Direction** | Vector control | All forward = forward, inward = up, outward = spray |
| **Diamond** | Limits effect to nearby objects | Range/aperture role |
| **Window** | Limits effect to the surface it is drawn on | Range/aperture role |
| **Collection** | Gathers ambient matter as spell fuel | Open side inward |
| **Crosshair** | Element-restrictive / cancellation | Function only partially clarified |
| **Radial** | Reduces / decays the elemental output | E.g. fire → heat only |
| **Bolt** | Manifest as discrete bolts | Volatile with direction signs |
| **Billowing** | Converts matter to cloud-like form | Tetia's Cloud spell |
| **Eye** + **Bend** + **Vision** | Triplet enabling shadow-meld / partial invisibility | Rare; appears twice |
| **Repetition** | Rewinds matter to prior state | Preserves food, cleans; can replace sigil |
| **Vision** | Light manipulation; invisibility component | Sigil-less |
| **Weave / Ribbon** | Turns solids into flexible ribbons | Invented by Richeh |
| **Enlarge / Reduce** | Grows or shrinks (corner direction) | Window/Diamond gates the target |
| **Rain** | Localized precipitation | Surrounds sigil |
| **Bird** | Magic flies as a bird-form projection | Sigil inside the sign |
| **Dancing Puppet** | Object darts mid-air, paired with wind | Coco's Flying Puppet of Diversion |
| **Animal Signs** | Decorative; no function | Zozah Peninsula motifs |

**Category mapping (helpful for the simulator):**
- *Direction*: Column, Levitation, Direction, Bolt
- *Force / Intensity*: Pull, Crush, Convergence
- *Spread / Aperture*: Dispersion, Rain, Bird, Billowing
- *Range gating*: Window (on-surface only), Diamond (nearby)
- *Duration / Stability*: Repetition (rewind), Vision (sustained light)
- *Transformation*: Enlarge/Reduce, Weave, Crush↔Integration
- *Forbidden territory*: anything drawn on a body, plus Petrification, Illusory Labyrinth, Scalewolf Curse, Twin-Bottle Spell

---

## 3. Nested Rings (the simulator's biggest gap)

This is unambiguously canon: **"It is possible to wrap a spell inside another ring and fill the gap between them with a second spell, allowing one to combine the effects of the two"** [CANON — Fandom *Magic*].

Observed rules:

- **Inner ring acts as the operative core**; the annulus between inner and outer ring carries the secondary spell that *modifies, gates, or composes with* the inner spell [CANON, multiple panels: Qifrey's modified Memory Erasure has concentric circles + dot center + hand-keystones + a disconnected inner circle and varied dot rings].
- **A line connecting two glyphs links their effects**; identical or similar linked spells *amplify* one another [CANON — *Magic* page]. Many small linked seals can exceed one big seal in equivalent area [CANON].
- **Order of evaluation** is inferred — canon doesn't give a formal rule, but examples consistently show the *outer ring* gates activation (touch it last) and the *inner ring's element* dominates while outer signs shape it [FAN extrapolation].
- **Examples in canon:**
  - *Qifrey's Memory Erasure* — concentric rings, central dot sigil, hand-keystones, dot rings [CANON, ch. 1, ch. 24].
  - *Sylph Shoes* — wind-underfoot sigil set inside a window/diamond aperture so the spell only affects the wearer's footing [CANON].
  - *Light-Reducing Spell* — light sigil enclosed by a radial decay ring [CANON, Telepedia].
  - *Coco's Painting-Stone / boat sail* (Pentagram Test) — multiple linked seals tiled across a sail [CANON, ch. 22–25].
  - *Olruggio's Glowstone Path, Link Rings, Snugstone, Phantasmal Fireball Sphere* — almost all are multi-ring contraption spells [CANON].
- A reversed sign **placed inside an outer ring of identical signs cancels the spell** [CANON].

---

## 4. Quality Modifiers (craft is the magic)

The manga is explicit that *drawing quality determines spell quality*. Direct canon statements:

- **"The quality of a spell depends on the size and neatness of its inscription. Larger seals are stronger than smaller ones, and neatly drawn seals last longer than messy ones."** [CANON, Fandom *Magic*].
- **Line cleanliness** → reliability and longevity. Wobbly lines yield unstable or sideways effects: "if the lines are curved, you're going to be pushed and pulled just like you drew it" [CANON, ch. 17, also Magic page].
- **Line length** is not stated as "longer = stronger" generally; what *is* stated is that the **size of the seal** scales power, and that **the relative line length of certain signs steers the spell** (e.g. Coco extending one stroke in a watershot turned it into a heavy jet — ch. 2/3 splash sequence) [CANON].
- **Stroke continuity** — lifting the pen mid-stroke breaks intent. Canon is implicit here: spells "fizzle or backfire" with broken strokes [CANON-adjacent, *Spells* page]. Witches train muscle memory for unbroken keystones.
- **Ink quality** — only *woodcruor*-derived ink will activate a seal. Adulterated or cursed ink → unpredictable runaway magic. Human blood mixed in → the spell "runs amok in an unpredictable direction" [CANON, ink contamination plot in Pentagram Test arc, ch. 11–13].
- **Pen quality / nib choice** — pens are called *wands*; nib width/shape changes line weight; broken or splayed nibs ruin precision [CANON, multiple panels].
- **Speed of drawing** — not a hard rule, but rushed strokes correlate with imprecision; expert witches like Qifrey draw fast *and* cleanly via muscle memory [CANON, multiple panels].
- **Closing the circle precisely** — the join point must meet; a gap = dormant, a sloppy overlap = degraded.
- **Symmetry** — radial or bilateral symmetry preferred; asymmetry "still casts, but is unstable" [CANON].
- **Balance of keystones across the ring** — "If the columns aren't balanced, the spell will manifest in the direction with the most columns" [CANON]. Coco's chapter-17 herb-restoration only partially succeeded because she'd drawn only top and bottom keystones, missing the lateral pair [CANON, ch. 17].

---

## 5. Prepared vs Active Spells

- **Active** — drawn live, ring closed in the moment.
- **Prepared / Reserved** — the glyph is drawn ahead, ring left *gapped*. A single dot of ink closes it instantly during combat. Witches carry **flip-booklets of pre-drawn glyphs** [CANON]; Qifrey, Olruggio, and the Knights Moralis all use them.
- **Embedded / Inscribed** — glyphs on objects (Sylph Shoes, Raincleaver's blade, Wingcloak, Palm Dragon Teacup, Searneedle Wand). The object becomes a *contraption* that activates by touch, motion, or pressure completing the ring [CANON].
- Visually, prepared spells appear inert (no glow); on closing, the ink momentarily glows / shimmers (typically white-silver in the manga, with hatch-shading ink wash around the seal) and the effect materializes.

---

## 6. Full Glyph / Spell Catalog (representative, by element)

From *Spells* wiki pages + manga sightings:

**Fire**: Pyreball Seal, Phantasmal Fireball (harmless training fire), Snugstone Spell, Unburning Flame, Kindle Orb.
**Water**: Rainbringer Seal, Rising Platform of Water, Rising Wave, Water Bolt, Watershot Seal, Water Horse Spell, Water Pen, Vapor Bubble (transport), Dispelling Water (keeps Qifrey dry), Rainflinger.
**Earth**: Boulder Stretch Rope, Integration (de-pulverize), Sand Bridge, Sand Cage, Serpent's Bed of Sand, Wall Breaker Seal.
**Wind**: Flying Puppet of Diversion, Grasping Wind, Skysoaring Seal, Sylph Shoes Seal, Wind Wall, Pegasus Carriage Spell, Make Air.
**Light**: Bird of Light Beacon, Floatglow Lamp, Light Beam, Light Tracer, Light-Reducing Spell.
**Cross-element / Niche**: Cloak Spell, Beast Repellent, Guard Briar Seeds (plant-growth), Memory Erasure (the legal exception), Coco's Cloud-Sand experiment.
**Forbidden (Pact-breaking)**: Anti-Scalewolf Curse, Scalewolf Curse, Illusory Labyrinth, Petrification (Coco accidentally casts this on her mother — ch. 1), Twin-Bottle's Spell, and most Brimmed-Cap body-transformation spells.

Each spell is built from `{sigil + keystone pattern}` inside one or more rings; the simulator should treat the wiki spell-pages as authoritative recipes when known.

---

## 7. Failure Modes (canon causes → canon effects)

- **Sloppy / curved lines** → spell pushes/pulls "just like you drew it"; sideways or wrong-vector manifestation [CANON, ch. 17].
- **Unclosed ring** → dormant, no activation [CANON].
- **Missing keystones / asymmetry** → "shapeless mass," reduced power, biased direction [CANON, ch. 17 powdered-herbs restoration].
- **Wrong sign** → wrong manifestation (rain instead of beam, etc.) [CANON].
- **Reversed sign** alongside non-reversed siblings → effect cancels or inverts [CANON].
- **Contaminated ink** (curse / blood) → magic "runs amok in unpredictable direction" [CANON, ch. 11–13 Brimhat sabotage; ink page warning].
- **Forbidden magic invoked** → spell may succeed but caster faces expulsion + Knights Moralis memory wipe; the spell itself often spirals (Coco's crystallization spreads to engulf the house, ch. 1) [CANON].
- **Body-targeted spell** → if successful, transforms the body (petrification, age-shift, etc.); near-impossible to reverse without the original spell or specialist intervention [CANON].
- **Drawing on a moving surface or in mid-air** → still casts if ring closes, but unstable [CANON, Qifrey's flight-pen tricks].

---

## 8. Character-Specific Styles

- **Coco** — straight-lines-and-simple-shapes specialist; conceptual thinker; tailor's eye for patterns and layering; signature improvisations (Painting Stone, sand-cloud, sail boat) [CANON, Pentagram Test arc].
- **Agott** — water mastery, glyph innovation, defensive geometry; the most "academic" of the four apprentices [CANON].
- **Tetia** — dreamy, comfort-focused magic; invented the Cloud spell (Billowing sign + wind) to nap on clouds [CANON].
- **Richeh** — micro-glyphs (extremely small, dense seals); invented the Weave/Ribbon sign; original-magic obsessive [CANON].
- **Qifrey** — water virtuoso *despite* his hydrophobia; Raincleaver (a sword inscribed with many micro-seals that part water); water-dragon and water-horse conjurations; flight via wind-shoes; uses Guard Briar Seeds for plant fortifications; uses pre-drawn flip booklets [CANON].
- **Olruggio** — fire / light / heat specialist; *contraption maker* — Glowstone Path, Snugstone, Searneedle Wand, Link Rings, Phantasmal Fireball Sphere; opens Windowways for transit; everyman-utility philosophy [CANON].
- **Easthies** — Knights Moralis leader; strict Pact enforcer; signature is overwhelming, precise erasure spells [CANON].
- **Knights Moralis** — group enforcing Day of the Pact; use erasure + restraint spells [CANON].
- **Brimhats (Iguin, Sasaran, Restis, Ininia, Coustas)** — forbidden-magic users; identity-warping, illusion, body-transformation [CANON].

---

## 9. Canon vs Fan Interpretation

**CANON (in manga/anime/official wiki):**
- 3-component anatomy (sigil + signs + ring), ring-closes-to-activate, prepared-spell gap technique, sign-flip reverses effect, nested-ring composition, linked-line amplification, line-quality/size scaling power, ink purity required, forbidden body magic, Day of the Pact, Brimhats vs Pointed Hats, Knights Moralis, the 5 elemental sigils, the specific signs and spells listed in §2 and §6.

**FAN extrapolations (commonly accepted but not stated):**
- Strict "three branches" taxonomy with named branches (canon only contrasts permitted vs forbidden).
- Formal order-of-evaluation for nested rings (canon shows examples, not rules).
- Numerical "stronger when line is longer" — canon says *size* scales power, not line length per se.
- Quantified mana / casting cost — there is **no mana system in canon**; cost is the witch's time, ink, and craft.
- Tier-based spell levels — fan RPGs add this; the manga does not.

---

## 10. Visual Style Reference

- **Line weight**: pen-and-ink, often single-weight contour with finer hatching; the simulator should support variable but predominantly thin strokes [CANON visual].
- **Ink wash**: glyphs are often drawn over a slight grey halftone wash that suggests the conjuring ink's sheen.
- **Glow on activation**: at the instant the ring closes, the ink briefly turns *silvery / pale-light* and emits radial sparks; the spell's *effect* manifests above or around the glyph and the ink itself fades back to black.
- **Paper texture**: visible tooth and grain; spells drawn on cloth, leather, glass, stone, and skin (the last being forbidden) all retain visible substrate texture.
- **Materializing animation**: matter blooms upward from the sigil, shaped by the keystones, contained by the ring — a slow "growing" effect, *not* an instant pop.
- **Brimhat aesthetic**: their forbidden glyphs are visually denser, more asymmetric, often using non-standard signs and double rings with broken outer arcs.

---

## Top 15 Unimplemented Mechanics (priority-ordered)

The current simulator supports 5 sigils + 3 signs (Column, Levitation, Convergence) and a single ring. The biggest gaps are:

1. **Nested / concentric rings** with annular sign-zones and composition rules (canon's largest unmodelled feature).
2. **Spell linkage by line** — connect two seals, amplify if similar; build "spell circuits".
3. **Prepared-spell gap closure** — draw a glyph with an open ring; close with a dot to fire (a UI verb the sim currently lacks).
4. **Toggle spells across two surfaces** — split-ring activation (shoe-soles, twin-window portals).
5. **Sign-flip = effect-reverse** — a single transform that inverts a placed sign's polarity (Enlarge↔Reduce, Wall-Breaker↔Integration).
6. **Expanded sign vocabulary** — at minimum add Dispersion, Pull, Crush, Direction, Diamond, Window, Collection, Bolt, Billowing, Rain, Bird, Repetition, Vision, Weave, Enlarge/Reduce, plus Eye/Bend triplet.
7. **Sigil variants** — Wind-Underfoot, Aeriform, Crystal, plus the "sign-as-sigil" replacements (Repetition, Vision).
8. **Quality scoring**: line cleanliness, stroke continuity (pen-lift = penalty), closure-precision of the ring, symmetry/balance check, overall size → power, neatness → duration.
9. **Ink model** — pure / diluted / additive / contaminated (blood, cursed). Adulteration → runaway effect.
10. **Balance-of-keystones evaluation** — bias the manifestation direction toward the side with more weighted signs (ch. 17 mechanic).
11. **Forbidden-magic detection** — flag spells drawn on a "body" surface or invoking petrification/transformation; show Knights-Moralis-style failure state and erasure.
12. **Failure-mode mapping**: curved lines → lateral push; missing keystones → shapeless output; broken stroke → fizzle/backfire; gap in ring → dormant.
13. **Glow-on-closure animation** — ring closure should trigger a silver-glow flash + materializing effect tied to the keystone vector field.
14. **Spell embedding on objects** — let users tag a seal as "inscribed" on a contraption (shoe, sword, lamp) so it activates on a trigger condition.
15. **Spell library of canonical recipes** — preloaded glyphs (Pyreball, Watershot, Wall Breaker, Sylph Shoes, Snugstone, Memory Erasure-modified, etc.) as both reference and recognition targets.

---

## Open Canon Questions

- **Formal nested-ring evaluation order** — manga shows it works; doesn't formalize. The simulator must pick a convention (recommend: inner sigil supplies element; annular signs modify; outer ring is the activation gate).
- **What exactly the "three branches" are** — fan term; manga only distinguishes permitted vs forbidden. Treat carefully.
- **How "size" exactly scales power** — proportional? logarithmic? Canon is qualitative.
- **Whether "longer line = stronger" applies generally** — canon shows it for individual sign strokes (the Watershot incident) but not as a universal rule.
- **What the Crosshair, Radial, Diamond, and Window signs precisely do** — wiki marks function as partly inferred.
- **Whether non-witches can cast** with stolen ink — canon ambiguous; Coco does cast in ch. 1, but the Pact treats this as a crime, not an impossibility.
- **The complete Brimhat sign-set** — Brimhats use signs not in standard atelier curricula; these have not been comprehensively catalogued.
- **Air / ambient drawing** — Qifrey appears to write briefly in air; the rules for non-paper substrates are mostly visual, not spelled out.

---

## Sources

- Witch Hat Atelier Wiki (Fandom) — *Magic*, *Spells*, *Signs Explained*, *Forbidden Magic*, *Conjuring Ink*, *Qifrey*, *Olruggio*, *Coco*, *Knights Moralis*, *Silverwood Tree*, *Memory Erasure*. (Accessed via `translate.goog` mirror.) https://witch-hat-atelier.fandom.com/wiki/Magic
- Witch Hat Atelier Independent Wiki (Telepedia) — parallel articles. https://witchhatatelier.telepedia.net/wiki/Magic
- Wikipedia — *Witch Hat Atelier*, *List of Witch Hat Atelier characters*, *List of Witch Hat Atelier chapters*. https://en.wikipedia.org/wiki/Witch_Hat_Atelier
- GameRant — *Witch Hat Atelier's Magic System, Explained*. https://gamerant.com/witch-hat-atelier-magic-system-explained/
- FandomWire — *WHA Power System Explained: What Are Magic Glyphs*. https://fandomwire.com/witch-hat-atelier-power-system-explained-what-are-magic-glyphs-how-do-they-work/ and *All Qifrey Powers and Abilities*. https://fandomwire.com/witch-hat-atelier-all-qifrey-powers-and-abilities-explained/
- AnimeFocusNetwork — *Magic System Explained: How Spells Really Work*. https://www.animefocusnetwork.net/post/witch-hat-atelier-magic-system-explained-how-spells-really-work
- AniThreadz — *How the Witch Hat Atelier Magic System Actually Works*. https://www.anithreadz.com/blog/how-the-witch-hat-atelier-magic-system-actually-works
- Aniflixy — *How to Draw Spells in Witch Hat Atelier*. https://aniflixy.com/how-to-draw-spells-in-witch-hat-atelier-guide-to-magic-glyphs-and-symbols/
- Mystiqora — *Definitive Guide to WHA Artifacts and Contraptions*. https://mystiqora.com/magic-symbols-and-tinkering-the-definitive-guide-to-witch-hat-atelier-artifacts-and-contraptions/
- MangaCraft Substack — *Witch Hat Atelier: Unique Magic Systems*. https://mangacraft.substack.com/p/witch-hat-atelier-unique-magic-systems
- The Comics Journal — *Witch Hat Atelier: The Work of Art* (reference; access restricted). https://www.tcj.com/witch-hat-atelier-the-work-of-art/
- The Oblivious Prattler — *WHA Spell Maker (fanmade)* review. https://theobliviousprattler.wordpress.com/2026/05/02/witch-hat-atelier-tongari-boushi-no-atelier-spell-maker-fanmade/
- TV Tropes — *Witch Hat Atelier* and *Recap S1E1*. https://tvtropes.org/pmwiki/pmwiki.php/Manga/WitchHatAtelier
- Kodansha — official series page and chapter 1 reader. https://kodansha.us/series/witch-hat-atelier/

Word count: ~3,200.
