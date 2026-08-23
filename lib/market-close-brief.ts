export const MARKET_CLOSE_DISCLAIMER = "本文为公开信息的整理与分析，不构成任何投资建议。市场有风险，决策请独立判断。";

export type MarketQuote = {
  symbol: string;
  name: string;
  close: number;
  change: number;
  percent: number;
  sourceId: string;
};

export type MarketCloseBriefV1 = {
  version: 1;
  sessionDate: string;
  generatedAt: string;
  headline: string;
  summary: string;
  indices: MarketQuote[];
  etfs: MarketQuote[];
  sectors: MarketQuote[];
  movers: Array<MarketQuote & {
    catalyst: string;
    sourceIds: string[];
  }>;
  sections: Array<{
    id: string;
    title: string;
    paragraphs: string[];
    sourceIds: string[];
  }>;
  watchItems: Array<{
    title: string;
    detail: string;
  }>;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    kind: "market_data" | "primary" | "news";
  }>;
  methodology: {
    marketDataTimestamp: string;
    previousSessionDate: string | null;
    crossDayValidated: boolean;
    anomaliesDoubleSourced: boolean;
    factCheckCompleted: boolean;
    intradayFields: string[];
  };
  disclaimer: string;
};

export type MarketCloseBriefArchiveV1 = {
  version: 1;
  items: MarketCloseBriefV1[];
};

const forbiddenClaims = ["必涨", "建议买入", "抄底良机", "闭眼买"];
const requiredSectorSymbols = new Set(["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"]);

export function validateMarketCloseBrief(brief: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(brief)) return ["brief 必须是对象。"];

  if (brief.version !== 1) errors.push("version 必须为 1。");
  if (!isDateString(brief.sessionDate)) errors.push("sessionDate 必须是 YYYY-MM-DD。");
  if (!isIsoTimestamp(brief.generatedAt)) errors.push("generatedAt 必须是有效时间。");
  if (!isUsefulText(brief.headline)) errors.push("headline 不能为空。");
  if (!isUsefulText(brief.summary)) errors.push("summary 不能为空。");

  const sources = validateSources(brief.sources, errors);
  const sourceIds = new Set(sources);
  validateQuoteGroup(brief.indices, "indices", 4, 4, sourceIds, errors);
  validateQuoteGroup(brief.etfs, "etfs", 4, 8, sourceIds, errors);
  validateQuoteGroup(brief.sectors, "sectors", 11, 11, sourceIds, errors);

  if (Array.isArray(brief.sectors)) {
    const actual = new Set(brief.sectors.filter(isRecord).map((quote) => String(quote.symbol)));
    const missing = [...requiredSectorSymbols].filter((symbol) => !actual.has(symbol));
    if (missing.length) errors.push(`sectors 缺少：${missing.join(", ")}。`);
  }

  validateMovers(brief.movers, sourceIds, errors);
  validateSections(brief.sections, sourceIds, errors);
  validateWatchItems(brief.watchItems, errors);
  validateMethodology(brief.methodology, brief.sessionDate, errors);

  if (brief.disclaimer !== MARKET_CLOSE_DISCLAIMER) errors.push("disclaimer 必须使用固定免责声明。");
  const prose = JSON.stringify({ headline: brief.headline, summary: brief.summary, sections: brief.sections });
  const forbidden = forbiddenClaims.find((claim) => prose.includes(claim));
  if (forbidden) errors.push(`正文包含禁止表述：${forbidden}。`);

  return errors;
}

