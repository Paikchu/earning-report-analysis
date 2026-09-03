import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRegistrantForms,
  classifySecurity,
  needsRegistrantCheck,
  parseNasdaqListed,
  parseOtherListed,
  parseSecurityTypes,
  searchSecurities,
  type SymbolDirectoryEntry,
} from "../lib/symbol-directory.ts";

test("parses official symbol files and excludes test issues and footers", () => {
  const nasdaq = parseNasdaqListed([
    "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
    "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
    "QQQ|Invesco QQQ Trust|Q|N|N|100|Y|N",
    "TESTW|Test Acquisition Corp. - Warrant|S|N|N|100|N|N",
    "ZTEST|Test Security|Q|Y|N|100|N|N",
    "File Creation Time: 0722202612:00|||||||",
  ].join("\n"));
  const other = parseOtherListed([
    "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
    "BRK.B|Berkshire Hathaway Inc. Class B|N|BRK.B|N|100|N|BRK-B",
  ].join("\n"));

  assert.deepEqual(nasdaq.map(({ symbol, type }) => ({ symbol, type })), [
    { symbol: "AAPL", type: "stock" },
    { symbol: "QQQ", type: "etf" },
  ]);
  assert.equal(other[0].symbol, "BRK.B");
  assert.equal(other[0].exchange, "NYSE");
});

test("classifies non-common securities out of the stock universe", () => {
  const cases: Array<[string, string, string, string]> = [
    ["AAPL", "Apple Inc. - Common Stock", "N", "stock"],
    ["AKO.A", "Embotelladora Andina S.A. Common Stock", "N", "stock"],
    ["ABEV", "Ambev S.A. American Depositary Shares (Each representing 1 Common Share)", "N", "stock"],
    ["ABR", "Arbor Realty Trust Common Stock", "N", "stock"],
    ["SPY", "SPDR S&P 500", "Y", "etf"],
    ["DJP", "iPath Bloomberg Commodity Index Total Return ETN", "N", "etn"],
    ["ABR$D", "Arbor Realty Trust 6.375% Series D Cumulative Redeemable Preferred Stock", "N", "preferred"],
    ["ACGLN", "Arch Capital Group Ltd. - Depositary Shares, each Representing a 1/1,000th Interest in a 4.550% Non-Cumulative Preferred Share, Series G", "N", "preferred"],
    ["ABXL", "Abacus Global Management, Inc. 9.875% Fixed Rate Senior Notes due 2028", "N", "bond"],
    ["DDT", "Dillard's Capital Trust I", "N", "bond"],
    ["KTN", "Structured Products Corp 8.205% CorTS 8.205% Corporate Backed Trust Securities (CorTS)", "N", "bond"],
    ["ACP", "abrdn Income Credit Strategies Fund Common Shares", "N", "fund"],
  ];

  for (const [symbol, name, etf, expected] of cases) {
    assert.equal(classifySecurity(symbol, name, etf), expected, `${symbol} should be ${expected}`);
  }
});

test("uses EDGAR filing history to split closed-end funds from REITs and BDCs", () => {
  const arcc: SymbolDirectoryEntry = { symbol: "ARCC", name: "Ares Capital Corporation - Closed End Fund", exchange: "NASDAQ", type: "fund" };
  const bbn: SymbolDirectoryEntry = { symbol: "BBN", name: "BlackRock Taxable Municipal Bond Trust", exchange: "NYSE", type: "stock" };
  const aapl: SymbolDirectoryEntry = { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", type: "stock" };

  assert.equal(needsRegistrantCheck(arcc), true);
  assert.equal(needsRegistrantCheck(bbn), true);
  assert.equal(needsRegistrantCheck(aapl), false);

  assert.equal(applyRegistrantForms(arcc, ["10-K", "10-Q", "8-K"]).type, "stock");
  assert.equal(applyRegistrantForms(bbn, ["N-CSR", "NPORT-P"]).type, "fund");
  assert.equal(applyRegistrantForms(bbn, null).type, "stock");
  assert.equal(applyRegistrantForms(aapl, ["N-CSR"]).type, "stock");
});

test("reads requested security types and falls back to stocks only", () => {
  assert.deepEqual(parseSecurityTypes(null), ["stock"]);
  assert.deepEqual(parseSecurityTypes(""), ["stock"]);
  assert.deepEqual(parseSecurityTypes("bogus"), ["stock"]);
  assert.deepEqual(parseSecurityTypes("etf, stock ,etf"), ["etf", "stock"]);
});

test("ranks exact symbol, symbol prefix, and company matches in that order", () => {
  const entries: SymbolDirectoryEntry[] = [
    { symbol: "PINE", name: "Alpine Income Property Trust", exchange: "NYSE", type: "stock" },
    { symbol: "QRS", name: "Nippon APL Holdings", exchange: "NYSE", type: "stock" },
    { symbol: "XYZ", name: "APL Logistics", exchange: "NYSE", type: "stock" },
    { symbol: "APLD", name: "Applied Digital", exchange: "NASDAQ", type: "stock" },
    { symbol: "APL", name: "Amplitude", exchange: "NASDAQ", type: "stock" },
  ];

  const results = searchSecurities(entries, "apl", 10);
  assert.deepEqual(results.map((result) => result.symbol), ["APL", "APLD", "XYZ", "QRS"]);
});

test("hides ETFs, funds, preferreds and bonds unless the caller asks for them", () => {
  const entries: SymbolDirectoryEntry[] = [
    { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", type: "stock" },
    { symbol: "AAPB", name: "GraniteShares 2x Long AAPL Daily ETF", exchange: "NASDAQ", type: "etf" },
    { symbol: "AAPY", name: "Kurv Yield Premium Strategy Apple ETF", exchange: "Cboe BZX", type: "etf" },
    { symbol: "ABR$D", name: "Arbor Realty Trust Series D Preferred", exchange: "NYSE", type: "preferred" },
  ];

  assert.deepEqual(searchSecurities(entries, "AAP", 10).map((result) => result.symbol), ["AAPL"]);
  assert.deepEqual(
    searchSecurities(entries, "AAP", 10, ["stock", "etf"]).map((result) => result.symbol),
    ["AAPB", "AAPL", "AAPY"],
  );
});
