import assert from "node:assert/strict";
import test from "node:test";

import {
  htmlToSecDocument,
  htmlToSecText,
  isBusinessFiling,
  isSecFeedRefreshDue,
  isSummaryRetryDue,
  normalizeSecSummary,
  parseSecSubmissions,
  SEC_SUMMARY_VERSION,
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

test("recovers filing headings without changing flattened text", () => {
  const html = `
    <html><body>
      <div><strong>Table of Contents</strong></div>
      <h1>Item 7. Management's Discussion and Analysis</h1>
      <p>Revenue increased 18%.</p>
      <div style="font-weight: 700">Liquidity and Capital Resources</div>
      <p>Operating cash flow improved.</p>
    </body></html>
  `;

  const document = htmlToSecDocument(html);

  assert.equal(document.text, htmlToSecText(html));
  assert.deepEqual(document.headings.map(({ title }) => title), [
    "Table of Contents",
    "Item 7. Management's Discussion and Analysis",
    "Liquidity and Capital Resources",
  ]);
  assert.ok(document.headings.every((heading) => document.text.slice(heading.start).startsWith(heading.title)));
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

test("retries failed summaries after 24 hours", () => {
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

  assert.equal(isSummaryRetryDue(failed, Date.parse("2026-07-24T23:59:59.000Z")), false);
  assert.equal(isSummaryRetryDue(failed, Date.parse("2026-07-25T00:00:00.000Z")), true);
});

test("retries legacy short summaries until the current full report version exists", () => {
  const legacy = {
    ticker: "MSFT",
    form: "10-K",
    filingDate: "2026-07-30",
    accessionNumber: "annual",
    headline: "收入增长",
    bullets: [],
    analystView: "增长质量改善。",
    source: "deepseek" as const,
    generatedAt: "2026-08-01T00:00:00.000Z",
  };
  const current = { ...legacy, report: "完整分析正文。", version: SEC_SUMMARY_VERSION };

  assert.equal(isSummaryRetryDue(legacy, Date.parse("2026-08-01T01:00:00.000Z")), true);
  assert.equal(isSummaryRetryDue(current, Date.parse("2027-08-01T01:00:00.000Z")), false);
});

test("regenerates stale event summaries after a summary version bump", () => {
  const legacy = {
    ticker: "MSFT", form: "8-K", filingDate: "2026-08-10", accessionNumber: "event",
    headline: "事件影响已披露", bullets: [{ label: "事件", detail: "收入影响已量化。", importance: "high" as const }],
    analystView: "短期预期已经变化。", source: "deepseek" as const, generatedAt: "2026-08-10T00:00:00.000Z",
  };
  const current = { ...legacy, version: SEC_SUMMARY_VERSION, eventCategory: "earnings_update" as const };

  // Legacy summaries carry no exhibit-grounded version stamp, so they regenerate once.
  assert.equal(isSummaryRetryDue(legacy, Date.parse("2026-08-10T01:00:00.000Z")), true);
  assert.equal(isSummaryRetryDue(current, Date.parse("2027-08-10T00:00:00.000Z")), false);
});

test("keeps only known event categories and drops unknown ones", () => {
  const identity = { ticker: "MSFT", form: "8-K", filingDate: "2026-08-10", accessionNumber: "event" };
  const withCategory = normalizeSecSummary({ headline: "业绩更新", bullets: [{ label: "收入", detail: "收入增长。", importance: "high" }], analystView: "增长可见度提升。", eventCategory: "m&a", version: SEC_SUMMARY_VERSION }, identity);
  const withUnknown = normalizeSecSummary({ headline: "业绩更新", bullets: [{ label: "收入", detail: "收入增长。", importance: "high" }], analystView: "增长可见度提升。", eventCategory: "dividend_special", version: SEC_SUMMARY_VERSION }, identity);

  assert.equal(withCategory.eventCategory, "m&a");
  assert.equal(withUnknown.eventCategory, undefined);
});

test("retries model configuration errors immediately after the provider model is corrected", () => {
  const summary = {
    ticker: "MSFT",
    form: "10-Q",
    filingDate: "2026-07-24",
    accessionNumber: "a",
    headline: "",
    bullets: [],
    analystView: "",
    source: "error" as const,
    generatedAt: "2026-07-25T00:00:00.000Z",
    error: "DeepSeek HTTP 400",
  };

  assert.equal(isSummaryRetryDue(summary, Date.parse("2026-07-25T00:01:00.000Z")), true);
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

test("sorts supported filings by filing date before limiting", () => {
  const filings = parseSecSubmissions({
    name: "Microsoft Corp",
    filings: {
      recent: {
        accessionNumber: ["old", "new", "middle", "newer"],
        form: ["10-Q", "10-K", "8-K", "10-Q"],
        filingDate: ["2026-04-29", "2026-07-29", "2026-06-05", "2026-07-28"],
        reportDate: ["2026-03-31", "2026-06-30", "2026-06-05", "2026-06-30"],
        primaryDocument: ["old.htm", "new.htm", "middle.htm", "newer.htm"],
        primaryDocDescription: ["Quarterly report", "Annual report", "Current report", "Quarterly report"],
        items: ["", "", "", ""],
      },
    },
  }, {
    ticker: "MSFT",
    cik: "0000789019",
    cikNumber: 789019,
    name: "Microsoft Corp",
  }, 3);

  assert.deepEqual(filings.map((filing) => [filing.form, filing.filingDate]), [
    ["10-K", "2026-07-29"],
    ["10-Q", "2026-07-28"],
    ["8-K", "2026-06-05"],
  ]);
});

test("marks old SEC feeds for a background refresh", () => {
  const feed = {
    ticker: "MSFT",
    company: null,
    filings: [],
    fetchedAt: "2026-07-31T00:00:00.000Z",
    status: "ready" as const,
  };

  assert.equal(isSecFeedRefreshDue(feed, Date.parse("2026-07-31T11:59:59.000Z")), false);
  assert.equal(isSecFeedRefreshDue(feed, Date.parse("2026-07-31T12:00:00.000Z")), true);
  assert.equal(isSecFeedRefreshDue({ ...feed, status: "stale" }, Date.parse("2026-07-31T00:01:00.000Z")), true);
});

test("uses filing date only and preserves SEC order for same-day filings", () => {
  const filings = parseSecSubmissions({
    name: "Microsoft Corp",
    filings: {
      recent: {
        accessionNumber: ["annual", "current", "prior"],
        form: ["10-K", "8-K", "10-Q"],
        filingDate: ["2026-07-29", "2026-07-29", "2026-04-29"],
        reportDate: ["2026-06-30", "2026-07-29", "2026-03-31"],
        primaryDocument: ["annual.htm", "current.htm", "prior.htm"],
        primaryDocDescription: ["Annual report", "Current report", "Quarterly report"],
        items: ["", "", ""],
      },
    },
  }, {
    ticker: "MSFT",
    cik: "0000789019",
    cikNumber: 789019,
    name: "Microsoft Corp",
  });

  assert.deepEqual(filings.map((filing) => filing.accessionNumber), ["annual", "current", "prior"]);
});