export function validateMarketCloseBriefArchive(archive: unknown): string[] {
  if (!isRecord(archive)) return ["archive 必须是对象。"];
  const errors: string[] = [];
  if (archive.version !== 1) errors.push("archive.version 必须为 1。");
  if (!Array.isArray(archive.items) || archive.items.length < 1) return [...errors, "archive.items 不能为空。"];

  const briefs = archive.items as unknown[];
  briefs.forEach((brief, index) => {
    validateMarketCloseBrief(brief).forEach((error) => errors.push(`items[${index}]: ${error}`));
  });

  const validBriefs = briefs.filter(isRecord).filter((brief) => isDateString(brief.sessionDate)) as unknown as MarketCloseBriefV1[];
  const dates = validBriefs.map((brief) => brief.sessionDate);
  if (new Set(dates).size !== dates.length) errors.push("archive 包含重复 sessionDate。");
  if (dates.some((date, index) => index > 0 && date >= dates[index - 1])) errors.push("archive.items 必须按交易日倒序排列。");

  for (let index = 0; index < validBriefs.length - 1; index += 1) {
    const current = validBriefs[index];
    const previous = validBriefs[index + 1];
    if (current.methodology.previousSessionDate !== previous.sessionDate) {
      errors.push(`${current.sessionDate}: previousSessionDate 必须指向 ${previous.sessionDate}。`);
      continue;
    }
    if (!current.methodology.crossDayValidated) errors.push(`${current.sessionDate}: 跨日衔接必须标记为已验证。`);
    validateCrossDayQuotes(current, previous, errors);
  }

  return errors;
}

function validateQuoteGroup(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  sourceIds: Set<string>,
  errors: string[],
) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    errors.push(`${label} 必须包含 ${minimum}${minimum === maximum ? "" : ` 至 ${maximum}`} 项。`);
    return;
  }
  const symbols = new Set<string>();
  value.forEach((quote, index) => {
    validateQuote(quote, `${label}[${index}]`, sourceIds, errors);
    if (isRecord(quote) && typeof quote.symbol === "string") {
      if (symbols.has(quote.symbol)) errors.push(`${label} 包含重复 symbol：${quote.symbol}。`);
      symbols.add(quote.symbol);
    }
  });
}

function validateQuote(value: unknown, label: string, sourceIds: Set<string>, errors: string[]) {
  if (!isRecord(value)) {
    errors.push(`${label} 必须是对象。`);
    return;
  }
  if (!isSymbol(value.symbol)) errors.push(`${label}.symbol 无效。`);
  if (!isNonEmptyText(value.name)) errors.push(`${label}.name 不能为空。`);
  if (!isFiniteNumber(value.close) || value.close <= 0) errors.push(`${label}.close 必须为正数。`);
  if (!isFiniteNumber(value.change)) errors.push(`${label}.change 必须为数字。`);
  if (!isFiniteNumber(value.percent)) errors.push(`${label}.percent 必须为数字。`);
  if (typeof value.sourceId !== "string" || !sourceIds.has(value.sourceId)) errors.push(`${label}.sourceId 无效。`);
  if (isFiniteNumber(value.close) && isFiniteNumber(value.change) && isFiniteNumber(value.percent)) {
    const previousClose = value.close - value.change;
    const calculated = previousClose === 0 ? Number.NaN : value.change / previousClose * 100;
    if (!Number.isFinite(calculated) || Math.abs(calculated - value.percent) > 0.02) {
      errors.push(`${label} 的收盘价、涨跌额与涨跌幅不自洽。`);
    }
  }
}

function validateMovers(value: unknown, sourceIds: Set<string>, errors: string[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    errors.push("movers 必须包含 1 至 10 项。");
    return;
  }
  value.forEach((mover, index) => {
    const label = `movers[${index}]`;
    validateQuote(mover, label, sourceIds, errors);
    if (!isRecord(mover)) return;
    if (!isUsefulText(mover.catalyst)) errors.push(`${label}.catalyst 不能为空。`);
    if (!Array.isArray(mover.sourceIds) || mover.sourceIds.some((id) => typeof id !== "string" || !sourceIds.has(id))) {
      errors.push(`${label}.sourceIds 无效。`);
    } else if (isFiniteNumber(mover.percent) && (mover.percent > 50 || mover.percent < -30) && new Set(mover.sourceIds).size < 2) {
      errors.push(`${label} 为异常涨跌，必须提供至少两个来源。`);
    }
  });
}

