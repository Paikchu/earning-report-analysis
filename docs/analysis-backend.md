# Analysis Backend — architecture decision, API guide, and runbook

The Pipeline Worker is now an independently consumable **financial analysis backend**. It owns
ingestion, analysis execution, publication, storage, and — new here — the read API that serves
published results. The Web Worker is one client of that API; any other service can be another.

This document is the decision record, the consumer-facing API guide, and the rollout/rollback
runbook. Operational detail that is not specific to the backend stays in
[`deploy.md`](deploy.md); the analysis pipeline's internals stay in
[`pipeline-and-data-access.md`](pipeline-and-data-access.md) and
[`sec-workflow-architecture.md`](sec-workflow-architecture.md).

---

## 1. Architecture decision

### 1.1 Service ownership

```text
Web Worker ───── Service Binding ──┐
                                   ├──► Analysis backend (Pipeline Worker)
Other services ──── HTTPS ─────────┘        │
                                            ├─ read API  ──► published D1 results
                                            └─ Cron / protected control endpoints
                                                            ──► Workflows ──► validation & publication
```

Two Workers, one repository, unchanged deployment units and unchanged production names. "Analysis
backend" is a role, not a rename: the Worker is still `earning-report-analysis-sec-pipeline`, the
database is still `earning-report-analysis-sec-web`, the bucket is still
`earning-report-analysis-sec-filings`, and every Workflow class and binding keeps its name.

**The backend owns the financial-analysis data model and its migrations.** The Web Worker has no D1
binding, no R2 binding, no repository import and no analysis-execution import. Every financial read
it performs — including server-side rendering — goes through the backend client.

### 1.2 Two transports, one implementation

An internal Service Binding request and an external HTTPS request reach
`handleAnalysisReadRequest` identically. Nothing in that handler consults the transport, the
hostname, the `Origin`, or any caller-supplied "internal" header. Only `Authorization` decides.

This is deliberate. The backend's `fetch` handler is publicly reachable, so treating "arrived over
the binding" as proof of trust would have handed the open internet an authentication bypass. The
Web Worker therefore holds a real read credential and presents it like anybody else.

The transport is HTTP rather than an RPC surface for the same reason: the Service Binding already
carries `fetch`, so one request builder, one set of handlers and one set of response bodies serve
both. An RPC API would have forked the business logic into two shapes.

### 1.3 What is shared, and what is not

| Shared (`lib/analysis-contract/`) | Backend-only |
|---|---|
| Wire types, error codes and scopes | `workers/pipeline/read-api/**` (router, auth) |
| JSON Schemas + the OpenAPI document | `lib/sec-public-api.ts`, `lib/fundamentals-api.ts`, `lib/company-analysis/api.ts` |
| `AnalysisBackendClient` (server-only) | `lib/sec-d1.ts`, `lib/fundamentals-d1.ts`, `lib/company-analysis/repository.ts` |
| — | `db/schema.ts`, `db/fundamentals-schema.ts`, `workers/pipeline/migrations/**` |

The shared module is runtime-neutral: no repository, no database binding, no Next.js, no React, no
`cloudflare:workers`, no model provider. `tests/analysis-boundary.test.ts` enforces both halves —
it walks the whole import graph from every Web entry point, so an indirect dependency through a
shared module fails the build just as a direct one does.

### 1.4 Compatibility proxies

The Web Worker's `/api/v1/*` routes remain, as thin proxies. Their URLs, successful response
structures, pagination semantics and anonymous browser access are unchanged. No existing consumer
has to obtain a credential.

### 1.5 Auth separation

| Credential | Held by | Authorises |
|---|---|---|
| `ANALYSIS_READ_KEYS` (backend) / `ANALYSIS_READ_TOKEN` (a consumer) | backend + every reader | reads only |
| `SEC_REFRESH_KEY` | backend + Web's admin routes | refresh, backfill, fundamentals sync |
| `SEC_ADMIN_TOKEN` | Web's admin routes | the admin routes themselves |

