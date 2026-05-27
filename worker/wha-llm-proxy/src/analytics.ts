/**
 * Workers Analytics Engine emitter. Records per-request metrics so the M8a
 * dashboard can compute p50/p95/p99, breaker-trip rates, dsl-invalid rates,
 * rate-limit hits, judge-template-disagreement, and cost-per-spell estimates.
 *
 * Schema (Analytics Engine writeDataPoint contract):
 *   blobs:   [provider, mode, eventKind, reasonCode]
 *   doubles: [statusCode, durationMs, ttftMs, breakerTrip, dslInvalid,
 *             rateLimited, judgeTemplateDisagreement, costPerSpellUsd]
 *   indexes: [provider]
 *
 * judgeTemplateDisagreement is a derived metric: logged as 1 when the
 * caller has already compared judge top-1 vs template top-1 and found a
 * mismatch. The dashboard computes the disagreement rate from this field.
 */

/** Input/output token rates in USD per 1 million tokens: [input, output]. */
const PROVIDER_RATES: Record<string, [number, number]> = {
  groq:       [0.20, 0.60],
  sambanova:  [0.63, 1.80],
  anthropic:  [5.00, 25.00],
};

/**
 * Estimate cost in USD for a single request.
 * Returns 0 when token counts are unavailable.
 */
export function estimateCost(
  provider: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = PROVIDER_RATES[provider.toLowerCase()];
  if (!rates || !inputTokens || !outputTokens) return 0;
  return (inputTokens * rates[0] + outputTokens * rates[1]) / 1_000_000;
}

export interface AnalyticsRecord {
  provider: string;
  status: number;
  durationMs: number;
  ttftMs: number;
  mode: string;
  breakerOpen?: boolean;
  dslInvalid?: boolean;
  rateLimited?: boolean;
  judgeTemplateDisagreement?: boolean;
  reasonCode?: string;
  eventKind?: string;
  /** Pre-computed cost (USD). Use estimateCost() to derive from token counts. */
  costPerSpellUsd?: number;
}

export interface AnalyticsBinding {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface AnalyticsEnv {
  JUDGE_ANALYTICS: AnalyticsBinding;
}

export function emitAnalytics(env: AnalyticsEnv, rec: AnalyticsRecord): void {
  try {
    env.JUDGE_ANALYTICS.writeDataPoint({
      blobs: [
        rec.provider ?? "n/a",
        rec.mode ?? "n/a",
        rec.eventKind ?? "request",
        rec.reasonCode ?? "ok"
      ],
      doubles: [
        rec.status ?? 0,
        rec.durationMs ?? 0,
        rec.ttftMs ?? 0,
        rec.breakerOpen ? 1 : 0,
        rec.dslInvalid ? 1 : 0,
        rec.rateLimited ? 1 : 0,
        rec.judgeTemplateDisagreement ? 1 : 0,
        rec.costPerSpellUsd ?? 0
      ],
      indexes: [rec.provider ?? "n/a"]
    });
  } catch {
    // Analytics must never break the request path.
  }
}
