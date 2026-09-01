import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("declares SEC tables and removes portfolio tables from the standalone schema", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/web/migrations/0006_standalone_sec.sql", import.meta.url), "utf8"),
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
  assert.match(webConfig, /"migrations_dir": "migrations"/);
  assert.match(pipelineConfig, /"name": "earning-report-analysis-sec-pipeline"/);
  assert.match(viteConfig, /configPath: "workers\/web\/wrangler\.jsonc"/);
  assert.match(packageSource, /"worker:web:version:built"/);
  assert.match(packageSource, /wrangler versions upload --config dist\/server\/wrangler\.json/);
  assert.match(packageSource, /"worker:pipeline:version"/);
  assert.match(packageSource, /wrangler versions upload --config workers\/pipeline\/wrangler\.jsonc/);
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
  assert.match(reportPage, /getPublicFiling/);
  assert.match(reportPage, /notFound\(\)/);
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
  assert.match(sources[1], /getPublicFilingPage/);
  assert.match(sources[2], /getPublicFiling/);
  assert.match(sources[3], /hasSecAdminAccess/);
  assert.match(sources[3], /requestSecAnalysis/);
  assert.match(sources[4], /requestSecBackfill/);
  assert.match(sources.join("\n"), /isTrackedTicker/);
  assert.doesNotMatch(sources.join("\n"), /getChatGPTUser|oai-sites-authorization/);
});

test("keeps only short authenticated internal bridge routes", async () => {
  const routes = [
    "../app/api/internal/sec/feed/route.ts",
    "../app/api/internal/sec/context/route.ts",
    "../app/api/internal/sec/publish/route.ts",
    "../app/api/internal/sec/jobs/route.ts",
  ];
  const sources = await Promise.all(routes.map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of sources) assert.match(source, /hasInternalSecAccess/);
  assert.match(sources[2], /saveAnalysis/);
  assert.match(sources[2], /body\.summary\.accessionNumber === eventAccession/);
  assert.doesNotMatch(sources.join("\n"), /SEC_BOOTSTRAP|model-key|oai-sites-authorization/);
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
  assert.match(workerConfig, /"r2_buckets"/);
  assert.match(workflowCore, /const SEC_NODE_CONCURRENCY = 2;/);
  assert.match(workflowCore, /mapWithConcurrency\(plan\.nodes, SEC_NODE_CONCURRENCY,/);
  assert.doesNotMatch(workerConfig, /SEC_TRACKED_TICKERS/);
  // The whitelist has one home, the Web Worker; the Pipeline reads it over the bridge.
  assert.match(core, /\/api\/internal\/sec\/watchlist/);
  assert.doesNotMatch(core, /env\.SEC_TRACKED_TICKERS/);
  assert.match(operations, /AI_API_KEY/);
  assert.match(operations, /glm-5.3-flash/);
  assert.doesNotMatch(runtime, /AI_API_KEY/);
  assert.doesNotMatch(runtime, /glm-5.3-flash/);
});
