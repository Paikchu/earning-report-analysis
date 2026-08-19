import type { PortfolioSnapshotV1 } from "./portfolio-snapshot.ts";

export type MacroCoverageStatus = "complete" | "partial";
export type MacroImpactDirection = "tailwind" | "headwind" | "mixed" | "unclear";
export type MacroImpactHorizon = "immediate" | "near_term" | "medium_term";
export type MacroConfidence = "high" | "medium" | "low";
export type MacroChannel = "rates" | "inflation" | "growth" | "liquidity" | "usd" | "volatility";

export type MacroDashboardV1 = {
  version: 1;
  reviewDate: string;
  generatedAt: string;
  portfolioSnapshotGeneratedAt: string;
  coverageStatus: MacroCoverageStatus;
  coverageNote?: string;
  headline: string;
  summary: string;
  impacts: Array<{
    eventId: string;
    title: string;
    fact: string;
    transmission: string;
    channels: MacroChannel[];
    direction: MacroImpactDirection;
    horizon: MacroImpactHorizon;
    confidence: MacroConfidence;
    tickers: string[];
    implication: string;
    sourceIds: string[];
  }>;
  upcomingEvents: Array<{
    id: string;
    title: string;
    scheduledAt: string;
    importance: "high" | "medium";
    status: "scheduled";
    actual?: string;
    previous?: string;
    unit?: string;
    sourceIds: string[];
  }>;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    publishedAt?: string;
  }>;
};

const coverageStatuses = new Set(["complete", "partial"]);
const directions = new Set(["tailwind", "headwind", "mixed", "unclear"]);
const horizons = new Set(["immediate", "near_term", "medium_term"]);
const confidences = new Set(["high", "medium", "low"]);
const channels = new Set(["rates", "inflation", "growth", "liquidity", "usd", "volatility"]);

export function validateMacroDashboard(dashboard: unknown, snapshot: PortfolioSnapshotV1): string[] {
  const errors: string[] = [];
  if (!isRecord(dashboard)) return ["dashboard 必须是对象。"];

  if (dashboard.version !== 1) errors.push("version 必须为 1。");
  if (!isDateString(dashboard.reviewDate)) errors.push("reviewDate 必须是 YYYY-MM-DD。");
  if (!isIsoTimestamp(dashboard.generatedAt)) errors.push("generatedAt 必须是有效时间。");
  if (
    isDateString(dashboard.reviewDate) &&
    isIsoTimestamp(dashboard.generatedAt) &&
    shanghaiDate(dashboard.generatedAt) !== dashboard.reviewDate
  ) errors.push("reviewDate 必须匹配 generatedAt 的上海日期。");
  if (dashboard.portfolioSnapshotGeneratedAt !== snapshot.generatedAt) {
    errors.push("portfolioSnapshotGeneratedAt 必须匹配当前持仓快照。");
  }
  if (!coverageStatuses.has(String(dashboard.coverageStatus))) errors.push("coverageStatus 无效。");
  if (dashboard.coverageStatus === "partial" && !isUsefulText(dashboard.coverageNote)) {
    errors.push("partial 状态必须提供 coverageNote。");
  }
  if (!isUsefulText(dashboard.headline)) errors.push("headline 不能为空。");
  if (!isUsefulText(dashboard.summary)) errors.push("summary 不能为空。");

  const sources = validateSources(dashboard.sources, errors);
  const sourceIds = new Set(sources.keys());
  const allowedTickers = new Set(snapshot.positions.map((position) => position.symbol));
  validateImpacts(dashboard.impacts, dashboard.generatedAt, allowedTickers, sources, errors);
  validateEvents(dashboard.upcomingEvents, dashboard.reviewDate, sourceIds, errors);

  return errors;
}

function validateSources(value: unknown, errors: string[]): Map<string, string | undefined> {
  const sources = new Map<string, string | undefined>();
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    errors.push("sources 必须包含 1 至 20 项。");
    return sources;
  }
  value.forEach((source, index) => {
    if (!isRecord(source) || !isUsefulText(source.id) || !isUsefulText(source.title)) {
      errors.push(`sources[${index}] 内容不完整。`);
      return;
    }
    if (sources.has(source.id)) errors.push(`sources 包含重复 id：${source.id}。`);
    sources.set(source.id, typeof source.publishedAt === "string" ? source.publishedAt : undefined);
    if (!isHttpsUrl(source.url)) errors.push(`sources[${index}] 必须使用 HTTPS URL。`);
    if (source.publishedAt !== undefined && !isIsoTimestamp(source.publishedAt)) {
      errors.push(`sources[${index}].publishedAt 必须是有效时间。`);
    }
  });
  return sources;
}

