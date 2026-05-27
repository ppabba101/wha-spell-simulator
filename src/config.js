export const CONFIG = {
  // String version tag shown in diagnostics.
  appVersion: "0.1.0-poc",
  input: {
    // Canvas pixels; lower keeps more pointer samples, higher smooths noisy input.
    minPointDistance: 1.4,

    // Canvas pixels; strokes shorter than this are ignored.
    minStrokeLength: 7,

    // Integer passes, usually 0..3; set to 0 to use raw points.
    // Higher softens hand jitter but can distort sharp symbols.
    smoothingPasses: 1
  },
  ring: {
    // Canvas pixels; smallest ring radius accepted as spell paper boundary.
    minRadius: 70
  },
  // spell ring layer (three layers); sigils are usually in the center layer
  layers: {
    // 0..1 normalized radius; center symbol area.
    centerMax: 0.32,

    // 0..1 normalized radius; middle symbol area.
    middleMax: 0.66,

    // 0..1 normalized radius; outer sign area.
    outerMax: 0.94,

    // 0..1 normalized radius; strokes beyond this are outside the spell boundary.
    boundaryMax: 1.06,

    // 0..1 normalized radius; marks symbols close to layer edges as ambiguous.
    boundaryTolerance: 0.055
  },
  recognition: {
    // 0..1 final recognizer score floor.
    minConfidence: 0.48
  },
  compiler: {
    // 0..1 confidence; minimum primary sigil confidence before a spell is valid.
    minimumPrimarySigilConfidence: 0.62,

    // Count; unknown symbols above this increase instability.
    maxUnknownsBeforeInstability: 4
  },
  renderer: {
    // CSS color; drawn ink color.
    inkColor: "#241b16",

    // CSS color; guide line color.
    guideColor: "rgba(92, 74, 54, 0.28)",

    // Count; default effect particle budget before element-specific scaling.
    particleBaseCount: 130,

    // Count; hard cap for effect particles.
    particleCap: 360,

    effectSize: {
      // 0..1+ multiplier; baseline effect size even for compact sigils.
      baseScale: 1.28,

      // Multiplier added from primary sigil sizeNorm; larger sigils produce larger effects.
      sigilSizeInfluence: 2.1,

      // 0..1+ multiplier; lower visual effect scale clamp.
      minScale: 1,

      // 0..1+ multiplier; upper visual effect scale clamp.
      maxScale: 2.35
    }
  },
  // M2 — LLM judge orchestration. Disabled by default; opt-in via localStorage
  // key `wha.llmJudge.enabled === 'true'` until M3 wires the settings panel.
  llmJudge: {
    // Master switch; M2 leaves this off so the existing template path is unchanged.
    enabled: false,

    // Worker proxy endpoint. Cross-origin requires the M2 CSP `connect-src` widening.
    proxyUrl: "/api/judge",

    // 'parallel' | 'groq-only' | 'sambanova-only' | 'smolvlm-offline'.
    mode: "parallel",

    // ms; Groq head-start guard before SambaNova is force-aborted on trivial recognitions.
    groqHeadStartMs: 60,

    // Bits; minimum Hamming distance on dHash before a resubmit is allowed.
    diffThreshold: 6,

    // ms; safety-net continuous-draw submission while pen is down.
    idleTickMs: 750,

    // ms; pointer-up debounce before submission fires.
    debounceMs: 150,

    // Bool; if true, judge fires even on confident template matches (template top-1 >= 0.85).
    alwaysCritique: false,

    // Map { groq, sambanova, anthropic } => API key strings (populated by M3 settings panel).
    userKeys: {},

    // 0..1; template top-1 below this triggers the judge.
    judgeTriggerThreshold: 0.85
  }
};
