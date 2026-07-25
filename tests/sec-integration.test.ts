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
  const [detail, section, css] = await Promise.all([
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/SecFilingsSection.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(detail, /<SecFilingsSection ticker=\{ticker\} \/>/);
  assert.match(detail, /instrument-section[\s\S]*SecFilingsSection[\s\S]*PlanEditor/);
  assert.match(section, /SEC 文件与 AI 解读/);
  assert.match(section, /\/api\/sec\/\$\{encodeURIComponent\(ticker\)\}\/filings/);
  assert.match(section, /aria-expanded=\{isOpen\}/);
  assert.match(section, /target="_blank"/);
  assert.match(css, /\.sec-filings-section/);
  assert.match(css, /\.sec-filing-card/);
});

test("provides authenticated feed and protected background refresh routes", async () => {
  await Promise.all([
    access(new URL("../app/api/sec/[ticker]/filings/route.ts", import.meta.url)),
    access(new URL("../app/api/internal/sec/watchlist/route.ts", import.meta.url)),
    access(new URL("../app/api/internal/sec/refresh/[ticker]/route.ts", import.meta.url)),
  ]);
  const [feedRoute, watchlistRoute, refreshRoute] = await Promise.all([
    readFile(new URL("../app/api/sec/[ticker]/filings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/sec/watchlist/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/sec/refresh/[ticker]/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(feedRoute, /getChatGPTUser/);
  assert.match(watchlistRoute, /hasInternalSecAccess/);
  assert.match(refreshRoute, /hasInternalSecAccess/);
  assert.match(refreshRoute, /refreshSecTicker/);
});

test("defaults new DeepSeek credentials to the supported v4 flash model", async () => {
  const runtime = await readFile(new URL("../lib/sec-runtime.ts", import.meta.url), "utf8");
  assert.match(runtime, /deepseek-v4-flash/);
  assert.doesNotMatch(runtime, /"deepseek-chat"/);
});
