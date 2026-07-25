import assert from "node:assert/strict";
import test from "node:test";

import {
  htmlToSecText,
  isBusinessFiling,
  isSummaryRetryDue,
  normalizeSecSummary,
  parseSecSubmissions,
} from "../lib/sec.ts";

test("accepts domestic and foreign issuer business filings", () => {
  for (const form of ["10-K", "10-Q", "8-K", "20-F", "6-K", "10-K/A", "20-F/A"]) {
    assert.equal(isBusinessFiling(form), true, form);
  }
  assert.equal(isBusinessFiling("N-PORT"), false);
});

test("extracts readable filing text without scripts or markup", () => {
  const text = htmlToSecText(`
    <html><style>.hidden { display:none }</style><script>ignore()</script>
      <h1>Revenue &amp; growth</h1><p>Sales increased 18&#37;.</p>
      <div>Cash&nbsp;flow improved.</div>
    </html>
  `);

  assert.match(text, /Revenue & growth/);
  assert.match(text, /Sales increased 18%/);
  assert.match(text, /Cash flow improved/);
  assert.doesNotMatch(text, /ignore|display:none|<h1>/);
});

test("normalizes useful Chinese summary fields and removes filler", () => {
  const summary = normalizeSecSummary({
    headline: "  云业务增长继续拉动利润率  ",
    bullets: [
      { label: "收入", detail: " 云业务收入同比增长。 ", importance: "high" },
      { label: "空项", detail: "需要后续复核", importance: "high" },
      { label: "现金流", detail: "自由现金流改善。", importance: "invalid" },
    ],
    analystView: "盈利质量改善，但资本开支仍然偏高。",
  }, {
    ticker: "MSFT",
    form: "10-Q",
    filingDate: "2026-07-24",
    accessionNumber: "0000000000-26-000001",
  }, new Date("2026-07-25T00:00:00.000Z"));

  assert.equal(summary.headline, "云业务增长继续拉动利润率");
  assert.deepEqual(summary.bullets.map((bullet) => bullet.label), ["收入", "现金流"]);
  assert.equal(summary.bullets[1].importance, "medium");
  assert.equal(summary.generatedAt, "2026-07-25T00:00:00.000Z");
});

test("retries failed summaries after 24 hours but never regenerates useful summaries", () => {
  const failed = {
    ticker: "MSFT",
    form: "10-Q",
    filingDate: "2026-07-24",
    accessionNumber: "a",
    headline: "",
    bullets: [],
    analystView: "",
    source: "error" as const,
    generatedAt: "2026-07-24T00:00:00.000Z",
    error: "upstream failed",
  };
  const ready = { ...failed, headline: "收入增长", source: "deepseek" as const };

  assert.equal(isSummaryRetryDue(failed, Date.parse("2026-07-24T23:59:59.000Z")), false);
  assert.equal(isSummaryRetryDue(failed, Date.parse("2026-07-25T00:00:00.000Z")), true);
  assert.equal(isSummaryRetryDue(ready, Date.parse("2027-07-25T00:00:00.000Z")), false);
});

test("parses the five newest supported filings from SEC submissions", () => {
  const payload = {
    name: "Nokia Oyj",
    filings: {
      recent: {
        accessionNumber: ["a", "b", "c", "d", "e", "f", "g"],
        form: ["6-K", "20-F", "N-PORT", "6-K/A", "10-Q", "8-K", "10-K"],
        filingDate: ["2026-07-24", "2026-03-01", "2026-02-01", "2026-01-02", "2025-11-01", "2025-10-01", "2025-09-01"],
        reportDate: ["2026-06-30", "2025-12-31", "", "2025-12-31", "2025-09-30", "", "2024-12-31"],
        primaryDocument: ["a.htm", "b.htm", "c.htm", "d.htm", "e.htm", "f.htm", "g.htm"],
        primaryDocDescription: ["Interim report", "Annual report", "", "Amendment", "", "", ""],
        items: ["", "", "", "", "", "2.02", ""],
      },
    },
  };

  const filings = parseSecSubmissions(payload, {
    ticker: "NOK",
    cik: "0000924613",
    cikNumber: 924613,
    name: "Nokia Oyj",
  }, 5);

  assert.deepEqual(filings.map((filing) => filing.form), ["6-K", "20-F", "6-K/A", "10-Q", "8-K"]);
  assert.match(filings[0].indexUrl, /924613\/a\/a-index\.html$/);
});