A read credential cannot reach a control operation: the control handlers consult `SEC_REFRESH_KEY`
and never the read-key list. Read credentials are never distributed to browsers.

### 1.6 Status and version semantics

Three things were all called "version" before, and they are now named separately:

| Field | Means | Example |
|---|---|---|
| `apiSchemaVersion` | the **HTTP contract** | `analysis-api.v1` |
| `schemaVersion` | one resource's **payload schema** (pre-existing, unchanged) | `fundamentals-api.v1` |
| `reportVersion` | a filing report's **content revision**, as `<analysis schema>:<hash>` | `sec-analysis.v2:aaaa1111` |
| `analysisSchemaVersion` / `contentRevision` | the two halves of the above, split out | `sec-analysis.v2` / `aaaa1111` |
| `versions.model` / `versions.prompt` | **internal pipeline** version *labels* | `glm-5.3-flash` |

And published result is reported separately from latest run:

| Situation | `status` (company) / `analysisStatus` (filing) | `latestRun` / `analysisRun` |
|---|---|---|
| 1. nothing published, no history | `unavailable` / `not_collected` | `none` |
| 2. first run queued or running | `unavailable` / `processing` | `queued` \| `running` |
| 3. first run failed | `unavailable` / `not_collected` | `failed` + `errorCode` |
| 4. published, newer run in flight | `updating` / unchanged | `queued` \| `running` |
| 5. published, newer run failed | `ready` / unchanged | `failed` + `errorCode` |
| 6. newly validated result published | `ready` / `complete`\|`partial` | `succeeded` |

`none` means the backend looked and found no history. `unknown` means run history could not be
read — absence of knowledge, not knowledge of absence. A known failure is **never** reported as
"never collected" and nothing else.

### 1.7 Publication semantics

Audited before anything was changed, and kept:

- A SEC report, its filing summary and its memory job commit through a single `D1.batch`. A
  `verificationStatus: "failed"` report is refused at publication and filtered out at read.
- A company analysis publishes with one `INSERT … ON CONFLICT DO UPDATE … WHERE status <> 'ready'`
  statement, is immutable once ready, and is read newest-revision-first — so an older run finishing
  later cannot displace a newer published revision.
- R2 artefacts are written before the D1 commit and are never read by the query path, so a partial
  R2 write cannot reach a reader. D1 and R2 are **not** assumed to share a transaction.

The one fix this refactor made is on the *read* side: `getPublishedReport` used to catch every
error and return `null`, so a D1 outage was served to readers as "this filing has no analysis". It
now propagates, and the router answers 503.

### 1.8 Deployment order

Backend first, Web second, cleanup last. See §5.

---

## 2. The read API

Base URL: the backend Worker's origin. Full machine-readable contract:
`GET /api/v1/openapi.json` (the only unauthenticated resource).

```text
GET /api/v1/companies/:ticker/filings?cursor=&limit=       scope filings:read
GET /api/v1/companies/:ticker/filings/:accession           scope filings:read
GET /api/v1/companies/:ticker/analysis                     scope analysis:read
GET /api/v1/companies/:ticker/fundamentals?metrics=&periodCount=   scope fundamentals:read
GET /api/v1/openapi.json                                   public
GET /health                                                liveness
GET /ready                                                 dependency readiness
```

**A read never writes.** No endpoint above calls a model, fetches from SEC or Yahoo, creates a
Workflow, enqueues a refresh, or writes business data — helpers included.

### 2.1 Authentication

```http
Authorization: Bearer <keyId>.<secret>
```

### 2.2 Status codes