function validateSections(value: unknown, sourceIds: Set<string>, errors: string[]) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 8) {
    errors.push("sections 必须包含 3 至 8 项。");
    return;
  }
  const ids = new Set<string>();
  value.forEach((section, index) => {
    const label = `sections[${index}]`;
    if (!isRecord(section) || !isUsefulText(section.id) || !isUsefulText(section.title)) {
      errors.push(`${label} 内容不完整。`);
      return;
    }
    if (ids.has(section.id)) errors.push(`sections 包含重复 id：${section.id}。`);
    ids.add(section.id);
    if (!Array.isArray(section.paragraphs) || section.paragraphs.length < 1 || section.paragraphs.some((paragraph) => !isUsefulText(paragraph))) {
      errors.push(`${label}.paragraphs 不能为空。`);
    }
    if (!Array.isArray(section.sourceIds) || section.sourceIds.length < 1 || section.sourceIds.some((id) => typeof id !== "string" || !sourceIds.has(id))) {
      errors.push(`${label}.sourceIds 无效。`);
    }
  });
}

function validateWatchItems(value: unknown, errors: string[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    errors.push("watchItems 必须包含 1 至 5 项。");
    return;
  }
  if (value.some((item) => !isRecord(item) || !isUsefulText(item.title) || !isUsefulText(item.detail))) {
    errors.push("watchItems 内容不完整。");
  }
}

function validateSources(value: unknown, errors: string[]): string[] {
  if (!Array.isArray(value) || value.length < 4 || value.length > 40) {
    errors.push("sources 必须包含 4 至 40 项。");
    return [];
  }
  const ids = new Set<string>();
  const urls = new Set<string>();
  value.forEach((source, index) => {
    if (!isRecord(source) || !isUsefulText(source.id) || !isUsefulText(source.title)) {
      errors.push(`sources[${index}] 内容不完整。`);
      return;
    }
    if (ids.has(source.id)) errors.push(`sources 包含重复 id：${source.id}。`);
    ids.add(source.id);
    if (!isHttpsUrl(source.url)) errors.push(`sources[${index}] 必须使用 HTTPS URL。`);
    if (typeof source.url === "string") {
      if (urls.has(source.url)) errors.push(`sources 包含重复 URL：${source.url}。`);
      urls.add(source.url);
    }
    if (!new Set(["market_data", "primary", "news"]).has(String(source.kind))) errors.push(`sources[${index}].kind 无效。`);
  });
  return [...ids];
}

function validateMethodology(value: unknown, sessionDate: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("methodology 必须是对象。");
    return;
  }
  if (!isIsoTimestamp(value.marketDataTimestamp)) errors.push("methodology.marketDataTimestamp 必须是有效时间。");
  if (isDateString(sessionDate) && isIsoTimestamp(value.marketDataTimestamp)) {
    const marketDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value.marketDataTimestamp));
    if (marketDate !== sessionDate) errors.push("marketDataTimestamp 必须落在目标美股交易日。");
  }
  if (value.previousSessionDate !== null && !isDateString(value.previousSessionDate)) errors.push("previousSessionDate 必须为日期或 null。");
  if (value.previousSessionDate !== null && value.crossDayValidated !== true) errors.push("存在上一交易日时，crossDayValidated 必须为 true。");
  if (typeof value.anomaliesDoubleSourced !== "boolean") errors.push("anomaliesDoubleSourced 必须为布尔值。");
  if (value.factCheckCompleted !== true) errors.push("factCheckCompleted 必须为 true。");
  if (!Array.isArray(value.intradayFields) || value.intradayFields.some((field) => typeof field !== "string")) errors.push("intradayFields 必须为字符串列表。");
}

function validateCrossDayQuotes(current: MarketCloseBriefV1, previous: MarketCloseBriefV1, errors: string[]) {
  const previousQuotes = new Map(allQuotes(previous).map((quote) => [quote.symbol, quote.close]));
  for (const quote of allQuotes(current)) {
    const priorClose = previousQuotes.get(quote.symbol);
    if (priorClose === undefined) continue;
    const impliedPriorClose = quote.close - quote.change;
    if (Math.abs(impliedPriorClose - priorClose) > 0.02) {
      errors.push(`${current.sessionDate}: ${quote.symbol} 前收 ${impliedPriorClose.toFixed(2)} 未衔接 ${previous.sessionDate} 收盘 ${priorClose.toFixed(2)}。`);
    }
  }
}

function allQuotes(brief: MarketCloseBriefV1): MarketQuote[] {
  return [...brief.indices, ...brief.etfs, ...brief.sectors, ...brief.movers];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 3;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1;
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSymbol(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9.\-]{1,12}$/.test(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
