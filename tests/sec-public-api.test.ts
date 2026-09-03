import assert from "node:assert/strict";
import test from "node:test";

import { getPublicFilingPage } from "../lib/sec-public-api.ts";
import { decodePageCursor, encodePageCursor } from "../lib/sec-config.ts";

test("maps migrated filings to the public contract without generation", async () => {
  const fakeRepository = {
    async listPublicFilings() {
      return {
        total: 1,
        nextCursor: null,
        filings: [{
          ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "MSFT", form: "10-Q",
          filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "0001-26-000001",
          primaryDocument: "msft.htm", description: "Quarterly report", items: "", documentUrl: "https://sec.test/doc", indexUrl: "https://sec.test/index",
          summary: { ticker: "MSFT", form: "10-Q", filingDate: "2026-07-30", accessionNumber: "0001-26-000001", headline: "Revenue grew", bullets: [], analystView: "", source: "deepseek", generatedAt: "2026-08-01T00:00:00Z" },
          analysis: null,
        }],
      };
    },
    async getLatestAnalysisJobStatus() { return null; },
  };
  const page = await getPublicFilingPage(fakeRepository as never, "msft", null, "20");
  assert.equal(page.ticker, "MSFT");
  assert.equal(page.filings[0].analysisStatus, "not_collected");
  assert.equal(page.filings[0].edgarUrl, "https://sec.test/index");
});

test("rejects malformed public ticker paths instead of rewriting them", async () => {
  await assert.rejects(() => getPublicFilingPage({} as never, "MS/FT", null, "20"), /invalid ticker/i);
});

type FakeFiling = {
  accessionNumber: string;
  filingDate: string;
};

function makeStoredFiling(accessionNumber: string, filingDate: string, form = "8-K", reportDate = filingDate) {
  return {
    ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft", form,
    filingDate, reportDate, accessionNumber,
    primaryDocument: "doc.htm", description: "Current report", items: "",
    documentUrl: `https://sec.test/${accessionNumber}/doc`, indexUrl: `https://sec.test/${accessionNumber}/index`,
  };
}

test("pages beyond the rolling cache window into D1 history", async () => {
  // 缓存只保留最新 3 条（滚动窗口），D1 累积 6 条
  const d1Filings = [
    makeStoredFiling("acc-006", "2026-03-01"),
    makeStoredFiling("acc-005", "2026-02-01"),
    makeStoredFiling("acc-004", "2026-01-01"),
    makeStoredFiling("acc-003", "2025-12-01"),
    makeStoredFiling("acc-002", "2025-11-01"),
    makeStoredFiling("acc-001", "2025-10-01"),
  ];
  const listPublicFilingsCalls: Array<string | null> = [];
  const fakeRepository = {
    async getCache() {
      return {
        payload: {
          ticker: "MSFT",
          company: { ticker: "MSFT", name: "Microsoft", cik: "0000789019" },
          filings: d1Filings.slice(0, 3).map((filing) => ({ ...filing, summary: null, analysis: null })),
          fetchedAt: "2026-03-02T00:00:00.000Z",
          status: "ready",
        },
        fetchedAt: "2026-03-02T00:00:00.000Z",
      };
    },
    async getSummary() { return null; },
    async getLatestAnalysisJobStatus() { return null; },
    async listPublicFilings(_ticker: string, rawCursor: string | null, limit: number) {
      listPublicFilingsCalls.push(rawCursor);
      const cursor = decodePageCursor(rawCursor);
      const afterCursor = (filing: FakeFiling) => !cursor
        || filing.filingDate < cursor.filingDate
        || (filing.filingDate === cursor.filingDate && filing.accessionNumber < cursor.accessionNumber);
      const remaining = d1Filings.filter(afterCursor);
      const pageRows = remaining.slice(0, limit).map((filing) => ({ ...filing, summary: null, analysis: null }));
      const last = pageRows.at(-1);
      return {
        filings: pageRows,
        nextCursor: remaining.length > limit && last
          ? encodePageCursor({ filingDate: last.filingDate, accessionNumber: last.accessionNumber })
          : null,
        total: d1Filings.length,
      };
    },
  };

  const page1 = await getPublicFilingPage(fakeRepository as never, "msft", null, "3");
  assert.equal(page1.filings.map((filing) => filing.accessionNumber).join(","), "acc-006,acc-005,acc-004");
  assert.equal(page1.total, 6, "total 必须来自 D1 累积计数而非缓存条数");
  assert.ok(page1.nextCursor, "缓存窗口耗尽后必须给出 nextCursor 继续翻页");

  const page2 = await getPublicFilingPage(fakeRepository as never, "msft", page1.nextCursor, "3");
  assert.equal(page2.filings.map((filing) => filing.accessionNumber).join(","), "acc-003,acc-002,acc-001");
  assert.equal(page2.total, 6);
  assert.equal(page2.nextCursor, null);
  assert.deepEqual(listPublicFilingsCalls, [null, page1.nextCursor], "每一页都必须回源 D1");
});