| Code | Meaning | Example `code` |
|---|---|---|
| 200 | data, or a documented absence (empty list, `status: "unavailable"`, `status: "pending"`) | — |
| 304 | revalidated; only after authentication and scope | — |
| 400 | malformed ticker, accession, cursor, limit, metrics, period count, or an oversized request | `INVALID_CURSOR` |
| 401 | missing, malformed, unknown or revoked credential | `UNAUTHORIZED` |
| 403 | valid credential, insufficient scope | `FORBIDDEN_SCOPE` |
| 404 | unknown resource | `FILING_NOT_FOUND`, `FUNDAMENTALS_NOT_AVAILABLE`, `ROUTE_NOT_FOUND` |
| 405 | anything but GET/HEAD | `METHOD_NOT_ALLOWED` |
| 429 | per-credential rate limit | `RATE_LIMITED` |
| 503 | storage unavailable, or read auth not configured | `STORAGE_UNAVAILABLE`, `READ_AUTH_NOT_CONFIGURED` |

A storage failure is **never** returned as an empty successful result.

### 2.3 Response examples

All example data below is synthetic.

`GET /api/v1/companies/MSFT/filings?limit=1`

```json
{
  "apiSchemaVersion": "analysis-api.v1",
  "ticker": "MSFT",
  "company": { "ticker": "MSFT", "name": "Example Corp", "cik": "0000789019" },
  "filings": [
    {
      "accessionNumber": "0000000001-26-000001",
      "ticker": "MSFT",
      "companyName": "Example Corp",
      "form": "10-K",
      "filingDate": "2026-07-30",
      "reportDate": "2026-06-30",
      "description": "10-K",
      "summary": { "headline": "Example headline", "bullets": [], "analystView": "", "generatedAt": "2026-07-31T00:00:00.000Z" },
      "analysis": {
        "periodId": "MSFT:2026-06-30:annual",
        "reportVersion": "sec-analysis.v2:aaaa1111",
        "keyMetrics": [
          { "metricKey": "revenue", "currentValue": "1,000", "yoy": "+10%", "status": "verified", "evidenceIds": ["ev-1"] }
        ],
        "dataQuality": { "coverage": 1, "verificationStatus": "verified", "warnings": [] }
      },
      "analysisStatus": "complete",
      "reportVersion": "sec-analysis.v2:aaaa1111",
      "edgarUrl": "https://www.sec.gov/Archives/.../index.htm",
      "documentUrl": "https://www.sec.gov/Archives/.../primary.htm",
      "provenance": "sec_edgar",
      "periodId": "MSFT:2026-06-30:annual",
      "analysisSchemaVersion": "sec-analysis.v2",
      "contentRevision": "aaaa1111",
      "analysisRun": { "state": "succeeded", "updatedAt": "2026-07-31T10:00:00.000Z", "errorCode": null }
    }
  ],
  "nextCursor": "eyJmaWxpbmdEYXRlIjoiMjAyNi0wNy0zMCJ9",
  "total": 5,
  "checkedAt": null
}
```

`GET /api/v1/companies/MSFT/analysis` — a published result with a newer run that failed (scenario 5):

```json
{
  "apiSchemaVersion": "analysis-api.v1",
  "schemaVersion": "company-analysis.v1",
  "ticker": "MSFT",
  "status": "ready",
  "analysisId": "company:MSFT:analysis-1",
  "period": { "periodId": "MSFT:2026-06-30:quarterly", "periodEnd": "2026-06-30", "label": "FY2026 Q4" },
  "generatedAt": "2026-07-01T00:00:00.000Z",
  "coverageStatus": "complete",
  "overview": {
    "label": "Business outlook",
    "headline": "Example headline",
    "introduction": "Example introduction.",
    "highlights": [
      { "ordinal": "01", "title": "Example highlight", "body": "Example body.", "evidenceRefs": ["evidence-1"] }
    ]
  },
  "latestRun": { "state": "failed", "updatedAt": "2026-09-02T00:00:00.000Z", "errorCode": "VALIDATION_REJECTED" },
  "versions": {
    "apiSchema": "analysis-api.v1",
    "payloadSchema": "company-analysis.v1",
    "contentRevision": "input-hash-0001",
    "model": "example-model.v1",
    "prompt": "company-analysis-skill.v2"
  }
}
```

