import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEarningsReminder,
  isUpcomingEarnings,
  parseNasdaqEarningsRows,
  sortEarningsEvents,
} from "../lib/earnings-calendar.ts";

const payload = {
  data: {
    rows: [
      { symbol: "MSFT", name: "Microsoft Corporation", time: "time-after-hours" },
      { symbol: "AVGO", name: "Broadcom Inc.", time: "time-pre-market" },
      { symbol: "OTHER", name: "Other Corp.", time: "time-not-supplied" },
    ],
  },
};

test("parses held tickers and Nasdaq release sessions", () => {
  assert.deepEqual(parseNasdaqEarningsRows(payload, "2026-07-28", new Set(["MSFT", "AVGO"])), [
    { symbol: "MSFT", name: "Microsoft Corporation", date: "2026-07-28", session: "after-market" },
    { symbol: "AVGO", name: "Broadcom Inc.", date: "2026-07-28", session: "before-market" },
  ]);
});

test("converts US release sessions into Beijing viewing reminders", () => {
  assert.deepEqual(
    buildEarningsReminder(
      { symbol: "MSFT", name: "Microsoft", date: "2026-07-28", session: "after-market" },
      "2026-07-24T04:00:00.000Z",
    ),
    {
      releaseDateLabel: "7月28日",
      sessionLabel: "盘后",
      viewDateLabel: "7月29日",
      viewTimeLabel: "早晨",
      countdownLabel: "5天后",
    },
  );
  assert.equal(
    buildEarningsReminder(
      { symbol: "AVGO", name: "Broadcom", date: "2026-07-24", session: "before-market" },
      "2026-07-23T18:00:00.000Z",
    ).countdownLabel,
    "今天",
  );
});

test("sorts earnings by date and ticker", () => {
  const events = sortEarningsEvents([
    { symbol: "NVDA", name: "NVIDIA", date: "2026-08-27", session: "after-market" },
    { symbol: "MSFT", name: "Microsoft", date: "2026-07-28", session: "after-market" },
    { symbol: "AVGO", name: "Broadcom", date: "2026-08-27", session: "after-market" },
  ]);

  assert.deepEqual(events.map((event) => event.symbol), ["MSFT", "AVGO", "NVDA"]);
});

test("excludes earnings dates that have already passed in Beijing", () => {
  const event = { symbol: "MSFT", name: "Microsoft", date: "2026-07-29", session: "after-market" } as const;

  assert.equal(isUpcomingEarnings(event, "2026-07-29T15:59:59.000Z"), true);
  assert.equal(isUpcomingEarnings(event, "2026-07-29T16:00:00.000Z"), false);
});
