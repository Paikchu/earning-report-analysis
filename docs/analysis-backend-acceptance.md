# Analysis Backend Refactor — acceptance report

Every acceptance ID from the brief, linked to the test or operational evidence that covers it.
Where something could not be verified in this environment it is marked **BLOCKED** with the exact
command that would verify it — not marked done.

## Environment and commands actually run

| | |
|---|---|
| Branch / base commit | `claude/pipeline-backend-refactor-85fd30` @ `e9ee085` |
| Node | v26.5.1 |
| Wrangler | 4.127.1 |
| Package manager | npm |
| Deployment access used | **none** — nothing was deployed, no production or staging resource was created, modified or read |

| Command | Exit | Result |
|---|---|---|
| `npm run lint` (eslint + `tsc --noEmit`) | 0 | PASS |
| `npm test` | 0 | PASS — **404 tests, 0 failures** |
| `npm run build` (Web Worker) | 0 | PASS |
| `npm run worker:pipeline:check` (backend `wrangler deploy --dry-run`) | 0 | PASS — all bindings resolve, including the new `ANALYSIS_READ_RATE_LIMIT` |
| `npm run worker:web:prepare` | 0 | PASS — `{"removedD1Bindings":[],"pipelineServiceBinding":true}` |
| `npm run worker:web:check` | 0 | PASS — `{"d1Bindings":0,"pipelineServiceBinding":true}` |

**Baseline before any edit** was also green: lint 0, `npm test` 0 with 317 tests passing. There were
**no pre-existing failures**, so nothing in the current run is inherited.

Six existing tests failed mid-work because their assertions described the pre-refactor
architecture. Each was **updated to describe the new behaviour**, never deleted or weakened:
`sec-integration` (deploy units, SSR route, public route contracts, scheduled handler, dependency
direction), `sec-public-api` (typed error code), `company-analysis` (evidence now published),
`fundamentals-api-route` (rewritten against the backend, refresh expectation inverted).
Two files were removed with the code they tested: `tests/fundamentals-runtime.test.ts` (the
refresh-on-read module is gone by design) and the `handleSecFeedRequest` / `buildSecWatchlist`
cases in `tests/sec-api.test.ts` (dead code with no caller, removed — replaced there by admin-auth
and backfill-forwarding tests that were previously untested).

## Acceptance matrix