Error envelope:

```json
{ "apiSchemaVersion": "analysis-api.v1", "error": "SEC filing not found.", "code": "FILING_NOT_FOUND" }
```

### 2.4 Caching

Backend responses are `private, max-age=30, must-revalidate` with a weak `ETag` derived from the
whole body — status metadata included, so a changed run state invalidates the representation.
Absence and non-terminal states are `no-store`. Authentication and scope are checked before any 304.

The Web proxy widens genuinely public payloads to `public, max-age=30, stale-while-revalidate=300`
and keeps `no-store` where the backend said `no-store`. CORS (`access-control-allow-origin: *`) is
set on those public routes only, and is not authentication.

### 2.5 Rate limits

Two Cloudflare `ratelimits` bindings, both real distributed limiters:

| Binding | Worker | Key | Default |
|---|---|---|---|
| `ANALYSIS_READ_RATE_LIMIT` (`namespace_id` 1001) | backend | credential `keyId` | 600 / 60s |
| `PUBLIC_API_RATE_LIMIT` (`namespace_id` 1002) | Web | `cf-connecting-ip` | 120 / 60s |

There is no in-memory fallback. A missing limiter is reported by `/ready`, not simulated.

### 2.6 Freshness

Reading fundamentals **does not** schedule a refresh. Refresh happens in two places:

1. The backend's Cron sweep (`runFundamentalsStalenessSweep`), which refreshes tracked tickers whose
   last successful fetch is missing or older than 24 hours, at most 2 per tick.
2. The authenticated admin endpoint `POST /fundamentals/refresh/:ticker` with `x-sec-refresh-key`.

`refresh.recommended` still reports staleness; `refresh.scheduled` is always `false`, and
`refresh.mode` is `"backend_scheduled"`.

### 2.7 Consuming it

See [`examples/analysis-backend-consumer.mjs`](../examples/analysis-backend-consumer.mjs) — a
standalone script that imports nothing from this repository.

```bash
ANALYSIS_API_URL="https://<analysis-backend-host>" ANALYSIS_READ_TOKEN="<keyId>.<secret>" node examples/analysis-backend-consumer.mjs MSFT
```

---

## 3. Credentials

### 3.1 Format

`ANALYSIS_READ_KEYS` is a **runtime secret** on the backend. Entries are separated by commas or
newlines; fields by colons; scopes within an entry by `|`:

```text
<keyId>:<secret>:<scope>|<scope>
```

- `keyId` — `[A-Za-z0-9_-]{2,64}`, identifies the consumer in logs and rate limits.
- `secret` — at least 24 characters of randomness.
- scopes — `filings:read`, `analysis:read`, `fundamentals:read`, or `*` for all.

A malformed list is rejected outright rather than having the bad entry skipped, so a typo fails a
deploy instead of silently revoking somebody.

### 3.2 Creating one

```bash
# Generate a secret. Keep it out of shell history in a real terminal.
openssl rand -base64 32 | tr -d '=+/' | cut -c1-40
```

```bash
printf %s '<keyId>:<secret>:*,<other-keyId>:<other-secret>:filings:read|fundamentals:read' | npx wrangler secret put ANALYSIS_READ_KEYS --config workers/pipeline/wrangler.jsonc --env=""
```

Give the consumer `<keyId>.<secret>` — the two joined by a dot — as its `ANALYSIS_READ_TOKEN`.

### 3.3 Rotating one

Rotation is additive, then subtractive, so no consumer sees a gap:

1. `wrangler secret put ANALYSIS_READ_KEYS` with **both** the old and the new entry for that
   consumer, under different `keyId`s.
