import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const execFileAsync = promisify(execFile);

async function loadModule<T>(path: string): Promise<T> {
  try {
    return await import(path) as T;
  } catch (error) {
    assert.fail(`缺少宏观模块：${error instanceof Error ? error.message : String(error)}`);
  }
}

test("validates the checked-in macro dashboard against the current portfolio snapshot", async () => {
  const { validateMacroDashboard } = await loadModule<typeof import("../lib/macro-dashboard.ts")>("../lib/macro-dashboard.ts");
  const [dashboard, snapshot] = await Promise.all([
    readFile(new URL("data/macro-dashboard.json", projectRoot), "utf8").then(JSON.parse),
    readFile(new URL("data/portfolio-snapshot.json", projectRoot), "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(validateMacroDashboard(dashboard, snapshot), []);
});

test("rejects stale provenance, unknown tickers, and unresolved source references", async () => {
  const { validateMacroDashboard } = await loadModule<typeof import("../lib/macro-dashboard.ts")>("../lib/macro-dashboard.ts");
  const snapshot = JSON.parse(await readFile(new URL("data/portfolio-snapshot.json", projectRoot), "utf8"));
  const dashboard = {
    version: 1,
    reviewDate: "2026-08-19",
    generatedAt: "2026-08-19T00:45:00.000Z",
    portfolioSnapshotGeneratedAt: "2026-08-17T00:00:00.000Z",
    coverageStatus: "complete",
    headline: "通胀与利率仍是本周主线",
    summary: "经济事件通过利率和估值渠道影响当前持仓。",
    impacts: [{
      eventId: "cpi-release",
      title: "消费者价格指数",
      fact: "官方数据已经发布。",
      transmission: "通胀变化影响政策利率预期与成长股估值。",
      channels: ["inflation", "rates"],
      direction: "mixed",
      horizon: "immediate",
      confidence: "medium",
      tickers: ["UNKNOWN"],
      implication: "需要观察长端收益率是否确认这一方向。",
      sourceIds: ["missing-source"],
    }],
    upcomingEvents: [],
    sources: [{ id: "bls", title: "BLS", url: "http://example.com", publishedAt: "2026-08-17T00:00:00.000Z" }],
  };

  const errors = validateMacroDashboard(dashboard, snapshot);
  assert.ok(errors.some((error: string) => error.includes("portfolioSnapshotGeneratedAt")));
  assert.ok(errors.some((error: string) => error.includes("UNKNOWN")));
  assert.ok(errors.some((error: string) => error.includes("missing-source")));
  assert.ok(errors.some((error: string) => error.includes("HTTPS")));
  assert.ok(errors.some((error: string) => error.includes("过去 24 小时")));
});

test("rejects duplicate ids, invalid partial coverage, and events outside seven days", async () => {
  const { validateMacroDashboard } = await loadModule<typeof import("../lib/macro-dashboard.ts")>("../lib/macro-dashboard.ts");
  const snapshot = JSON.parse(await readFile(new URL("data/portfolio-snapshot.json", projectRoot), "utf8"));
  const dashboard = {
    version: 1,
    reviewDate: "2026-08-19",
    generatedAt: "2026-08-19T00:45:00.000Z",
    portfolioSnapshotGeneratedAt: snapshot.generatedAt,
    coverageStatus: "partial",
    headline: "未来一周经济事件",
    summary: "经济事件日历已经检查。",
    impacts: [],
    upcomingEvents: [
      { id: "gdp", title: "GDP", scheduledAt: "2026-08-28T12:30:00.000Z", importance: "high", status: "scheduled", sourceIds: ["bea"] },
      { id: "gdp", title: "GDP 修订值", scheduledAt: "2026-08-28T12:30:00.000Z", importance: "medium", status: "scheduled", sourceIds: ["bea"] },
    ],
    sources: [{ id: "bea", title: "BEA", url: "https://www.bea.gov/news/schedule" }],
  };

  const errors = validateMacroDashboard(dashboard, snapshot);
  assert.ok(errors.some((error: string) => error.includes("coverageNote")));
  assert.ok(errors.some((error: string) => error.includes("重复")));
  assert.ok(errors.some((error: string) => error.includes("未来 7 天")));
});

test("defines the fixed TradingView universes and locked technical-analysis config", async () => {
  const tradingView = await loadModule<typeof import("../lib/tradingview.ts")>("../lib/tradingview.ts");

  assert.deepEqual(tradingView.EQUITY_CHARTS.map((item) => item.symbol), ["AMEX:SPY", "NASDAQ:QQQ", "AMEX:IWM"]);
  assert.deepEqual(tradingView.BOND_CHARTS.map((item) => item.symbol), ["TVC:US02Y", "TVC:US10Y", "TVC:US30Y", "NASDAQ:IEF", "NASDAQ:TLT"]);
  const config = tradingView.buildTradingViewConfig("TVC:US10Y");
  assert.equal(config.symbol, "TVC:US10Y");
  assert.equal(config.interval, "D");
  assert.equal(config.range, "12M");
  assert.equal(config.allow_symbol_change, false);
  assert.deepEqual(config.studies, ["MASimple@tv-basicstudies", "StochasticRSI@tv-basicstudies", "ROC@tv-basicstudies"]);
  assert.throws(() => tradingView.buildTradingViewConfig("NASDAQ:NVDA"), /不支持/);
});

test("validates the checked-in macro dashboard from the command line", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    "scripts/validate-macro-dashboard.ts",
  ], { cwd: projectRoot });

  assert.match(stdout, /Macro dashboard is valid: 2026-08-19/);
});

test("rejects an invalid candidate without replacing the last good dashboard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-dashboard-"));
  const candidatePath = join(directory, "candidate.json");
  const dashboardPath = new URL("data/macro-dashboard.json", projectRoot);
  const before = await readFile(dashboardPath, "utf8");
  await writeFile(candidatePath, JSON.stringify({ version: 1 }));

  await assert.rejects(execFileAsync(process.execPath, [
    "--experimental-strip-types",
    "scripts/validate-macro-dashboard.ts",
    candidatePath,
    "data/portfolio-snapshot.json",
  ], { cwd: projectRoot }));
  assert.equal(await readFile(dashboardPath, "utf8"), before);
});
