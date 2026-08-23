import assert from "node:assert/strict";
import test from "node:test";

import type { SecFilingSummary } from "../lib/sec.ts";
import {
  getCachedSecFeed,
  refreshSecTicker,
  type SecCacheRecord,
  type SecRepository,
} from "../lib/sec-service.ts";

class MemorySecRepository implements SecRepository {
  caches = new Map<string, SecCacheRecord<unknown>>();
  summaries = new Map<string, SecFilingSummary>();
  publishedReports = new Map<string, Awaited<ReturnType<NonNullable<SecRepository["getPublishedReport"]>>>>();

  async getCache<T>(key: string): Promise<SecCacheRecord<T> | null> {
    return this.caches.get(key) as SecCacheRecord<T> | undefined ?? null;
  }

  async setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void> {
    this.caches.set(key, { payload, fetchedAt });
  }

  async getSummary(ticker: string, accessionNumber: string): Promise<SecFilingSummary | null> {
    return this.summaries.get(`${ticker}:${accessionNumber}`) ?? null;
  }

  async setSummary(summary: SecFilingSummary): Promise<void> {
    this.summaries.set(`${summary.ticker}:${summary.accessionNumber}`, summary);
  }

  async getPublishedReport(ticker: string, periodId: string) {
    return this.publishedReports.get(`${ticker}:${periodId}`) ?? null;
  }
}

function response(value: unknown, status = 200) {
  return new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status,
    headers: { "content-type": typeof value === "string" ? "text/html" : "application/json" },
  });
}

const tickerMap = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [[789019, "Microsoft Corp", "MSFT", "Nasdaq"]],
};

const submissions = {
  name: "Microsoft Corp",
  filings: {
    recent: {
      accessionNumber: ["0000789019-26-000001"],
      form: ["10-Q"],
      filingDate: ["2026-07-24"],
      reportDate: ["2026-06-30"],
      primaryDocument: ["msft-20260630.htm"],
      primaryDocDescription: ["Quarterly report"],
      items: [""],
    },
  },
};

