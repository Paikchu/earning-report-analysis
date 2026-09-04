import assert from "node:assert/strict";
import test from "node:test";

import { decodePageCursor, encodePageCursor } from "../lib/sec-config.ts";
import { getPublicFilingPage } from "../lib/sec-public-api.ts";

test("maps migrated filings to the public contract without generation", async () => {
  const fakeRepository = {
    async countPublicFilings() { return 1; },
    async listPublicFilings() {
      return {
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

test("pages past the cache window without hydrating filings it cannot serve", async () => {
  const cached = Array.from({ length: 40 }, (_, index) => ({
    ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft", form: "8-K",
    filingDate: `2026-${String(12 - Math.floor(index / 4)).padStart(2, "0")}-${String(28 - (index % 4)).padStart(2, "0")}`,
    reportDate: "", accessionNumber: `0001-26-${String(1000 - index).padStart(6, "0")}`,
    primaryDocument: "msft.htm", description: "Current report", items: "",
    documentUrl: "https://sec.test/doc", indexUrl: "https://sec.test/index",
  }));
  const summaryReads: string[] = [];
  const listed: (string | null)[] = [];
  const fakeRepository = {
    async getCache() { return { payload: { ticker: "MSFT", company: null, filings: cached, fetchedAt: "2026-12-28T00:00:00Z", status: "ready" }, fetchedAt: "2026-12-28T00:00:00Z" }; },
    async getSummary(_ticker: string, accessionNumber: string) { summaryReads.push(accessionNumber); return null; },
    async countPublicFilings() { return 137; },
    async listPublicFilings(_ticker: string, cursor: string | null) { listed.push(cursor); return { filings: [], nextCursor: null }; },
    async getLatestAnalysisJobStatus() { return null; },
  };

  const first = await getPublicFilingPage(fakeRepository as never, "msft", null, "20");
  assert.equal(first.filings.length, 20);
  assert.equal(first.total, 137);
  // The cache window holds 40 filings; only the 20 this page returns are hydrated.
  assert.equal(summaryReads.length, 20);
  assert.equal(listed.length, 0);

  // The window ends exactly at this page, so D1 answers it and the cursor chain carries on past 40.
  summaryReads.length = 0;
  const second = await getPublicFilingPage(fakeRepository as never, "msft", first.nextCursor, "20");
  assert.equal(summaryReads.length, 0);
  assert.deepEqual(listed, [first.nextCursor]);
  assert.equal(second.total, null);

  listed.length = 0;
  const deepCursor = encodePageCursor({ filingDate: "2020-01-01", accessionNumber: "0000-00-000000" });
  const deep = await getPublicFilingPage(fakeRepository as never, "msft", deepCursor, "20");
  // Older than everything cached, so the cache costs nothing and D1 answers instead.
  assert.equal(summaryReads.length, 0);
  assert.deepEqual(listed, [deepCursor]);
  assert.equal(deep.total, null);
});

/** SEC returns same-day filings in its own order, which is not accession order. */
const sameDayFilings = ["0001-26-000005", "0001-26-000001", "0001-26-000004", "0001-26-000002", "0001-26-000003"]
  .map((accessionNumber) => ({
    ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft", form: "8-K",
    filingDate: "2026-03-01", reportDate: "2026-03-01", accessionNumber,
    primaryDocument: "msft.htm", description: "Current report", items: "",
    documentUrl: `https://sec.test/${accessionNumber}/doc`, indexUrl: `https://sec.test/${accessionNumber}/index`,
  }));

test("pages through same-day filings without dropping any", async () => {
  const fakeRepository = {
    async getCache() {
      return {
        payload: { ticker: "MSFT", company: null, filings: sameDayFilings, fetchedAt: "2026-03-02T00:00:00Z", status: "ready" },
        fetchedAt: "2026-03-02T00:00:00Z",
      };
    },
    async getSummary() { return null; },
    async countPublicFilings() { return sameDayFilings.length; },
    async listPublicFilings(_ticker: string, rawCursor: string | null, limit: number) {
      const cursor = decodePageCursor(rawCursor);
      const remaining = [...sameDayFilings]
        .sort((left, right) => right.accessionNumber.localeCompare(left.accessionNumber))
        .filter((filing) => !cursor || filing.accessionNumber < cursor.accessionNumber)
        .map((filing) => ({ ...filing, summary: null, analysis: null }));
      const pageRows = remaining.slice(0, limit);
      const last = pageRows.at(-1);
      return {
        filings: pageRows,
        nextCursor: remaining.length > limit && last
          ? encodePageCursor({ filingDate: last.filingDate, accessionNumber: last.accessionNumber })
          : null,
      };
    },
    async getLatestAnalysisJobStatus() { return null; },
  };

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let request = 0; request < 10; request += 1) {
    const page = await getPublicFilingPage(fakeRepository as never, "msft", cursor, "2");
    seen.push(...page.filings.map((filing) => filing.accessionNumber));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  // The cursor breaks a same-date tie on the accession number, so the cache has to hand pages back
  // in that order too; reading them in SEC's order drops whatever falls between two cursors.
  assert.deepEqual(seen, [
    "0001-26-000005", "0001-26-000004", "0001-26-000003", "0001-26-000002", "0001-26-000001",
  ]);
  assert.equal(new Set(seen).size, sameDayFilings.length);
});

test("serves the cache window when the archive count is unreachable", async () => {
  const listed: (string | null)[] = [];
  const fakeRepository = {
    async getCache() {
      return {
        payload: {
          ticker: "MSFT",
          company: { ticker: "MSFT", name: "Microsoft", cik: "0000789019" },
          filings: sameDayFilings.slice(0, 2),
          fetchedAt: "2026-03-02T00:00:00Z",
          status: "ready",
        },
        fetchedAt: "2026-03-02T00:00:00Z",
      };
    },
    async getSummary() { return null; },
    async countPublicFilings(): Promise<never> { throw new Error("D1_ERROR: no such table: sec_filings"); },
    async listPublicFilings(_ticker: string, cursor: string | null) { listed.push(cursor); return { filings: [], nextCursor: null }; },
    async getLatestAnalysisJobStatus() { return null; },
  };

  const page = await getPublicFilingPage(fakeRepository as never, "msft", null, "20");
  assert.deepEqual(page.filings.map((filing) => filing.accessionNumber), ["0001-26-000005", "0001-26-000001"]);
  assert.equal(page.total, null, "计数不可用时不能编一个数字出来");
  assert.equal(page.nextCursor, null);
  assert.deepEqual(listed, [], "归档已经不可用，不必再去问它要一页");
});

test("reports an archive failure the cache cannot cover", async () => {
  const fakeRepository = {
    async getCache() { return null; },
    async getSummary() { return null; },
    async countPublicFilings(): Promise<never> { throw new Error("D1_ERROR: no such table: sec_filings"); },
    async listPublicFilings(): Promise<never> { throw new Error("D1_ERROR: no such table: sec_filings"); },
    async getLatestAnalysisJobStatus() { return null; },
  };

  // 静默返回空页会把一张坏掉的表伪装成「暂未收录」。
  await assert.rejects(() => getPublicFilingPage(fakeRepository as never, "msft", null, "20"), /no such table/);
});
