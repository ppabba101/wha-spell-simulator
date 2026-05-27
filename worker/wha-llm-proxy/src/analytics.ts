/**
 * Workers Analytics Engine emitter. Records per-request metrics so the M8a
 * dashboard can compute p50/p95/p99, breaker-trip rates, dsl-invalid rates,
 * rate-limit hits, judge-template-disagreement, and cost-per-spell estimates.
 *
 * Schema (Analytics Engine writeDataPoint contract):
 *   blobs:   [provider, mode, eventKind, reasonCode]
 *   doubles: [statusCode, durationMs, ttftMs, breakerTrip, dslInvalid, rateLimited, judgeTemplateDisagreement]
 *   indexes: [provider]
 */

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
        rec.judgeTemplateDisagreement ? 1 : 0
      ],
      indexes: [rec.provider ?? "n/a"]
    });
  } catch {
    // Analytics must never break the request path.
  }
}
