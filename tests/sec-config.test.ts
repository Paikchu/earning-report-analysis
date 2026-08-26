import assert from "node:assert/strict";
import test from "node:test";

import { decodePageCursor, encodePageCursor, normalizeTrackedTicker, parseTrackedTickers } from "../lib/sec-config.ts";

test("normalizes and deduplicates tracked tickers", () => {
  assert.deepEqual(parseTrackedTickers(" msft, NVDA\nmsft "), ["MSFT", "NVDA"]);
  assert.deepEqual(parseTrackedTickers(""), []);
});

test("rejects the complete whitelist when one entry is invalid", () => {
  assert.throws(() => parseTrackedTickers("MSFT,not valid,NVDA"), /invalid ticker/i);
});

test("does not turn malformed route input into a different tracked ticker", () => {
  assert.equal(normalizeTrackedTicker("MS/FT"), "");
  assert.equal(normalizeTrackedTicker(" msft "), "MSFT");
});

test("round-trips an opaque filing cursor", () => {
  const cursor = encodePageCursor({ filingDate: "2026-06-30", accessionNumber: "0001-26-000001" });
  assert.deepEqual(decodePageCursor(cursor), { filingDate: "2026-06-30", accessionNumber: "0001-26-000001" });
  assert.equal(decodePageCursor("invalid"), null);
});