2. Hand the consumer the new token; confirm its traffic moves (the `keyId` appears in rate-limit
   keys and in the consumer's own logs).
3. `wrangler secret put ANALYSIS_READ_KEYS` again without the old entry.

### 3.4 Revoking one

Remove its entry and re-put the secret. The credential stops working on the next request; there is
no cache to wait out.

### 3.5 Never

- Never give a reader `SEC_REFRESH_KEY` or `SEC_ADMIN_TOKEN`.
- Never put a read credential in a `var`, in `wrangler.jsonc`, in a `NEXT_PUBLIC_*` variable, or in
  anything a client component can reach. `ANALYSIS_READ_TOKEN` is read only in
  `lib/analysis-backend-runtime.ts`, which is server-only.

---

## 4. Environment variable ownership

| Name | Worker | Kind | Purpose |
|---|---|---|---|
| `ANALYSIS_READ_KEYS` | backend | secret | the read-credential list |
| `SEC_REFRESH_KEY` | backend + Web | secret | control plane (refresh, backfill, fundamentals sync) |
| `SEC_TRACKED_TICKERS` | backend | secret¹ | generation whitelist |
| `AI_API_KEY` | backend | secret | model access — **not** needed for reads |
| `SEC_USER_AGENT`, `SEC_ANALYSIS_MODEL`, `SEC_REASONING_MODEL` | backend | var | ingestion and model selection |
| `ANALYSIS_READ_TOKEN` | Web | secret | Web's own read credential |
| `SEC_PIPELINE_ORIGIN` | Web | var | backend origin (also used by the read client) |
| `SEC_ADMIN_TOKEN` | Web | secret | admin route authentication |

¹ stored as a secret only because `wrangler secret put` is the one command that changes a runtime
value without a deploy. The ticker list is not sensitive.

---

## 5. Local development, two Workers

```bash
# Terminal 1 — the analysis backend.
npx wrangler dev --config workers/pipeline/wrangler.jsonc --env="" --port 8787 --persist-to .wrangler/state
```

```bash
# Terminal 2 — the website, which reaches the backend over the PIPELINE service binding.
npm run dev
```

Backend `.dev.vars` (see `workers/pipeline/.dev.vars.example`):

```text
SEC_REFRESH_KEY="<local-refresh-key>"
ANALYSIS_READ_KEYS="local-web:<local-secret-at-least-24-chars>:*"
SEC_TRACKED_TICKERS="MSFT"
```

Web `.dev.vars`:

```text
ANALYSIS_READ_TOKEN="local-web.<local-secret-at-least-24-chars>"
SEC_PIPELINE_ORIGIN="http://127.0.0.1:8787"
SEC_ADMIN_TOKEN="<local-admin-token>"
SEC_REFRESH_KEY="<local-refresh-key>"
```

Apply migrations to the local database first:

```bash
npm run db:local:apply
```

Smoke-test the backend directly:

```bash
curl -s -H "Authorization: Bearer local-web.<local-secret-at-least-24-chars>" "http://127.0.0.1:8787/api/v1/companies/MSFT/filings?limit=1"
```

---

## 6. Rollout

Nothing below has been run against production or staging by the work that produced this document.

### 6.1 Order

1. **Provision.** Create the backend's read credentials; confirm the two `ratelimits` namespace ids
   do not collide with another Worker on the account.
2. **Migrate.** Apply migrations from their new home. Nothing should be pending — the filenames are
   unchanged, so `d1_migrations` already matches all of them.
3. **Deploy the backend.** It serves reads and keeps every existing control path.
4. **Smoke-test the backend.**
5. **Deploy Web.** Its routes become proxies and its D1 binding disappears.
6. **Verify Web.**
7. **Clean up.** Remove the D1 binding from the Worker in the Cloudflare dashboard if it lingers,
   and delete any Web build variable that only existed to carry the D1 id.

Steps 3–5 are compatible in both directions during the overlap: the old Web version still reads D1
directly (its binding is only removed at step 5), and the new backend serves both the read API and
every control endpoint the old Web version calls.

### 6.2 Commands

```bash
export SEC_PIPELINE_ORIGIN="https://earning-report-analysis-sec-pipeline.<subdomain>.workers.dev"
export SEC_WEB_WORKER_NAME="earning-report-analysis-sec-web"
```

```bash
printf %s '<keyId>:<secret>:*' | npx wrangler secret put ANALYSIS_READ_KEYS --config workers/pipeline/wrangler.jsonc --env=""
```

```bash
npx wrangler d1 migrations apply earning-report-analysis-sec-web --remote --config workers/pipeline/wrangler.jsonc
```

```bash
npm run worker:pipeline:check:migrations && npm run worker:pipeline:deploy
```

```bash
printf %s '<web-keyId>:<web-secret>' | npx wrangler secret put ANALYSIS_READ_TOKEN --config dist/server/wrangler.json
```

```bash
npm run web:deploy
```

### 6.3 Smoke tests

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$SEC_PIPELINE_ORIGIN/health"
```

```bash
curl -s "$SEC_PIPELINE_ORIGIN/ready"
```

```bash
curl -s -H "Authorization: Bearer <keyId>.<secret>" "$SEC_PIPELINE_ORIGIN/api/v1/companies/MSFT/filings?limit=1" | head -c 400
```

```bash
# Must be 401 — an anonymous read of the backend is never allowed.
curl -s -o /dev/null -w '%{http_code}\n' "$SEC_PIPELINE_ORIGIN/api/v1/companies/MSFT/filings"
```

```bash
# Must be 401 — a read credential is not an administrative one.
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "x-sec-refresh-key: <keyId>.<secret>" "$SEC_PIPELINE_ORIGIN/jobs/MSFT"
```

```bash
# Anonymous public access through Web is unchanged.
curl -s -o /dev/null -w '%{http_code}\n' "https://<web-host>/api/v1/companies/MSFT/filings?limit=1"
```

```bash
ANALYSIS_API_URL="$SEC_PIPELINE_ORIGIN" ANALYSIS_READ_TOKEN="<keyId>.<secret>" node examples/analysis-backend-consumer.mjs MSFT
```

### 6.4 Rollback

Both Workers roll back by version, without rebuilding. Published results are never deleted and data
is never rolled back.

```bash
npx wrangler rollback <version-id> --config workers/pipeline/wrangler.jsonc
```

```bash
npx wrangler rollback <version-id> --config dist/server/wrangler.json
```

Rolling **Web** back to a version from before this change reintroduces its direct D1 access, so
that version needs its `DB` binding present to work. That is a deliberate, temporary exposure:

- It only applies to a Web version older than this change.
- Restore it by redeploying the previous Web build with its own `wrangler.jsonc` (which still had
  the `d1_databases` block) and `SEC_WEB_D1_DATABASE_ID` set.
- Remove the binding again as soon as you roll forward. Leaving it in place is the exact coupling
  this refactor removed.

Rolling the **backend** back is unconditional and safe: the previous version still owns the
database and every control endpoint; only the read API disappears, which makes Web's proxies answer
`503 ANALYSIS_BACKEND_UNAVAILABLE` until you roll forward.

Schema changes: this refactor added **none**. There is nothing to migrate down.

---

## 7. Staging

Staging has no D1 binding and an empty Cron list, and must never be pointed at the production
database id. With no database the read API answers `503 STORAGE_UNAVAILABLE` and `/ready` reports
`degraded` — explicit failure, not a silent wrong write.

To give staging real read capability:

```bash
npx wrangler d1 create earning-report-analysis-sec-staging
```

Then add a `d1_databases` block with **that** id under `env.staging` in
`workers/pipeline/wrangler.jsonc`, apply migrations to it, and set
`ANALYSIS_READ_KEYS` for the staging environment:

```bash
printf %s '<staging-keyId>:<staging-secret>:*' | npx wrangler secret put ANALYSIS_READ_KEYS --config workers/pipeline/wrangler.jsonc --env staging
```
