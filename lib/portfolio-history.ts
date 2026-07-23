export type PortfolioHistoryRange = "1M" | "3M" | "YTD" | "ALL";

export interface PortfolioHistoryPoint {
  date: string;
  generatedAt: string;
  netLiquidation: number;
  netDeposits: number;
}

type PortfolioHistoryInput = Omit<PortfolioHistoryPoint, "date">;

export function shanghaiDate(isoTimestamp: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoTimestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function upsertPortfolioHistory(
  history: PortfolioHistoryPoint[],
  point: PortfolioHistoryInput,
): PortfolioHistoryPoint[] {
  const next = {
    date: shanghaiDate(point.generatedAt),
    ...point,
  };
  const byDate = new Map(history.map((item) => [item.date, item]));
  byDate.set(next.date, next);
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function shiftUtcMonth(date: Date, count: number) {
  const shifted = new Date(date);
  shifted.setUTCMonth(shifted.getUTCMonth() + count);
  return shifted;
}

export function filterPortfolioHistory(
  history: PortfolioHistoryPoint[],
  range: PortfolioHistoryRange,
): PortfolioHistoryPoint[] {
  const sorted = [...history].sort((left, right) => left.date.localeCompare(right.date));
  const latest = sorted.at(-1);
  if (!latest || range === "ALL") return sorted;

  const latestDate = new Date(`${latest.date}T00:00:00.000Z`);
  const threshold = range === "YTD"
    ? `${latestDate.getUTCFullYear()}-01-01`
    : shiftUtcMonth(latestDate, range === "1M" ? -1 : -3).toISOString().slice(0, 10);
  return sorted.filter((point) => point.date >= threshold);
}
