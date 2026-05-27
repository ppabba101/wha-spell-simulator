# Open Questions — WHA v0.2

## ralplan-wha-v02 — 2026-05-26

- [ ] **Provider primary inversion (Groq vs SambaNova)** — Spec says "SambaNova primary"; ralplan recommends Groq primary on AC-P2 latency grounds. Architect must ratify or override before M2 starts. — Determines provider module priority and budget assumptions.
- [ ] **Worker hosting region** — Cloudflare Workers run at edge but provider endpoints are regional. Need to confirm Groq's US/EU TTFT before locking the AC-P2 measurement methodology. — Affects whether AC-P2 mocked tests in M2 reflect reality (Pre-mortem A).
- [ ] **Nested-ring composition convention** — Spec assumption #2: "inner = element, annular = modifiers, outer = activation gate." This is a fan extrapolation; canon shows examples, not rules. Confirm with user this is the v0.2 commitment vs leaving it tunable. — Drives M4 compose logic.
- [ ] **Line-length cap value** — Spec assumption #4 caps length-to-power at "some max" but doesn't specify. Plan proposes 2.5× normalised. Needs sensitivity test in M5 and user sign-off. — Determines power-scaling ceiling.
- [ ] **User-key trust documentation** — Spec assumption #7 trusts user-supplied keys to `localStorage`. Needs explicit user-facing disclosure copy in the settings panel. — Compliance/UX text in M3.
- [ ] **Stretch tier ordering** — M9 lists 4 stretch features (AC-S1–S4). If M1–M8 ship early and only one of the four can be done, which one? — Roadmap prioritisation.
- [ ] **`spellBuilder.js` micro-refactor in M4** — Plan flags that M4+M5+M6+M7 all amend this file; recommends splitting into `compose.js` + `quality.js` + `params.js`. Architect: ratify before M4 begins or after M4 ships? — Affects M4 effort estimate.
- [ ] **Sensitivity test framework** — Principle 5 mandates per-retune sensitivity tests but no global sweep is planned. Is a one-time sweep across all 40 magic numbers worth a tracked task in M8? — Test infrastructure scope.
