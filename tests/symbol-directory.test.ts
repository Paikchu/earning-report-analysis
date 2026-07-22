import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNasdaqListed,
  parseOtherListed,
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

test("ranks held symbols before exact, symbol prefix, and company matches", () => {
  const entries: SymbolDirectoryEntry[] = [
    { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", type: "stock" },
    { symbol: "APLE", name: "Apple Hospitality REIT", exchange: "NYSE", type: "stock" },
    { symbol: "PINE", name: "Alpine Income Property Trust", exchange: "NYSE", type: "stock" },
  ];

  const results = searchSecurities(entries, "apple", new Set(["APLE"]), 10);
  assert.deepEqual(results.map((result) => result.symbol), ["APLE", "AAPL"]);
});
