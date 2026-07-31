export type EarningsSession = "before-market" | "after-market" | "unknown";

export type EarningsEvent = {
  symbol: string;
  name: string;
  date: string;
  session: EarningsSession;
};

export type EarningsCalendarSnapshot = {
  version: 1;
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  source: "Nasdaq Earnings Calendar";
  successfulDates: number;
  requestedDates: number;
  events: EarningsEvent[];
};

export type EarningsReminder = {
  releaseDateLabel: string;
  sessionLabel: string;
  viewDateLabel: string;
  viewTimeLabel: string;
  countdownLabel: string;
};

export function parseNasdaqEarningsRows(
  payload: unknown,
  date: string,
  requestedSymbols: ReadonlySet<string>,
): EarningsEvent[] {
  const data = asRecord(asRecord(payload)?.data);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const events = new Map<string, EarningsEvent>();

  for (const value of rows) {
    const row = asRecord(value);
    const symbol = typeof row?.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
    if (!requestedSymbols.has(symbol)) continue;

    const name = typeof row?.name === "string" && row.name.trim() ? row.name.trim() : symbol;
    const time = typeof row?.time === "string" ? row.time : "";
    events.set(symbol, {
      symbol,
      name,
      date,
      session: time === "time-pre-market"
        ? "before-market"
        : time === "time-after-hours"
          ? "after-market"
          : "unknown",
    });
  }

  return [...events.values()];
}

export function buildEarningsReminder(event: EarningsEvent, asOf: string | Date): EarningsReminder {
  const viewDate = event.session === "after-market" ? addDays(event.date, 1) : event.date;
  const daysUntil = dateDifference(toShanghaiDate(asOf), viewDate);

  return {
    releaseDateLabel: formatMonthDay(event.date),
    sessionLabel: event.session === "before-market" ? "盘前" : event.session === "after-market" ? "盘后" : "待定",
    viewDateLabel: formatMonthDay(viewDate),
    viewTimeLabel: event.session === "before-market" ? "晚间" : event.session === "after-market" ? "早晨" : "时间待定",
    countdownLabel: daysUntil < 0 ? "已发布" : daysUntil === 0 ? "今天" : daysUntil === 1 ? "明天" : `${daysUntil}天后`,
  };
}

export function isUpcomingEarnings(event: EarningsEvent, asOf: string | Date): boolean {
  return event.date >= toShanghaiDate(asOf);
}

export function sortEarningsEvents(events: EarningsEvent[]): EarningsEvent[] {
  return [...events].sort((left, right) => left.date.localeCompare(right.date) || left.symbol.localeCompare(right.symbol));
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dateDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function formatMonthDay(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}月${day}日`;
}

function toShanghaiDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