| ID | Verdict | Evidence |
|---|---|---|
| **A01** Both Workers build; type/lint/tests pass | **PASS** | `npm run lint` 0, `npm test` 0 (404/404), `npm run build` 0, `npm run worker:pipeline:check` 0. Baseline had no pre-existing failures. |
| **A02** Backend queries work without Web | **PASS** | `tests/analysis-read-api.test.ts` — all four resources answered by the real router over a real SQLite database carrying the project's real migrations, no Web code in the process. |
| **A03** Independent HTTP consumer with only the API + a read credential | **PASS** | `tests/analysis-integration.test.ts` runs `examples/analysis-backend-consumer.mjs` as a **separate OS process** against a real HTTP socket. That script imports nothing from `lib/` and validates responses against the backend's own published OpenAPI schemas. The wrong-credential case is rejected over the same socket. |
| **A04** Service Binding and HTTPS return equivalent payloads and statuses | **PASS** | `tests/analysis-backend-client.test.ts` — six calls (including a 404 and a 400) run through both a binding-shaped fetcher and an HTTPS-origin client; body, status, `cache-control` and `etag` are compared. |
| **A05** Web SSR/pages and old API URLs work through the backend | **PARTIAL — see note** | `tests/analysis-web-proxy.test.ts` (proxy against the real backend: same URLs, anonymous access, pagination, verbatim body, no double wrapping) and `tests/sec-integration.test.ts` (SSR page reads through the client, keeps 404 distinct from outage). **Not verified: rendered pages in a browser.** See BLOCKED-1. |
| **A06** No direct D1/R2 access or transitive backend dependency; automated enforcement | **PASS** | `tests/analysis-boundary.test.ts` walks the full import graph from every `app/`, `components/` and `workers/web/` entry point. It has a **negative control** proving it detects a real violation, and it caught one during this work (`admin routes → lib/sec-api.ts → lib/sec-feed.ts`), which was fixed by deleting dead code. Also asserted: the built client bundle contains zero repository code (`grep dist/client` → 0 hits). |
| **A07** Zero ingestion/model/Workflow/refresh calls and zero business writes on every read path | **PASS** | `tests/analysis-read-api.test.ts` wraps the database so **any non-SELECT statement throws** and runs all four resources plus the missing-data and stale-data cases — a write would fail the request, not just an assertion. A second test runs reads with global `fetch` booby-trapped and no workflow bindings or model key. |
| **A08** Missing data, invalid input, unknown accession, invalid cursor, bounded limits, outages | **PASS** | `tests/analysis-read-api.test.ts` — nine documented input/lookup cases each asserting status **and** `code`, plus limit clamping, oversized URLs, and storage failure → 503 with no internal detail. |
| **A09** All six published-result/latest-run scenarios | **PASS** | `tests/analysis-run-state.test.ts` — one test per scenario against a real database, plus `unknown` vs `none`, a leaky error code being reduced, and `insufficient_data`. Filing-level equivalents in `tests/analysis-read-api.test.ts`. |
| **A10** A failed/running refresh leaves the previous report readable at the same revision | **PASS** | `tests/analysis-run-state.test.ts` scenario 5 (content and `contentRevision` compared before/after) and `tests/analysis-publication.test.ts` ("a failed later run leaves the previously published filing report untouched"). |
| **A11** Publication failure/partial write and overlapping runs | **PASS** | `tests/analysis-publication.test.ts` — batch atomicity (a failed batch leaves nothing), single-statement company publication, immutability, an older run failing to displace a newer revision, failed reports never published or read back. The existing mechanism was audited first and kept; the only fix was on the read side (storage errors no longer swallowed). |
| **A12** Summary-only/event filings and partial outputs keep their real quality | **PASS** | `tests/analysis-read-api.test.ts` — an 8-K keeps its summary with `analysis: null` and `periodId: null`; a partial report reports `partial`, never `complete`, and keeps its warnings. |
| **A13** Legacy structures compatible; contracts validate real responses; versions separated | **PASS** | `tests/analysis-contract.test.ts` (schemas, error/status table, OpenAPI, `reportVersion` splitting) and `tests/analysis-read-api.test.ts` (every real response validated against the published schema, which is closed to unknown fields). Version separation asserted explicitly. |
| **A14** Credentials rejected; read cannot do admin; forged headers do not bypass | **PASS** | `tests/analysis-read-auth.test.ts` — seven near-miss credentials, revocation, fail-closed on missing config, 401 vs 403, eight forged header/origin/host claims, a read credential rejected on every control endpoint, and every non-GET method refused. |
| **A15** No backend secret in bundles, public config, bodies or logs; anonymous access as documented | **PASS** | `grep` over `dist/client` for `ANALYSIS_READ_TOKEN`/`ANALYSIS_READ_KEYS`/`SEC_REFRESH_KEY`/`SEC_ADMIN_TOKEN`/`AI_API_KEY` → **0 hits**. `tests/analysis-read-api.test.ts` asserts no response body carries a secret; `tests/analysis-web-proxy.test.ts` asserts four different backend refusals all collapse to one opaque 503 with the reason only in the log. |
| **A16** Request limits, rate limits, CORS, cache authorisation/isolation, ETag invalidation | **PASS** | `tests/analysis-read-api.test.ts` (private caching, `vary: Authorization`, 304 only after auth **and** scope, ETag changing when only run state changes, no-store for non-terminal states, per-credential rate limiting keyed on `keyId`) and `tests/analysis-web-proxy.test.ts` (public CORS, per-IP limiting, no-store not widened). |
| **A17** Reads succeed with absent model credentials | **PASS** | `tests/analysis-read-api.test.ts` ("reads work with no model credential…") and `tests/analysis-integration.test.ts` (`/ready` reports `modelConfigured: false` and still `ready`). |
| **A18** Fresh and previously migrated databases both work; no reapplication, no data loss | **PASS** | `tests/analysis-migrations.test.ts` — fresh full-history apply, a simulated already-migrated `d1_migrations` table showing zero unapplied and zero orphaned, a content-digest manifest of all 11 migrations, journal continuity, and no stale path left in any script or config. Independently corroborated: `git status -M` shows all 21 files as **pure renames, 0 insertions, 0 deletions**. |
| **A19** Cron, Workflow, whitelist, admin-refresh and backfill behaviour intact; no production identity change | **PASS** | `tests/analysis-integration.test.ts` (the deployed handler still drives all four sweeps; control endpoints still authenticate and queue) and `tests/analysis-boundary.test.ts` (all four Workflow classes still exported, Cron expression pinned to `*/10 * * * *`, D1 name and id unchanged, no reverse service binding). |
| **A20** Untracked companies stay readable; reads do not expand the whitelist | **PASS** | `tests/analysis-read-api.test.ts` (an untracked company's history reads fine with a narrower whitelist in env) and `tests/analysis-fundamentals-sweep.test.ts` (an untracked ticker is never swept however stale). |
| **A21** Staging cannot touch production storage; missing resources fail explicitly | **PARTIAL — see note** | `tests/analysis-boundary.test.ts` asserts `env.staging` has no D1 binding, staging R2 bucket names end in `-staging`, staging Cron is empty, and the production database id does not appear anywhere inside the staging block. Missing storage → explicit 503 `STORAGE_UNAVAILABLE` (`tests/analysis-read-api.test.ts`) and `/ready` → `degraded`. **Local integration ran in-process, not in workerd.** See BLOCKED-2. |
| **A22** Deployment order, mixed-version compatibility, smoke checks, rollback | **PARTIAL — documented and locally exercised only** | `docs/analysis-backend.md` §6 gives the ordered runbook, executable commands, smoke tests and rollback for both Workers including the temporary D1 re-exposure on a Web rollback. Locally exercised: both build/dry-run commands and both config gates. **Not exercised: any actual deploy, smoke test against a live URL, or rollback.** See BLOCKED-3. |

## Blocked checks

These are verification limitations, not completed work.

**BLOCKED-1 — browser rendering of the migrated pages.** The proxy and SSR paths are covered by
tests against the real backend, but no page was rendered in a browser. To verify:

```bash
npx wrangler dev --config workers/pipeline/wrangler.jsonc --env="" --port 8787 --persist-to .wrangler/state
```

```bash
npm run dev
```

Then open `/stocks/MSFT` and `/stocks/MSFT/sec/<accession>` and confirm the filing rail pages,
the outlook renders, and the charts load.

**BLOCKED-2 — two-Worker topology inside workerd.** The integration tests run the real handlers
in-process and over a real HTTP socket, which proves the contract and the routing but **not**
Service Binding behaviour inside the Workers runtime. To verify, run the two `wrangler dev`
commands above (the Web side resolves `PIPELINE` against the local backend) and:

```bash
curl -s -H "Authorization: Bearer local-web.<local-secret>" "http://127.0.0.1:8787/api/v1/companies/MSFT/filings?limit=1"
```

```bash
curl -s "http://127.0.0.1:3000/api/v1/companies/MSFT/filings?limit=1"
```

Both should return the same domain payload; only the second is anonymous.

**BLOCKED-3 — staging and production.** No deployment access was used and none was authorised.
Untested against a live environment: the migration gate against remote D1, the rate-limit bindings
under real load, `wrangler rollback`, and every smoke command in `docs/analysis-backend.md` §6.3.
A dry run is not a deployment and is not recorded as one here.

## Review pass notes

Findings from reviewing the finished diff, all resolved:

1. **The boundary check was initially vacuous.** Its path resolver used `require` in an ESM module,
   which threw and was swallowed, so nothing resolved and nothing was ever found. Fixed with a real
   `statSync` import, and a negative control was added so the check cannot silently die again.
2. **A real leftover coupling, caught by that fix.** The admin routes reached `lib/sec-feed.ts`
   through `lib/sec-api.ts`. The cause was `handleSecFeedRequest` and `buildSecWatchlist` — both
   dead since earlier work, with no caller outside their own tests. Removed.
3. **An orphaned build plugin.** `workers/web/cloudflare-artifacts.ts` existed only to copy the Web
   Worker's D1 migrations into `dist/migrations`. With no D1 binding and no migrations it produced
   an empty directory on every build. Removed, and `dist/` confirmed to contain only `client/` and
   `server/` afterwards.
4. **Tests that only exercised mocks.** The read-path "no writes" test originally would have
   asserted that a helper was not called. It was rewritten to make writes physically impossible at
   the database layer, so the read path proves the property by succeeding.
5. **Migration digests were placeholders.** The manifest initially carried invented hashes, which
   the test correctly rejected. Replaced with digests computed from the actual files.
6. **The binding was removed from the config but not from the types.** `workers/web/index.ts` and
   `workers/web/worker-configuration.d.ts` still declared `DB: D1Database`, so an edit writing
   `env.DB` in Web would have typechecked and failed only at runtime. Both cleaned, and a boundary
   test now covers the type files as well as the config.
7. **The backend's generated types were stale.** They still declared `WEB_APP_ORIGIN` and a
   `WEB?: Fetcher` reverse binding that the config had already dropped, and were missing `DB` and
   the new rate limiter. Regenerated with `wrangler types`; the boundary test pins the result.
