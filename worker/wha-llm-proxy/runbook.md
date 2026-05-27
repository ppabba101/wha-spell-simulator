# WHA Spell Simulator — Ops Runbook

This runbook covers each alert defined in `alerts.toml`. For each alert: what it means, what to check, and what to do.

---

## Alert: `breaker_trip_rate_5min`

**Condition:** Circuit-breaker trip rate > 5% in any 5-minute window.

**What it means:** More than 1-in-20 requests are hitting a tripped circuit breaker. The breaker opens after `BREAKER_TRIP_THRESHOLD` consecutive upstream errors (default: 3). A high trip rate indicates sustained upstream provider failure.

**What to check:**
1. Look at the per-provider breakdown in the dashboard (Query #5) to identify which provider(s) are failing.
2. Check Groq / SambaNova / Anthropic status pages for ongoing incidents.
3. Look at `double1` (status code) distribution — are upstream responses returning 5xx?
4. Check Worker logs (`wrangler tail`) for upstream error messages.

**What to do:**
- If a single provider is tripping: mark it degraded and shift traffic to alternatives by updating `PROVIDER_PRIORITY` env var.
- If all providers are tripping: check network egress from Workers (Cloudflare status page).
- Once the upstream recovers the breaker will probe after `BREAKER_PROBE_INTERVAL_MS` (default: 60s) and self-heal.
- If the breaker is stuck open after recovery, redeploy the Worker to reset in-memory state.

---

## Alert: `dsl_invalid_rate_1hr`

**Condition:** DSL-invalid rate > 5% over 1 hour.

**What it means:** More than 1-in-20 LLM responses fail the DSL schema validator (`dslValidator`). This typically indicates prompt drift — a model update changed the output format.

**What to check:**
1. Run the DSL-invalid rate query (dashboard Query #6) grouped by `blob1` (provider) to isolate which provider changed.
2. Sample recent raw LLM responses from Worker logs (`wrangler tail --format=json | jq 'select(.blob4 == "dsl_invalid")'`).
3. Compare the malformed output against the current prompt template in `src/index.ts`.

**What to do:**
- If one provider regressed: temporarily disable that provider and create a prompt fix PR.
- If all providers regressed: a change to the prompt template itself likely introduced the regression — revert the prompt change.
- After fixing: watch the DSL-invalid rate drop below 1% before closing the incident.

---

## Alert: `latency_p95_5min`

**Condition:** p95 total request latency > 1500 ms in any 5-minute window.

**What it means:** The slowest 5% of requests are taking more than 1.5 seconds. This is above the interactive spell-preview SLA.

**What to check:**
1. Run TTFT query (dashboard Query #3) — is the latency in the network round-trip or in post-processing?
2. Check per-provider p95 (dashboard Query #2) to isolate the slow provider.
3. Check Cloudflare Worker CPU time in the dashboard — are we hitting CPU limits?
4. Look for large payloads: high `double2` (duration) with low `double3` (ttft) suggests slow streaming or response assembly.

**What to do:**
- If a single provider is slow: deprioritise it temporarily; load shifts to faster providers.
- If all providers are slow: check upstream API latency via provider status pages.
- If CPU time is the bottleneck: profile the response assembly path in `src/index.ts`; DSL parsing may be slow for large responses.
- Consider enabling streaming pass-through mode to reduce perceived latency.

---

## Alert: `judge_template_disagreement_rate`

**Condition:** Judge↔template disagreement rate > 20% over 1 hour.

**What it means:** For more than 1-in-5 requests, the spell the LLM judge picks as top-1 differs from what the template system would pick. This signals potential quality regression in the judge model or a prompt that no longer aligns with the template corpus.

**What to check:**
1. Run the disagreement rate query (dashboard Query #7) per provider — is it one model or all?
2. Pull recent disagreement samples: Worker logs will have `guess` and `template_top1` fields when `double7 == 1`.
3. Check whether a prompt template was recently updated (git log on `src/prompts/`).
4. Cross-reference with the `bench/recognize.js` CI benchmark results for quality regression.

**What to do:**
- If one provider has elevated disagreement: review that provider's recent model changelog for silent updates.
- If a prompt was recently changed: run `npm run bench:recognize` to compare quality against baseline.
- If disagreement exceeds 30%: consider rolling back the prompt change and filing a quality investigation issue.
- Add golden test cases covering the disagreeing spells to prevent future regression.

---

## Alert: `kv_rate_limit_hit_rate`

**Condition:** KV rate-limit hit rate > 10% in any 5-minute window.

**What it means:** More than 1-in-10 incoming requests are being rate-limited at the KV namespace level. Users are seeing 429 responses.

**What to check:**
1. Run the KV rate-limit query (dashboard Query #8) — is it uniform across providers or concentrated on one?
2. Check current `RATE_LIMIT_PER_MIN` in wrangler.toml (default: 10 requests/minute/user).
3. Look at request volume (dashboard Query #1) — is there unusual traffic or a client loop?
4. Check KV read/write quotas in the Cloudflare dashboard (Workers → KV → Usage).

**What to do:**
- If it's a traffic spike from legitimate users: increase `RATE_LIMIT_PER_MIN` via `wrangler secret put` or update `wrangler.toml` `[vars]`.
- If it's a client bug or abuse: identify the IP/user from Worker logs and consider a WAF rule.
- If KV quota is exhausted: upgrade the KV plan or shard rate-limit keys across multiple namespaces.
- After changing `RATE_LIMIT_PER_MIN`, redeploy and watch the rate-limit hit rate drop within 1 minute.
