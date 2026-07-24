import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseNasdaqEarningsRows,
  sortEarningsEvents,
  type EarningsCalendarSnapshot,
  type EarningsEvent,
} from "../lib/earnings-calendar.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");
const portfolioPath = path.join(projectRoot, "data/portfolio-snapshot.json");
const outputPath = path.join(projectRoot, "data/earnings-calendar.json");
const lookaheadDays = 90;
const minimumCoverage = 0.7;
const concurrency = 6;

type PortfolioSnapshot = {
  positions?: Array<{ symbol?: string }>;
};

async function main() {
  const now = new Date();
  const rangeStart = toDateString(now);
  const rangeEnd = addDays(rangeStart, lookaheadDays);
  const dates = datesBetween(rangeStart, rangeEnd).filter(isWeekday);
  const portfolio = JSON.parse(await readFile(portfolioPath, "utf8")) as PortfolioSnapshot;
  const symbols = new Set(
    (portfolio.positions ?? [])
      .map((position) => position.symbol?.trim().toUpperCase())
      .filter((symbol): symbol is string => Boolean(symbol)),
  );
  const previous = await readPreviousSnapshot();
  const results = await mapWithConcurrency(dates, concurrency, (date) => fetchCalendarDate(date, symbols));
  const successful = results.filter((result) => result.ok);

  if (successful.length / dates.length < minimumCoverage) {
    console.warn(`财报日历仅成功读取 ${successful.length}/${dates.length} 个交易日，保留原快照。`);
    return;
  }

  const successfulDates = new Set(successful.map((result) => result.date));
  const retainedEvents = previous.events.filter((event) => (
    event.date >= rangeStart &&
    (!isWithin(event.date, rangeStart, rangeEnd) || !successfulDates.has(event.date))
  ));
  const events = sortEarningsEvents([
    ...retainedEvents,
    ...successful.flatMap((result) => result.events),
  ].filter((event, index, all) => (
    all.findIndex((candidate) => candidate.symbol === event.symbol && candidate.date === event.date) === index
  )));

  const snapshot: EarningsCalendarSnapshot = {
    version: 1,
    generatedAt: now.toISOString(),
    rangeStart,
    rangeEnd,
    source: "Nasdaq Earnings Calendar",
    successfulDates: successful.length,
    requestedDates: dates.length,
    events,
  };
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`财报日历已更新：${events.length} 个持仓事件，覆盖 ${successful.length}/${dates.length} 个交易日。`);
}

async function fetchCalendarDate(
  date: string,
  symbols: ReadonlySet<string>,
): Promise<{ ok: true; date: string; events: EarningsEvent[] } | { ok: false; date: string }> {
  const url = new URL("https://api.nasdaq.com/api/calendar/earnings");
  url.searchParams.set("date", date);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      return { ok: true, date, events: parseNasdaqEarningsRows(await response.json(), date, symbols) };
    } catch {
      // A failed optional calendar date must not block the IBKR snapshot.
    }
  }

  return { ok: false, date };
}

async function readPreviousSnapshot(): Promise<EarningsCalendarSnapshot> {
  try {
    return JSON.parse(await readFile(outputPath, "utf8")) as EarningsCalendarSnapshot;
  } catch {
    return {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      rangeStart: "",
      rangeEnd: "",
      source: "Nasdaq Earnings Calendar",
      successfulDates: 0,
      requestedDates: 0,
      events: [],
    };
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  }));
  return results;
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function isWithin(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function toDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

await main();