test("keeps serving the cache window when the archive table read fails", async () => {
  const cached = [makeStoredFiling("acc-003", "2026-03-01"), makeStoredFiling("acc-002", "2026-02-01")];
  const fakeRepository = {
    async getCache() {
      return {
        payload: {
          ticker: "MSFT",
          company: { ticker: "MSFT", name: "Microsoft", cik: "0000789019" },
          filings: cached,
          fetchedAt: "2026-03-02T00:00:00.000Z",
          status: "ready",
        },
        fetchedAt: "2026-03-02T00:00:00.000Z",
      };
    },
    async getSummary() { return null; },
    async getLatestAnalysisJobStatus() { return null; },
    async listPublicFilings(): Promise<never> { throw new Error("D1_ERROR: no such table: sec_filings"); },
  };

  const page = await getPublicFilingPage(fakeRepository as never, "msft", null, "20");
  assert.deepEqual(page.filings.map((filing) => filing.accessionNumber), ["acc-003", "acc-002"]);
  assert.equal(page.total, 2, "归档计数不可用时退回缓存条数");
  assert.equal(page.nextCursor, null);
});

test("surfaces an archive read failure when no cache can cover it", async () => {
  const fakeRepository = {
    async getCache() { return null; },
    async getSummary() { return null; },
    async getLatestAnalysisJobStatus() { return null; },
    async listPublicFilings(): Promise<never> { throw new Error("D1_ERROR: no such table: sec_filings"); },
  };

  // 没有缓存时静默返回空页会把损坏的数据库伪装成"暂未收录"。
  await assert.rejects(() => getPublicFilingPage(fakeRepository as never, "msft", null, "20"), /no such table/);
});

test("shows one published report per period even when the page spans both sources", async () => {
  const report = { reportVersion: "sec-report.v3", dataQuality: { verificationStatus: "verified" } };
  // 修订件与原始 10-Q 同属 2025-12-31 这个报告期，落在缓存窗口的两侧。
  const amendment = { ...makeStoredFiling("acc-002", "2026-02-10", "10-Q/A", "2025-12-31"), summary: null, analysis: report };
  const original = { ...makeStoredFiling("acc-001", "2026-01-10", "10-Q", "2025-12-31"), summary: null, analysis: report };
  const fakeRepository = {
    async getCache() {
      return {
        payload: {
          ticker: "MSFT",
          company: { ticker: "MSFT", name: "Microsoft", cik: "0000789019" },
          filings: [amendment],
          fetchedAt: "2026-02-11T00:00:00.000Z",
          status: "ready",
        },
        fetchedAt: "2026-02-11T00:00:00.000Z",
      };
    },
    async getSummary() { return null; },
    async getPublishedReport() { return report; },
    async getLatestAnalysisJobStatus() { return null; },
    async listPublicFilings() {
      // D1 的 hydrate 会把同一篇研报挂到该报告期的每一份申报上。
      return { filings: [amendment, original], nextCursor: null, total: 2 };
    },
  };

  const page = await getPublicFilingPage(fakeRepository as never, "msft", null, "20");
  assert.deepEqual(
    page.filings.map((filing) => [filing.accessionNumber, filing.analysisStatus]),
    [["acc-002", "complete"], ["acc-001", "not_collected"]],
    "同一报告期只有最新的一份申报保留研报",
  );
  assert.equal(page.filings[1].analysis, null);
});

test("pages through same-day filings without dropping any", async () => {
  // SEC 返回的同日顺序不是 accession 降序，游标却按 accession 比较。
  const sameDay = ["acc-0005", "acc-0001", "acc-0004", "acc-0002", "acc-0003"]
    .map((accessionNumber) => makeStoredFiling(accessionNumber, "2026-03-01"));
  const byCursor = (cursor: ReturnType<typeof decodePageCursor>) => [...sameDay]
    .sort((left, right) =>
      right.filingDate.localeCompare(left.filingDate)
      || right.accessionNumber.localeCompare(left.accessionNumber))
    .filter((filing) => !cursor
      || filing.filingDate < cursor.filingDate
      || (filing.filingDate === cursor.filingDate && filing.accessionNumber < cursor.accessionNumber));
  const fakeRepository = {
    async getCache() {
      return {
        payload: { ticker: "MSFT", company: null, filings: sameDay, fetchedAt: "2026-03-02T00:00:00.000Z", status: "ready" },
        fetchedAt: "2026-03-02T00:00:00.000Z",
      };
    },
    async getSummary() { return null; },
    async getLatestAnalysisJobStatus() { return null; },
    async listPublicFilings(_ticker: string, rawCursor: string | null, limit: number) {
      const remaining = byCursor(decodePageCursor(rawCursor));
      const pageRows = remaining.slice(0, limit).map((filing) => ({ ...filing, summary: null, analysis: null }));
      const last = pageRows.at(-1);
      return {
        filings: pageRows,
        nextCursor: remaining.length > limit && last
          ? encodePageCursor({ filingDate: last.filingDate, accessionNumber: last.accessionNumber })
          : null,
        total: sameDay.length,
      };
    },
  };

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let request = 0; request < 10; request += 1) {
    const page = await getPublicFilingPage(fakeRepository as never, "msft", cursor, "2");
    seen.push(...page.filings.map((filing) => filing.accessionNumber));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  assert.deepEqual(seen, ["acc-0005", "acc-0004", "acc-0003", "acc-0002", "acc-0001"]);
  assert.equal(new Set(seen).size, sameDay.length, "同日申报不能被跳过或重复");
});
