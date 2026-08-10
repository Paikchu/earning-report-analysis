import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("declares SEC cache and summary tables in the D1 schema", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

  assert.match(schema, /sqliteTable\("sec_cache"/);
  assert.match(schema, /sqliteTable\("sec_filing_summaries"/);
  assert.match(schema, /primaryKey\(\{ columns: \[table\.ticker, table\.accessionNumber\] \}\)/);
});

test("adds the SEC section to the shared position detail flow", async () => {
  const [detail, section, refreshRoute, css] = await Promise.all([
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/SecFilingsSection.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sec/[ticker]/filings/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(detail, /<SecFilingsSection ticker=\{ticker\} \/>/);
  assert.match(detail, /instrument-section[\s\S]*PlanEditor[\s\S]*SecFilingsSection/);
  assert.match(section, /SEC 文件与 AI 解读/);
  assert.match(section, /\/api\/sec\/\$\{encodeURIComponent\(ticker\)\}\/filings/);
  assert.match(refreshRoute, /getChatGPTUser/);
  assert.match(section, /aria-expanded=\{isOpen\}/);
  assert.match(section, /target="_blank"/);
  assert.match(css, /\.sec-filings-section/);
  assert.match(css, /\.sec-filing-card/);
  assert.match(section, /阅读完整报告/);
  assert.match(section, /isLatestPeriodic/);
  assert.match(css, /\.sec-filings-section,\s*\.plan-editor \{ width: 100%; max-width: none; \}/);
  assert.doesNotMatch(css, /\.position-detail-dialog \.plan-editor \{[^}]*max-width:/);
});

test("provides a private full-report route with complete report sections", async () => {
  const [page, document, css] = await Promise.all([
    readFile(new URL("../app/positions/[ticker]/sec/[accession]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/sec/[accession]/SecReportDocument.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /requireChatGPTUser/);
  assert.match(page, /cleanSecAccession/);
  assert.match(page, /getCachedSecFeed/);
  assert.match(page, /filing\.accessionNumber === accession/);
  assert.match(page, /notFound\(\)/);
  assert.match(document, /核心结论/);
  assert.match(document, /验证指标/);
  assert.match(document, /完整正文/);
  assert.match(document, /动态分段分析/);
  assert.match(document, /数据质量/);
  assert.match(document, /Workflow/);
  assert.match(document, /SEC 原文/);
  assert.match(document, /<details/);
  assert.match(css, /\.sec-report-shell/);
  assert.match(css, /\.sec-report-body/);
});

test("provides authenticated feed and protected background refresh routes", async () => {
  await Promise.all([
    access(new URL("../app/api/sec/[ticker]/filings/route.ts", import.meta.url)),
    access(new URL("../app/api/sec/[ticker]/filings/refresh/route.ts", import.meta.url)),
    access(new URL("../app/api/internal/sec/watchlist/route.ts", import.meta.url)),
    access(new URL("../app/api/internal/sec/refresh/[ticker]/route.ts", import.meta.url)),
  ]);
  const [feedRoute, watchlistRoute, refreshRoute, clientSection] = await Promise.all([
    readFile(new URL("../app/api/sec/[ticker]/filings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/sec/watchlist/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/sec/refresh/[ticker]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/SecFilingsSection.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(feedRoute, /getChatGPTUser/);
  assert.match(watchlistRoute, /hasInternalSecAccess/);
  assert.match(refreshRoute, /hasInternalSecAccess/);
  assert.match(refreshRoute, /requestSecAnalysis/);
  assert.doesNotMatch(refreshRoute, /refreshSecTicker/);
  assert.match(clientSection, /const feedUrl = `\/api\/sec\/\$\{encodeURIComponent\(ticker\)\}\/filings`/);
  assert.match(clientSection, /fetch\(`\$\{feedUrl\}\/refresh`/);
});

test("ships SEC analysis as a durable worker workflow instead of a page request", async () => {
  const [workerSource, workerConfig] = await Promise.all([
    readFile(new URL("../workers/sec-cron/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../workers/sec-cron/wrangler.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(workerSource, /WorkflowEntrypoint/);
  assert.match(workerSource, /class SecAnalysisWorkflow/);
  assert.match(workerConfig, /"workflows"/);
  assert.match(workerConfig, /"r2_buckets"/);
});

test("exposes only short authenticated bridge routes to the independent SEC worker", async () => {
  const routeUrls = [
    "../app/api/internal/sec/feed/route.ts",
    "../app/api/internal/sec/context/route.ts",
    "../app/api/internal/sec/model-key/route.ts",
    "../app/api/internal/sec/publish/route.ts",
    "../app/api/internal/sec/jobs/route.ts",
  ];
  const sources = await Promise.all(routeUrls.map(async (url) => {
    await access(new URL(url, import.meta.url));
    return readFile(new URL(url, import.meta.url), "utf8");
  }));

  for (const source of sources) assert.match(source, /hasInternalSecAccess/);
  assert.match(sources[2], /encryptSecModelKey/);
  assert.match(sources[3], /saveAnalysis/);
  assert.match(sources[3], /\^\(8-K\|6-K\)/);
  assert.match(sources[3], /body\.summary\.accessionNumber === eventAccession/);
  assert.doesNotMatch(sources.join("\n"), /refreshSecTicker/);
});

test("defaults new DeepSeek credentials to the supported v4 flash model", async () => {
  const runtime = await readFile(new URL("../lib/sec-runtime.ts", import.meta.url), "utf8");
  assert.match(runtime, /deepseek-v4-flash/);
  assert.doesNotMatch(runtime, /"deepseek-chat"/);
});
