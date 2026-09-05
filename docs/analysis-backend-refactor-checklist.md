# Analysis Backend Refactor — Implementation & Acceptance Checklist

Living document. Updated as work lands.

## 0. Baseline

| Item | Value |
|---|---|
| Branch | `claude/pipeline-backend-refactor-85fd30` |
| Commit at audit | `e9ee085b1c800f7fea94360015f64a2a2d230cf1` |
| Working tree at audit | clean |
| Package manager | npm (`package.json` `engines.node >= 22.13.0`) |

Baseline checks, run before any edit:

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | PASS |
| `npm run lint` (eslint + typecheck) | 0 | PASS |
| `npm test` | 0 | PASS — 317 tests, 0 failures |

**No pre-existing failures.** Any failure after this point is introduced by this work.

## 1. Audit findings (Phase 0)

The prompt's architecture leads were checked against the checkout. Differences and
confirmations:

| Lead | Actual state |
|---|---|
| Two Workers, one repo | Confirmed: `workers/web` (Vinext/Next 16 on Workers) and `workers/pipeline`. |
| Web reads D1 directly | Confirmed, 5 call sites (below). |
| Pipeline owns writes, Cron, Workflows, R2 | Confirmed. Pipeline binds D1 `DB` directly and is the sole writer. |
| Web → Pipeline `PIPELINE` Service Binding | Confirmed (`lib/sec-runtime.ts`, `lib/service-binding.ts`). |
| Fundamentals reads trigger background refresh | Confirmed — `app/api/v1/companies/[ticker]/fundamentals/route.ts` passes `scheduleFundamentalRefresh`, which `waitUntil`s a POST to the Pipeline's `/fundamentals/refresh/:ticker` on **every read whose snapshot is stale**. |
| Migrations under `workers/web/migrations` | Confirmed. Pipeline's wrangler already points `migrations_dir` at `../web/migrations`. |

### 1.1 Every financial-data consumer in Web (old → new ownership)

| Consumer | Old access | New |
|---|---|---|
| `app/api/v1/companies/[ticker]/filings/route.ts` | `getD1()` + `D1SecRepository` + `getPublicFilingPage` | proxy → backend `GET /api/v1/companies/:ticker/filings` |
| `app/api/v1/companies/[ticker]/filings/[accession]/route.ts` | `getD1()` + `D1SecRepository` + `getPublicFiling` | proxy → backend `.../filings/:accession` |
| `app/api/v1/companies/[ticker]/analysis/route.ts` | `getD1()` + `D1CompanyAnalysisRepository` | proxy → backend `.../analysis` |
| `app/api/v1/companies/[ticker]/fundamentals/route.ts` | `getD1()` + `D1FundamentalsRepository` + refresh-on-read | proxy → backend `.../fundamentals`, **no refresh on read** |
| `app/stocks/[ticker]/sec/[accession]/page.tsx` (SSR) | `getD1()` + `D1SecRepository` + `getPublicFiling` | backend client (server-side) |
| `app/stocks/[ticker]/page.tsx` (SSR) | no storage — renders client components | unchanged |
| `app/positions/[ticker]/SecFilingsSection.tsx` (client) | browser `fetch('/api/v1/.../filings')` | unchanged URL; type import moves to shared contract |
| `app/stocks/[ticker]/BusinessOutlook.tsx` (client) | browser `fetch('/api/v1/.../analysis')` | unchanged URL; type import moves to shared contract |
| `app/stocks/[ticker]/FundamentalCharts.tsx` (client) | browser `fetch('/api/v1/.../fundamentals')` | unchanged URL; type import moves to shared contract |
| `app/api/v1/search/route.ts` | `data/us-securities.json` only — no D1 | stays in Web (§3 non-goal: unrelated site functionality) |
| `app/api/v1/admin/companies/[ticker]/{refresh,backfill}` | forward to Pipeline w/ `SEC_REFRESH_KEY` | unchanged (admin auth preserved) |
| `app/api/internal/sec/refresh/[ticker]` | forward to Pipeline w/ `SEC_REFRESH_KEY` | unchanged |

