import assert from "node:assert/strict";
import test from "node:test";

import { getPublicFilingPage } from "../lib/sec-public-api.ts";

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