function validateImpacts(
  value: unknown,
  generatedAt: unknown,
  allowedTickers: Set<string>,
  sources: Map<string, string | undefined>,
  errors: string[],
) {
  if (!Array.isArray(value) || value.length > 8) {
    errors.push("impacts 必须包含 0 至 8 项。");
    return;
  }
  const eventIds = new Set<string>();
  value.forEach((impact, index) => {
    if (!isRecord(impact)) {
      errors.push(`impacts[${index}] 必须是对象。`);
      return;
    }
    for (const field of ["eventId", "title", "fact", "transmission", "implication"] as const) {
      if (!isUsefulText(impact[field])) errors.push(`impacts[${index}].${field} 不能为空。`);
    }
    if (typeof impact.eventId === "string") {
      if (eventIds.has(impact.eventId)) errors.push(`impacts 包含重复 eventId：${impact.eventId}。`);
      eventIds.add(impact.eventId);
    }
    if (!directions.has(String(impact.direction))) errors.push(`impacts[${index}].direction 无效。`);
    if (!horizons.has(String(impact.horizon))) errors.push(`impacts[${index}].horizon 无效。`);
    if (!confidences.has(String(impact.confidence))) errors.push(`impacts[${index}].confidence 无效。`);
    if (!Array.isArray(impact.channels) || impact.channels.length < 1 || impact.channels.some((item) => !channels.has(String(item)))) {
      errors.push(`impacts[${index}].channels 无效。`);
    }
    if (!Array.isArray(impact.tickers) || impact.tickers.length < 1) {
      errors.push(`impacts[${index}].tickers 不能为空。`);
    } else {
      const unknown = impact.tickers.filter((ticker) => typeof ticker !== "string" || !allowedTickers.has(ticker));
      if (unknown.length) errors.push(`impacts[${index}] 包含未知 Ticker：${unknown.join(", ")}。`);
    }
    validateSourceRefs(impact.sourceIds, new Set(sources.keys()), `impacts[${index}]`, errors);
    if (isIsoTimestamp(generatedAt) && !hasRecentPublishedSource(impact.sourceIds, sources, generatedAt)) {
      errors.push(`impacts[${index}] 必须引用过去 24 小时内发布的来源。`);
    }
  });
}

function hasRecentPublishedSource(value: unknown, sources: Map<string, string | undefined>, generatedAt: string): boolean {
  if (!Array.isArray(value)) return false;
  const generated = Date.parse(generatedAt);
  return value.some((id) => {
    const publishedAt = typeof id === "string" ? sources.get(id) : undefined;
    if (!publishedAt || !isIsoTimestamp(publishedAt)) return false;
    const published = Date.parse(publishedAt);
    return published <= generated && published >= generated - 24 * 60 * 60 * 1000;
  });
}

function validateEvents(value: unknown, reviewDate: unknown, sourceIds: Set<string>, errors: string[]) {
  if (!Array.isArray(value) || value.length > 20) {
    errors.push("upcomingEvents 必须包含 0 至 20 项。");
    return;
  }
  const ids = new Set<string>();
  const lastDate = isDateString(reviewDate) ? addDays(reviewDate, 7) : null;
  value.forEach((event, index) => {
    if (!isRecord(event)) {
      errors.push(`upcomingEvents[${index}] 必须是对象。`);
      return;
    }
    if (!isUsefulText(event.id) || !isUsefulText(event.title)) errors.push(`upcomingEvents[${index}] 内容不完整。`);
    if (typeof event.id === "string") {
      if (ids.has(event.id)) errors.push(`upcomingEvents 包含重复 id：${event.id}。`);
      ids.add(event.id);
    }
    if (!isIsoTimestamp(event.scheduledAt)) {
      errors.push(`upcomingEvents[${index}].scheduledAt 必须是有效时间。`);
    } else if (isDateString(reviewDate) && lastDate) {
      const eventDate = shanghaiDate(event.scheduledAt);
      if (eventDate < reviewDate || eventDate > lastDate) errors.push(`upcomingEvents[${index}] 必须位于未来 7 天内。`);
    }
    if (!new Set(["high", "medium"]).has(String(event.importance))) errors.push(`upcomingEvents[${index}].importance 无效。`);
    if (event.status !== "scheduled") errors.push(`upcomingEvents[${index}].status 必须为 scheduled。`);
    for (const field of ["actual", "previous", "unit"] as const) {
      if (event[field] !== undefined && typeof event[field] !== "string") errors.push(`upcomingEvents[${index}].${field} 必须是字符串。`);
    }
    validateSourceRefs(event.sourceIds, sourceIds, `upcomingEvents[${index}]`, errors);
  });
}

function validateSourceRefs(value: unknown, sourceIds: Set<string>, label: string, errors: string[]) {
  if (!Array.isArray(value) || value.length < 1) {
    errors.push(`${label}.sourceIds 不能为空。`);
    return;
  }
  const unknown = value.filter((id) => typeof id !== "string" || !sourceIds.has(id));
  if (unknown.length) errors.push(`${label} 包含未解析 sourceId：${unknown.join(", ")}。`);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return shanghaiDate(value.toISOString());
}

function shanghaiDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2;
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
