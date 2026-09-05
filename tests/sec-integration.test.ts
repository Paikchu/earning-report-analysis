import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("declares SEC tables and removes portfolio tables from the standalone schema", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/migrations/0006_standalone_sec.sql", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /sqliteTable\("sec_cache"/);
  assert.match(schema, /sqliteTable\("sec_filing_summaries"/);
  assert.match(schema, /sqliteTable\("sec_published_reports"/);
  assert.match(migration, /DROP TABLE IF EXISTS `holding_plans`/);
  assert.match(migration, /DROP TABLE IF EXISTS `plan_levels`/);
});

test("keeps both Cloudflare Workers as explicit deploy units", async () => {
  const [webConfig, pipelineConfig, viteConfig, packageSource] = await Promise.all([
    readFile(new URL("../workers/web/wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(webConfig, /"name": "earning-report-analysis-sec-web"/);
  assert.match(webConfig, /"main": "index\.ts"/);
  // Migrations belong to the Worker that owns the data model. The Web Worker no longer binds D1 at
  // all, so it carries neither a migrations directory nor a database binding to point one at.
  assert.doesNotMatch(webConfig, /"migrations_dir"/);
  assert.doesNotMatch(webConfig, /"d1_databases"/);
  assert.match(pipelineConfig, /"migrations_dir": "migrations"/);
  assert.match(pipelineConfig, /"name": "earning-report-analysis-sec-pipeline"/);
  assert.match(viteConfig, /configPath: "workers\/web\/wrangler\.jsonc"/);
  assert.match(packageSource, /"worker:web:version:built"/);
  assert.match(packageSource, /wrangler versions upload --config dist\/server\/wrangler\.json/);
  assert.match(packageSource, /"worker:pipeline:version"/);
  assert.match(packageSource, /wrangler versions upload --config workers\/pipeline\/wrangler\.jsonc/);
  // The Pipeline binds D1 directly rather than asking the Web Worker to write for it. Its config is
  // the committed source, so the id is real here and no prepare step stands between it and deploy;
  // the deploy does have to pass the same migration gate the Web Worker passes.
  assert.match(pipelineConfig, /"binding": "DB"/);
  assert.doesNotMatch(pipelineConfig, /00000000-0000-4000-8000-000000000000/);
  assert.match(packageSource, /"worker:pipeline:deploy": "npm run worker:pipeline:check:migrations/);
});

test("exposes the standalone stock and report routes", async () => {
  await Promise.all([
    access(new URL("../app/stocks/[ticker]/page.tsx", import.meta.url)),
    access(new URL("../app/stocks/[ticker]/sec/[accession]/page.tsx", import.meta.url)),
    access(new URL("../app/positions/[ticker]/sec/[accession]/SecReportDocument.tsx", import.meta.url)),
  ]);
  const [stockPage, reportPage, document, header] = await Promise.all([
    readFile(new URL("../app/stocks/[ticker]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/stocks/[ticker]/sec/[accession]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/sec/[accession]/SecReportDocument.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-header.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(stockPage, /SecFilingsSection/);
  assert.match(stockPage, /FundamentalCharts/);
  assert.match(stockPage, /stock-analysis-grid/);
  assert.match(stockPage, /parseFundamentalPageState/);
  assert.match(stockPage, /findSecurity/);
  // The report page reads through the backend client; there is no database binding to fall back to.
  assert.match(reportPage, /getAnalysisBackendRuntime/);
  assert.match(reportPage, /client\.getFiling/);
  assert.doesNotMatch(reportPage, /getD1|D1SecRepository/);
  assert.match(reportPage, /notFound\(\)/);
  // A backend outage stays distinct from a missing filing rather than rendering as "not found".
  assert.match(reportPage, /"unavailable"/);
  assert.match(document, /核心结论/);
  assert.match(document, /验证指标/);
  assert.match(document, /动态分段分析/);
  assert.match(document, /数据质量/);
  assert.match(header, /搜索股票代码或公司名称/);
  assert.doesNotMatch(header, /sec-site-mark|sec-site-caption/);
  assert.doesNotMatch(header, /oai-authenticated-user-email|ChatGPT/);
});

test("restores the default open filings when the stock page is shown again", async () => {
  const section = await readFile(new URL("../app/positions/[ticker]/SecFilingsSection.tsx", import.meta.url), "utf8");

  assert.match(section, /addEventListener\("pageshow", restoreDefaultSummary\)/);
  assert.match(section, /setOpenAccessions\(new Set\(defaultOpenAccessions\(filingsRef\.current\)\)\)/);
  // Only the two newest filings start expanded.
  assert.match(section, /const TIMELINE_DEFAULT_OPEN = 2;/);
  assert.match(section, /filings\.slice\(0, TIMELINE_DEFAULT_OPEN\)\.map\(\(filing\) => filing\.accessionNumber\)/);
  assert.match(section, /removeEventListener\("pageshow", restoreDefaultSummary\)/);
});

test("publishes public filing, search, and protected admin contracts", async () => {
  const routes = [
    "../app/api/v1/search/route.ts",
    "../app/api/v1/companies/[ticker]/filings/route.ts",
    "../app/api/v1/companies/[ticker]/filings/[accession]/route.ts",
    "../app/api/v1/admin/companies/[ticker]/refresh/route.ts",
    "../app/api/v1/admin/companies/[ticker]/backfill/route.ts",
  ];
  const sources = await Promise.all(routes.map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.match(sources[0], /searchCompanyDirectory/);
  // The two public financial routes are compatibility proxies over the analysis backend: same URLs,
  // same anonymous access, no database binding in this Worker.
  assert.match(sources[1], /proxyAnalysisRead/);
  assert.match(sources[1], /client\.listFilings/);
  assert.match(sources[2], /proxyAnalysisRead/);
  assert.match(sources[2], /client\.getFiling/);
  assert.doesNotMatch(sources[1] + sources[2], /getD1|D1SecRepository/);
  assert.match(sources[3], /hasSecAdminAccess/);
  assert.match(sources[3], /requestSecAnalysis/);
  assert.match(sources[4], /requestSecBackfill/);
  // The whitelist lives on the Pipeline Worker now: it re-checks the ticker before starting a run,
  // so the Web-side admin routes forwarding to it no longer need their own copy of the check.
  assert.doesNotMatch(sources.join("\n"), /isTrackedTicker/);
  assert.doesNotMatch(sources.join("\n"), /getChatGPTUser|oai-sites-authorization/);
});

test("keeps only the one short authenticated internal forwarding route", async () => {
  // Every other /api/internal/* route was a Pipeline-to-Web bridge call; Pipeline now reads and
  // writes D1 directly, so none of them exist any more. This one remains because it is a genuine
  // Web-to-Pipeline control-plane forward (an operator or a webhook triggering a refresh via the
  // internal key, the same shape the admin routes use with the admin token instead).
  const source = await readFile(new URL("../app/api/internal/sec/refresh/[ticker]/route.ts", import.meta.url), "utf8");
  assert.match(source, /hasInternalSecAccess/);
  assert.match(source, /requestSecAnalysis/);
  assert.doesNotMatch(source, /isTrackedTicker/);

  const internalDirectory = await readdir(new URL("../app/api/internal", import.meta.url), { recursive: true, withFileTypes: true });
  const routeFiles = internalDirectory.filter((entry) => entry.isFile() && entry.name === "route.ts");
  assert.equal(routeFiles.length, 1);
});

test("ships SEC analysis as a bounded durable Cloudflare workflow with isolated model credentials", async () => {
  const [workerSource, workerConfig, workflowCore, operations, core, runtime] = await Promise.all([
    readFile(new URL("../workers/pipeline/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/workflow-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/operations.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/core.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sec-runtime.ts", import.meta.url), "utf8"),
  ]);
  assert.match(workerSource, /WorkflowEntrypoint/);
  assert.match(workerSource, /class SecAnalysisWorkflow/);
  assert.match(workerConfig, /"compatibility_flags": \["nodejs_compat"\]/);
  assert.match(workerConfig, /"workflows"/);
  assert.equal(workerConfig.match(/"concurrency":\s*\{\s*"limit": 4\s*\}/g)?.length, 2);
  assert.equal(workerConfig.match(/"concurrency":\s*\{\s*"limit": 2\s*\}/g)?.length, 2);
  assert.match(workerConfig, /"r2_buckets"/);
  assert.match(workflowCore, /const SEC_NODE_CONCURRENCY = 2;/);
  assert.match(workflowCore, /mapWithConcurrency\(plan\.nodes, SEC_NODE_CONCURRENCY,/);
  // The whitelist has one home, the Pipeline Worker's own runtime var — never the committed config
  // (that would put a deploy between an operator and adding a ticker) and never a copy the Web
  // Worker holds too (that's the drift this design replaced).
  assert.doesNotMatch(workerConfig, /SEC_TRACKED_TICKERS/);
  assert.match(core, /env\.SEC_TRACKED_TICKERS/);
  assert.doesNotMatch(core, /\/api\/internal\/sec\/watchlist/);
  assert.match(operations, /AI_API_KEY/);
  assert.match(operations, /glm-5.3-flash/);
  assert.doesNotMatch(runtime, /AI_API_KEY/);
  assert.doesNotMatch(runtime, /glm-5.3-flash/);
});

test("reports a failed scheduled run instead of finishing it as ok", async () => {
  // The request and Cron handler lives in worker.ts so it can be imported without
  // `cloudflare:workers`; index.ts keeps the Workflow entrypoints and re-exports it as the default.
  const [workerSource, entry, core] = await Promise.all([
    readFile(new URL("../workers/pipeline/worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/core.ts", import.meta.url), "utf8"),
  ]);
  assert.match(entry, /import worker from "\.\/worker\.ts";/);
  assert.match(entry, /export default worker;/);

  // `allSettled` cannot reject, so the handler has to await the work and rethrow for the Cron
  // invocation to record anything but `outcome: ok`. Handing it to `waitUntil` loses that.
  assert.match(workerSource, /const results = await Promise\.allSettled\(\[/);
  for (const sweep of ["runSecRefresh(env)", "runSecMemorySweep(env)", "runCompanyAnalysisSweep(env)", "runFundamentalsStalenessSweep(env)"]) {
    assert.ok(workerSource.includes(sweep), `the scheduled handler must still run ${sweep}`);
  }
  assert.match(workerSource, /console\.error\(payload\)/);
  // A rejection reason is an Error, and JSON.stringify renders those as `{}` — the log has to
  // unwrap the message or a reported failure says nothing about what failed.
  assert.match(workerSource, /result\.reason instanceof Error \? result\.reason\.message/);
  assert.match(workerSource, /throw new AggregateError\(rejected\.map/);
  assert.doesNotMatch(workerSource, /context\.waitUntil/);
  // And a run that starts nothing has to be a failure, not an empty success.
  assert.match(core, /started no workflows/);
});

test("keeps dependencies pointed one way: Web can call Pipeline, Pipeline calls no one", async () => {
  const [pipelineConfig, webConfig, core, operations, memoryWorkflow, companyAnalysisWorkflow, fundamentalsPipeline, pipelineWorker, runtime, adminRefresh, backendRuntime] = await Promise.all([
    readFile(new URL("../workers/pipeline/wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../workers/web/wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/core.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/operations.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/memory-workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/company-analysis-workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/fundamentals.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/pipeline/worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sec-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/admin/companies/[ticker]/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/analysis-backend-runtime.ts", import.meta.url), "utf8"),
  ]);
  const pipelineSources = [core, operations, memoryWorkflow, companyAnalysisWorkflow, fundamentalsPipeline, pipelineWorker].join("\n");

  // Pipeline is the lower layer: it has no binding, no origin, and no fetcher pointed at Web. A
  // second copy of the whitelist drifting from Web's was exactly the failure mode this replaced —
  // removing the binding makes a reverse dependency impossible to add back by accident, not just
  // discouraged by convention.
  assert.doesNotMatch(pipelineConfig, /"service":\s*"earning-report-analysis-sec-web"/);
  assert.doesNotMatch(pipelineSources, /WEB_APP_ORIGIN/);
  assert.doesNotMatch(pipelineSources, /serviceFetcher\(env\.WEB/);

  // Web is the upper layer and may still call down for control-plane requests: kicking off an
  // analysis run, or asking Pipeline to refresh one ticker's fundamentals. Both go through the
  // Service Binding, since the two Workers' public hostnames 404 each other from the edge.
  assert.match(webConfig, /"binding":\s*"PIPELINE",\s*"service":\s*"earning-report-analysis-sec-pipeline"/);
  assert.match(runtime, /pipelineFetch: serviceFetcher\(asServiceBinding\(values\.PIPELINE\)\)/);
  assert.match(adminRefresh, /fetcher: runtime\.pipelineFetch/);

  // Data now travels the same binding as control, through the read client — and it presents a real
  // read credential rather than trusting the binding. Reading no longer triggers a refresh: that
  // moved to the backend's own scheduled sweep, so `lib/fundamentals-runtime.ts` no longer exists.
  assert.match(backendRuntime, /serviceFetcher\(asServiceBinding\(values\.PIPELINE\)\)/);
  assert.match(backendRuntime, /ANALYSIS_READ_TOKEN/);
  // The refresh endpoint is still there, still on the backend, and still behind the refresh key.
  assert.match(pipelineWorker, /path\.startsWith\("\/fundamentals\/refresh\/"\)/);
  assert.match(fundamentalsPipeline, /x-sec-refresh-key/);
  await assert.rejects(readFile(new URL("../lib/fundamentals-runtime.ts", import.meta.url), "utf8"), /ENOENT/);

  // SEC and the model API are the open internet and keep the plain fetcher — only the Web bridge
  // was ever routed differently.
  assert.match(operations, /discoverSecTicker\(ticker, \{ userAgent: env\.SEC_USER_AGENT, fetcher \}\)/);
  assert.match(operations, /callWorkerSecModel\(env, fetcher,/);
});