test("refreshes a ticker and never regenerates a cached useful summary", async () => {
  const repository = new MemorySecRepository();
  let modelCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("company_tickers_exchange")) return response(tickerMap);
    if (url.includes("/submissions/")) return response(submissions);
    if (url.includes("/Archives/")) return response("<h1>Revenue</h1><p>Cloud revenue increased 22%.</p>");
    if (url === "https://api.b.ai/v1/chat/completions") {
      modelCalls += 1;
      assert.equal(init?.headers && new Headers(init.headers).get("authorization"), "Bearer test-key");
      return response({
        choices: [{
          message: {
            content: JSON.stringify({
              version: 5,
              headline: "云业务继续推动增长",
              bullets: [
                { label: "收入", detail: "云业务收入增长 22%。", importance: "high" },
                { label: "利润率", detail: "经营杠杆继续释放。", importance: "medium" },
                { label: "现金流", detail: "经营现金流保持增长。", importance: "medium" },
              ],
              analystView: "增长质量保持稳健。",
              report: "云业务继续推动收入扩张，经营杠杆和现金流共同支撑增长质量。",
            }),
          },
        }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const runtime = {
    apiKey: "test-key",
    model: "deepseek-chat",
    userAgent: "max-investment-record test@example.com",
    fetcher,
    now: () => new Date("2026-07-25T00:00:00.000Z"),
    wait: async () => {},
  };
  const first = await refreshSecTicker(repository, "MSFT", runtime);
  const second = await refreshSecTicker(repository, "MSFT", runtime);

  assert.equal(first.status, "ready");
  assert.equal(second.filings[0].summary?.headline, "云业务继续推动增长");
  assert.equal(modelCalls, 1);
});

test("keeps the last successful feed when SEC becomes unavailable", async () => {
  const repository = new MemorySecRepository();
  await repository.setCache("sec:filings:MSFT", {
    ticker: "MSFT",
    company: { ticker: "MSFT", cik: "0000789019", name: "Microsoft Corp" },
    filings: [],
    fetchedAt: "2026-07-24T00:00:00.000Z",
    status: "empty",
  }, "2026-07-24T00:00:00.000Z");

  const feed = await refreshSecTicker(repository, "MSFT", {
    apiKey: "test-key",
    model: "deepseek-chat",
    userAgent: "max-investment-record test@example.com",
    fetcher: async () => { throw new Error("SEC unavailable"); },
    now: () => new Date("2026-07-25T00:00:00.000Z"),
    wait: async () => {},
  });

  assert.equal(feed.status, "stale");
  assert.equal(feed.fetchedAt, "2026-07-24T00:00:00.000Z");
  assert.equal(feed.error, "SEC 数据暂时无法更新，当前显示上次成功结果。");
});

test("returns an explicit unsupported state when SEC has no CIK", async () => {
  const repository = new MemorySecRepository();
  const feed = await refreshSecTicker(repository, "SPCX", {
    apiKey: "test-key",
    model: "deepseek-chat",
    userAgent: "max-investment-record test@example.com",
    fetcher: async () => response(tickerMap),
    now: () => new Date("2026-07-25T00:00:00.000Z"),
    wait: async () => {},
  });

  assert.equal(feed.status, "unsupported");
  assert.equal(feed.filings.length, 0);
  assert.equal((await getCachedSecFeed(repository, "SPCX")).status, "unsupported");
});

test("orders an existing cached feed by filing date", async () => {
  const repository = new MemorySecRepository();
  await repository.setCache("sec:filings:MSFT", {
    ticker: "MSFT",
    company: { ticker: "MSFT", cik: "0000789019", name: "Microsoft Corp" },
    filings: [
      {
        ticker: "MSFT",
        cik: "0000789019",
        cikNumber: 789019,
        companyName: "Microsoft Corp",
        form: "10-Q",
        filingDate: "2026-04-29",
        reportDate: "2026-03-31",
        accessionNumber: "old",
        primaryDocument: "old.htm",
        description: "Quarterly report",
        items: "",
        documentUrl: "https://example.com/old.htm",
        indexUrl: "https://example.com/old-index.html",
      },
      {
        ticker: "MSFT",
        cik: "0000789019",
        cikNumber: 789019,
        companyName: "Microsoft Corp",
        form: "10-K",
        filingDate: "2026-07-29",
        reportDate: "2026-06-30",
        accessionNumber: "new",
        primaryDocument: "new.htm",
        description: "Annual report",
        items: "",
        documentUrl: "https://example.com/new.htm",
        indexUrl: "https://example.com/new-index.html",
      },
    ],
    fetchedAt: "2026-07-30T00:00:00.000Z",
    status: "ready",
  }, "2026-07-30T00:00:00.000Z");

  const feed = await getCachedSecFeed(repository, "MSFT");

  assert.deepEqual(feed.filings.map((filing) => filing.accessionNumber), ["new", "old"]);
});

test("attaches one structured report only to the latest accession for a reporting period", async () => {
  const repository = new MemorySecRepository();
  const baseFiling = {
    ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp",
    filingDate: "2026-07-29", reportDate: "2026-06-30", primaryDocument: "report.htm",
    description: "Annual report", items: "", documentUrl: "https://example.com/report.htm", indexUrl: "https://example.com/index.html",
  };
  await repository.setCache("sec:filings:MSFT", {
    ticker: "MSFT",
    company: { ticker: "MSFT", cik: "0000789019", name: "Microsoft Corp" },
    filings: [
      { ...baseFiling, form: "10-K", accessionNumber: "original" },
      { ...baseFiling, form: "10-K/A", filingDate: "2026-08-05", accessionNumber: "amendment" },
      { ...baseFiling, form: "8-K", filingDate: "2026-08-06", accessionNumber: "event" },
    ],
    fetchedAt: "2026-08-06T00:00:00.000Z",
    status: "ready",
  }, "2026-08-06T00:00:00.000Z");
  repository.publishedReports.set("MSFT:MSFT:2026-06-30:annual", {
    ticker: "MSFT", periodId: "MSFT:2026-06-30:annual", reportVersion: "sec-analysis.v2:test", headline: "amended",
    keyMetrics: [], changes: { qoq: [], yoy: [], guidance: [], risks: [] }, dataQuality: { coverage: 1, verificationStatus: "verified", warnings: [] },
  });

  const feed = await getCachedSecFeed(repository, "MSFT");

  assert.equal(feed.filings.find((filing) => filing.accessionNumber === "amendment")?.analysis?.headline, "amended");
  assert.equal(feed.filings.find((filing) => filing.accessionNumber === "original")?.analysis, null);
  assert.equal(feed.filings.find((filing) => filing.accessionNumber === "event")?.analysis, null);
});
