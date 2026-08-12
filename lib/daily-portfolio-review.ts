import type { PortfolioSnapshotV1 } from "./portfolio-snapshot.ts";

export type DailyReviewTone = "constructive" | "balanced" | "cautious";

export type DailyPortfolioReviewV1 = {
  version: 1;
  reviewDate: string;
  generatedAt: string;
  snapshotGeneratedAt: string;
  tone: DailyReviewTone;
  headline: string;
  summary: string;
  drivers: Array<{
    title: string;
    detail: string;
    implication: string;
    tickers: string[];
  }>;
  watchItems: Array<{
    label: string;
    detail: string;
  }>;
  sources: Array<{
    title: string;
    url: string;
  }>;
};

export function validateDailyPortfolioReview(review: unknown, snapshot: PortfolioSnapshotV1): string[] {
  const errors: string[] = [];
  if (!isRecord(review)) return ["review 必须是对象。"];

  if (review.version !== 1) errors.push("version 必须为 1。");
  if (!isDateString(review.reviewDate)) errors.push("reviewDate 必须是 YYYY-MM-DD。");
  if (!isIsoTimestamp(review.generatedAt)) errors.push("generatedAt 必须是有效时间。");
  if (review.snapshotGeneratedAt !== snapshot.generatedAt) errors.push("snapshotGeneratedAt 必须匹配当前持仓快照。");
  if (!new Set(["constructive", "balanced", "cautious"]).has(String(review.tone))) errors.push("tone 无效。");
  if (!isUsefulText(review.headline)) errors.push("headline 不能为空。");
  if (!isUsefulText(review.summary)) errors.push("summary 不能为空。");

  const allowedTickers = new Set(snapshot.positions.map((position) => position.symbol));
  if (!Array.isArray(review.drivers) || review.drivers.length < 1 || review.drivers.length > 4) {
    errors.push("drivers 必须包含 1 至 4 项。");
  } else {
    review.drivers.forEach((driver, index) => {
      if (!isRecord(driver) || !isUsefulText(driver.title) || !isUsefulText(driver.detail) || !isUsefulText(driver.implication)) {
        errors.push(`drivers[${index}] 内容不完整。`);
        return;
      }
      const unknownTickers = Array.isArray(driver.tickers)
        ? driver.tickers.filter((ticker) => typeof ticker !== "string" || !allowedTickers.has(ticker))
        : ["无效列表"];
      if (unknownTickers.length) {
        errors.push(`drivers[${index}] 包含未知 Ticker：${unknownTickers.join(", ")}。`);
      }
    });
  }

  if (!Array.isArray(review.watchItems) || review.watchItems.length < 1 || review.watchItems.length > 3) {
    errors.push("watchItems 必须包含 1 至 3 项。");
  } else if (review.watchItems.some((item) => !isRecord(item) || !isUsefulText(item.label) || !isUsefulText(item.detail))) {
    errors.push("watchItems 内容不完整。");
  }

  if (!Array.isArray(review.sources) || review.sources.length < 1 || review.sources.length > 8) {
    errors.push("sources 必须包含 1 至 8 项。");
  } else {
    review.sources.forEach((source, index) => {
      if (!isRecord(source) || !isUsefulText(source.title)) errors.push(`sources[${index}] 标题无效。`);
      if (!isHttpsUrl(isRecord(source) ? source.url : null)) errors.push(`sources[${index}] 必须使用 HTTPS URL。`);
    });
  }

  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 4;
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
