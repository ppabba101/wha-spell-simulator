# WHA Spell Simulator — Observability Dashboard Queries

All queries target the `judge_analytics_v1` dataset in the Cloudflare Workers Analytics Engine SQL API.
Paste each block into **Analytics Engine Explorer → SQL** or use `wrangler analytics-engine query`.

## Schema Reference

| Column        | Type   | Description                                              |
|---------------|--------|----------------------------------------------------------|
| blob1         | string | provider (groq, sambanova, anthropic)                    |
| blob2         | string | mode (fast, balanced, quality)                           |
| blob3         | string | eventKind (request, error, probe)                        |
| blob4         | string | reasonCode (ok, breaker_open, dsl_invalid, rate_limited) |
| double1       | number | HTTP status code                                         |
| double2       | number | total request duration ms                                |
| double3       | number | time-to-first-token ms                                   |
| double4       | number | 1 if circuit breaker was open, else 0                   |
| double5       | number | 1 if DSL was invalid, else 0                             |
| double6       | number | 1 if KV rate-limit was hit, else 0                      |
| double7       | number | 1 if judge↔template disagreement, else 0               |
| double8       | number | cost-per-spell estimate (USD, micro-dollars * 1e-6)     |
| index1        | string | provider (same as blob1, used for fast filtering)        |

---

## 1. Per-Provider Request Count (hourly)

```sql
SELECT
  blob1                                   AS provider,
  toStartOfHour(timestamp)                AS hour,
  count()                                 AS request_count
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '24' HOUR
GROUP BY provider, hour
ORDER BY hour DESC, provider
```
_Hourly request volume per provider over the past 24 hours._

---

## 2. Latency p50 / p95 / p99 per Provider

```sql
SELECT
  blob1                                        AS provider,
  quantile(0.50)(double2)                      AS p50_ms,
  quantile(0.95)(double2)                      AS p95_ms,
  quantile(0.99)(double2)                      AS p99_ms
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '1' HOUR
GROUP BY provider
ORDER BY provider
```
_Latency percentiles for total request duration in the last hour._

---

## 3. TTFT (Time-to-First-Token) p50 / p95 / p99 per Provider

```sql
SELECT
  blob1                                        AS provider,
  quantile(0.50)(double3)                      AS ttft_p50_ms,
  quantile(0.95)(double3)                      AS ttft_p95_ms,
  quantile(0.99)(double3)                      AS ttft_p99_ms
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '1' HOUR
  AND double3 > 0
GROUP BY provider
ORDER BY provider
```
_Time-to-first-token percentiles (excludes rows where TTFT was not recorded)._

---

## 4. Status-Code Histogram (200 / 4xx / 5xx)

```sql
SELECT
  CASE
    WHEN double1 = 200                THEN '200'
    WHEN double1 >= 400 AND double1 < 500 THEN '4xx'
    WHEN double1 >= 500               THEN '5xx'
    ELSE 'other'
  END                                          AS status_bucket,
  count()                                      AS request_count
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '1' HOUR
GROUP BY status_bucket
ORDER BY status_bucket
```
_Counts of successful, client-error, and server-error responses._

---

## 5. Circuit-Breaker Trip Rate

```sql
SELECT
  blob1                                        AS provider,
  sum(double4)                                 AS breaker_trips,
  count()                                      AS total_requests,
  round(100.0 * sum(double4) / count(), 2)     AS trip_rate_pct
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '5' MINUTE
GROUP BY provider
ORDER BY trip_rate_pct DESC
```
_Circuit-breaker trip percentage per provider in the last 5 minutes. Alert fires when > 5%._

---

## 6. DSL-Invalid Rate

```sql
SELECT
  blob1                                        AS provider,
  sum(double5)                                 AS dsl_invalid_count,
  count()                                      AS total_requests,
  round(100.0 * sum(double5) / count(), 2)     AS dsl_invalid_rate_pct
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '1' HOUR
GROUP BY provider
ORDER BY dsl_invalid_rate_pct DESC
```
_Rate of responses that failed DSL validation, per provider, in the last hour. Alert fires when > 5%._

---

## 7. Judge-Template Disagreement Rate

```sql
SELECT
  blob1                                        AS provider,
  sum(double7)                                 AS disagreement_count,
  count()                                      AS total_requests,
  round(100.0 * sum(double7) / count(), 2)     AS disagreement_rate_pct
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '1' HOUR
GROUP BY provider
ORDER BY disagreement_rate_pct DESC
```
_Rate of requests where the judge top-1 spell differs from the template top-1 spell. Alert fires when > 20%._

---

## 8. KV Rate-Limit Hit Rate

```sql
SELECT
  blob1                                        AS provider,
  sum(double6)                                 AS kv_rate_limit_hits,
  count()                                      AS total_requests,
  round(100.0 * sum(double6) / count(), 2)     AS kv_rate_limit_rate_pct
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '5' MINUTE
GROUP BY provider
ORDER BY kv_rate_limit_rate_pct DESC
```
_KV rate-limit hit percentage per provider in the last 5 minutes. Alert fires when > 10%._

---

## 9. Cost-per-Spell Estimate (Average)

```sql
SELECT
  blob1                                        AS provider,
  round(avg(double8), 6)                       AS avg_cost_usd,
  round(sum(double8), 4)                       AS total_cost_usd,
  count()                                      AS request_count
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '1' HOUR
  AND double8 > 0
GROUP BY provider
ORDER BY avg_cost_usd DESC
```
_Average and total estimated cost (USD) per spell request in the last hour._

---

## 10. Combined Health Summary (Operator Overview)

```sql
SELECT
  blob1                                                AS provider,
  count()                                              AS requests,
  quantile(0.95)(double2)                              AS p95_ms,
  round(100.0 * sum(double4) / count(), 2)             AS breaker_trip_pct,
  round(100.0 * sum(double5) / count(), 2)             AS dsl_invalid_pct,
  round(100.0 * sum(double6) / count(), 2)             AS kv_ratelimit_pct,
  round(100.0 * sum(double7) / count(), 2)             AS disagreement_pct,
  round(avg(double8), 6)                               AS avg_cost_usd
FROM judge_analytics_v1
WHERE timestamp >= now() - INTERVAL '1' HOUR
GROUP BY provider
ORDER BY provider
```
_One-row-per-provider health snapshot for the last hour._