Transitive-import check: the only modules that reach analysis storage from `app/` are
`@/db`, `lib/sec-d1.ts`, `lib/fundamentals-d1.ts`, `lib/company-analysis/repository.ts`
and the query modules that construct them (`lib/sec-public-api.ts`,
`lib/fundamentals-api.ts`, `lib/company-analysis/api.ts`). All become backend-only;
the wire types they exported move to `lib/analysis-contract/`.

### 1.2 Existing defects / hazards found

| ID | Finding |
|---|---|
| F1 | `D1SecRepository.getPublishedReport` wraps its query in `try { … } catch { return null }`, and `lib/sec-feed.ts` adds `.catch(() => null)`. A D1 outage is therefore reported to readers as "this filing has no analysis" — an infrastructure failure returned as an empty success (prompt §4.2). |
| F2 | `analysisStatus` maps a **known failed** analysis job to `not_collected`, indistinguishable from "never requested" (prompt §4.4). |
| F3 | Company analysis exposes no latest-run state at all; `status: "unavailable"` covers scenarios 1, 2 and 3 of §4.4 identically. |
| F4 | Fundamentals refresh is triggered by anonymous browser reads (`refresh.recommended && eligible → POST`). Eligibility in Web is `type === "stock"`, but the Pipeline rejects untracked tickers with 403, so the only refreshes that ever succeed are for tracked tickers — the same set the Cron sweep covers. |
| F5 | `company_analysis_runs` doubles as run table and publication table; `getLatestPublication` orders by `generated_at DESC`. Verified in §4.4 below. |
| F6 | `PublicCompanyAnalysisResponse` strips `evidenceRefs`, so consumers cannot follow evidence (prompt §4.3). |
| F7 | `reportVersion` is `"<analysis schema>:<content hash>"` — a *content revision*, not an API schema version. Nothing distinguishes the two today. |

### 1.3 Publication semantics audit (A11)

- **SEC filing reports** — `commitFinalPublication` uses `D1.batch(...)`, so the published
  report, the filing summary and the memory job commit atomically or not at all. It refuses
  to publish a `verificationStatus === "failed"` report, and `getPublishedReport` only
  selects `verified`/`partial`. R2 artifacts are written *before* the D1 commit and are never
  read by the query path, so a partial R2 write cannot surface to a reader.
  Concurrent runs on the same filing are already excluded by the `sec_analysis_jobs` lease
  (`SEC_ANALYSIS_JOB_LEASE_MS`, `shouldAnalyze` only proceeds on missing/failed/expired).
- **Company analysis** — `publish()` is a single `INSERT … ON CONFLICT DO UPDATE … WHERE
  status <> 'ready'` statement, i.e. atomic, and immutable once ready (an input-hash mismatch
  throws). Distinct runs get distinct `analysis_id` rows; `getLatestPublication` orders by
  `generated_at DESC`, so an older run committing later still loses to the newer revision's
  timestamp. The R2 `company-artifact` write precedes publication and is not read by queries.

**Conclusion:** the existing mechanism is sound. The narrow fixes taken are F1 (stop
swallowing storage errors on the read path) and the additive run-state metadata for F2/F3.
No new publication framework was built.

## 2. Intended behaviour changes (documented, not silent)

| # | Change | Why |
|---|---|---|
| B1 | Reading fundamentals no longer schedules a refresh. Refresh moves to a bounded Cron staleness sweep on the backend plus the existing authenticated `/fundamentals/refresh/:ticker` admin path. | Prompt §4.1: a read must not enqueue a refresh. |
| B2 | `refresh.scheduled` is now always `false` in the fundamentals payload; `refresh.mode` is added. Field kept for wire compatibility. | §4.2 additive-only. |
| B3 | A storage failure on a read now returns **503** (`STORAGE_UNAVAILABLE`) rather than a 200 with `analysis: null` (F1), and the fundamentals query failure returns 503 rather than the previous 500. | §4.2 "avoid returning an infrastructure failure as an empty successful result"; 5xx-class kept, code corrected to the documented meaning. |
| B4 | Web's public `/api/v1/*` routes are now proxies. Backend 401/403/503 are collapsed to a single `503 ANALYSIS_BACKEND_UNAVAILABLE` for anonymous callers so Web's credential state never leaks. | §4.5 secret exposure. |
| B5 | Web loses its `DB` D1 binding entirely. The database holds only analysis tables (verified against `db/schema.ts` + `db/fundamentals-schema.ts`), so no unrelated website feature depends on it. | §Phase 4. |
| B6 | Migrations move `workers/web/migrations/` → `workers/pipeline/migrations/`, filenames and contents byte-identical (`git status -M`: 21 pure renames, 0 insertions, 0 deletions). | §Phase 4 ownership. |
| B7 | `evidenceRefs` are now published on company-analysis highlights instead of being stripped. Additive. | §4.3 requires evidence references to be reachable without parsing prose. |
| B8 | `/health` reports liveness only; the dependency detail it used to carry (`modelConfigured`, `watchlistConfigured`) moved to a new read-only `/ready`. | §4.5 "keep health output minimal", "separate liveness from dependency readiness". |
| B9 | Dead code removed: `handleSecFeedRequest` + `buildSecWatchlist` (`lib/sec-api.ts`), `getCachedSecFeed` (`lib/sec-feed.ts`), `db/index.ts`, and the `cloudflareArtifacts` Vite plugin. | The first pair was the last storage-touching import reachable from the admin routes; the rest were orphaned by the boundary move. |

## 3. Work items

| ID | Item | Status | Evidence |
|---|---|---|---|
| W01 | Shared runtime-neutral contract module `lib/analysis-contract/` | done | `tests/analysis-contract.test.ts` |
| W02 | Machine-readable contract (JSON Schema + OpenAPI 3.1) + validator | done | `tests/analysis-contract.test.ts` |
| W03 | Backend read router on the Pipeline Worker | done | `tests/analysis-read-api.test.ts` |
| W04 | Read credentials (`ANALYSIS_READ_KEYS`), scopes, fail-closed | done | `tests/analysis-read-auth.test.ts` |
| W05 | Rate limiting + request bounds + cache/ETag policy | done | `tests/analysis-read-api.test.ts` |
| W06 | Published-result vs latest-run metadata (§4.4, six scenarios) | done | `tests/analysis-run-state.test.ts` |
| W07 | Storage-failure propagation (F1) | done | `tests/analysis-read-api.test.ts` |
| W08 | Typed server-only backend client | done | `tests/analysis-backend-client.test.ts` |
| W09 | Web routes → compatibility proxies; SSR → client | done | `tests/analysis-web-proxy.test.ts` |
| W10 | Remove read-triggered refresh; add bounded Cron staleness sweep | done | `tests/analysis-fundamentals-sweep.test.ts` |
| W11 | Migration ownership move + config/script updates | done | `tests/analysis-migrations.test.ts` |
| W12 | Remove Web's D1 binding and dead secrets | done | `tests/analysis-boundary.test.ts` |
| W13 | Automated boundary check (transitive) | done | `tests/analysis-boundary.test.ts` |
| W14 | Independent HTTP consumer example | done | `examples/analysis-backend-consumer.mjs` |
| W15 | Docs: ADR, API guide, rollout/rollback, README/Worker READMEs | done | `docs/analysis-backend.md` |
| W16 | Acceptance report | done | `docs/analysis-backend-acceptance.md` |

## 3.1 Final verification

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | PASS |
| `npm test` | 0 | PASS — 404 tests, 0 failures (baseline was 317) |
| `npm run build` | 0 | PASS |
| `npm run worker:pipeline:check` | 0 | PASS — all bindings resolve |
| `npm run worker:web:prepare` / `worker:web:check` | 0 | PASS — 0 D1 bindings, `PIPELINE` present |

Nothing was deployed. Blocked live checks are listed in the acceptance report, not marked done.

## 4. Assumptions

- `namespace_id` values for the two `ratelimits` bindings (`1001` backend-per-credential,
  `1002` Web-public-per-IP) are account-scoped positive integers chosen here; they are not
  credentials. Change them only if they collide with another Worker on the account.
- The read credential list is a runtime secret, never a `var`, never in `wrangler.jsonc`.
- No production or staging resource was created, modified, or deployed by this work.
