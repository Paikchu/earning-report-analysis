import {
  cleanSecTicker,
  htmlToSecText,
  isSummaryRetryDue,
  normalizeSecSummary,
  parseSecSubmissions,
  sortSecFilings,
  type SecCompany,
  type SecFiling,
  type SecFilingFeed,
  type SecFilingSummary,
} from "./sec.ts";

const TICKER_MAP_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const FILING_TEXT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const SEC_FETCH_INTERVAL_MS = 200;
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export type SecCacheRecord<T> = {
  payload: T;
  fetchedAt: string;
};

export type SecRepository = {
  getCache<T>(key: string): Promise<SecCacheRecord<T> | null>;
  setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void>;
  getSummary(ticker: string, accessionNumber: string): Promise<SecFilingSummary | null>;
  setSummary(summary: SecFilingSummary): Promise<void>;
};

export type SecServiceRuntime = {
  apiKey: string;
  model: string;
  userAgent: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
};

type StoredSecFeed = Omit<SecFilingFeed, "filings"> & {
  filings: SecFiling[];
};

export async function getCachedSecFeed(repository: SecRepository, rawTicker: string): Promise<SecFilingFeed> {
  const ticker = cleanSecTicker(rawTicker);
  const cached = await repository.getCache<StoredSecFeed>(filingCacheKey(ticker));
  if (!cached) return { ticker, company: null, filings: [], fetchedAt: null, status: "pending" };
  const filings = await Promise.all(sortSecFilings(cached.payload.filings).map(async (filing) => ({
    ...filing,
    summary: await repository.getSummary(ticker, filing.accessionNumber),
  })));
  return { ...cached.payload, filings };
}

export async function refreshSecTicker(
  repository: SecRepository,
  rawTicker: string,
  runtime: SecServiceRuntime,
): Promise<SecFilingFeed> {
  const ticker = cleanSecTicker(rawTicker);
  const now = (runtime.now ?? (() => new Date()))();
  const fetcher = runtime.fetcher ?? fetch;
  const wait = runtime.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastSecRequestAt = 0;
  const secRequest = async (url: string, accept = "application/json") => {
    const elapsed = Date.now() - lastSecRequestAt;
    if (lastSecRequestAt && elapsed < SEC_FETCH_INTERVAL_MS) await wait(SEC_FETCH_INTERVAL_MS - elapsed);
    const response = await fetcher(url, {
      cache: "no-store",
      headers: { accept, "user-agent": runtime.userAgent },
      signal: AbortSignal.timeout(15_000),
    });
    lastSecRequestAt = Date.now();
    if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
    return response;
  };

  try {
    const company = await getCompany(repository, ticker, now, secRequest);
    if (!company) {
      const unsupported: StoredSecFeed = {
        ticker,
        company: null,
        filings: [],
        fetchedAt: now.toISOString(),
        status: "unsupported",
      };
      await repository.setCache(filingCacheKey(ticker), unsupported, now.toISOString());
      return { ...unsupported, filings: [] };
    }

    const submissionsResponse = await secRequest(`https://data.sec.gov/submissions/CIK${company.cik}.json`);
    const filings = parseSecSubmissions(await submissionsResponse.json(), company, 5);
    const stored: StoredSecFeed = {
      ticker,
      company: { ticker, cik: company.cik, name: filings[0]?.companyName ?? company.name },
      filings,
      fetchedAt: now.toISOString(),
      status: filings.length ? "ready" : "empty",
    };
    await repository.setCache(filingCacheKey(ticker), stored, now.toISOString());

    for (const filing of filings) {
      const cachedSummary = await repository.getSummary(ticker, filing.accessionNumber);
      if (cachedSummary && !isSummaryRetryDue(cachedSummary, now.getTime())) continue;
      const summary = await summarizeFiling(repository, filing, runtime, now, secRequest);
      await repository.setSummary(summary);
    }

    return getCachedSecFeed(repository, ticker);
  } catch {
    const previous = await getCachedSecFeed(repository, ticker);
    if (previous.status !== "pending") {
      return {
        ...previous,
        status: "stale",
        error: "SEC 数据暂时无法更新，当前显示上次成功结果。",
      };
    }
    throw new Error("SEC 数据暂时无法更新。");
  }
}

async function getCompany(
  repository: SecRepository,
  ticker: string,
  now: Date,
  secRequest: (url: string, accept?: string) => Promise<Response>,
): Promise<SecCompany | null> {
  const cacheKey = "sec:ticker-map";
  const cached = await repository.getCache<Record<string, SecCompany>>(cacheKey);
  let tickerMap = cached && isFresh(cached.fetchedAt, TICKER_MAP_TTL_MS, now.getTime()) ? cached.payload : null;
  if (!tickerMap) {
    const response = await secRequest("https://www.sec.gov/files/company_tickers_exchange.json");
    tickerMap = parseTickerMap(await response.json());
    await repository.setCache(cacheKey, tickerMap, now.toISOString());
  }
  return tickerMap[ticker] ?? null;
}

function parseTickerMap(payload: unknown): Record<string, SecCompany> {
  const root = asRecord(payload);
  const fields = Array.isArray(root?.fields) ? root.fields.map(String) : [];
  const data = Array.isArray(root?.data) ? root.data : [];
  const tickerIndex = fields.indexOf("ticker");
  const cikIndex = fields.indexOf("cik");
  const nameIndex = fields.indexOf("name");
  const result: Record<string, SecCompany> = {};
  for (const value of data) {
    if (!Array.isArray(value)) continue;
    const ticker = cleanSecTicker(String(value[tickerIndex] ?? ""));
    const cikNumber = Number(value[cikIndex]);
    if (!ticker || !Number.isFinite(cikNumber)) continue;
    result[ticker] = {
      ticker,
      cik: String(cikNumber).padStart(10, "0"),
      cikNumber,
      name: String(value[nameIndex] ?? ""),
    };
  }
  return result;
}

async function summarizeFiling(
  repository: SecRepository,
  filing: SecFiling,
  runtime: SecServiceRuntime,
  now: Date,
  secRequest: (url: string, accept?: string) => Promise<Response>,
): Promise<SecFilingSummary> {
  try {
    if (!runtime.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
    const text = await getFilingText(repository, filing, now, secRequest);
    const sections = splitFilingSections(text);
    const response = await (runtime.fetcher ?? fetch)(DEEPSEEK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${runtime.apiKey}` },
      body: JSON.stringify({
        model: runtime.model,
        messages: [
          { role: "system", content: summarySystemPrompt(filing.form) },
          {
            role: "user",
            content: JSON.stringify({
              ticker: filing.ticker,
              form: filing.form,
              filingDate: filing.filingDate,
              reportDate: filing.reportDate,
              accessionNumber: filing.accessionNumber,
              sections,
            }),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const data = asRecord(await response.json());
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice?.message);
    if (typeof message?.content !== "string" || !message.content) throw new Error("DeepSeek returned empty content");
    return normalizeSecSummary({ ...parseJsonObject(message.content), source: "deepseek" }, filing, now);
  } catch (error) {
    return normalizeSecSummary({
      source: "error",
      error: error instanceof Error ? error.message : "summary failed",
    }, filing, now);
  }
}

async function getFilingText(
  repository: SecRepository,
  filing: SecFiling,
  now: Date,
  secRequest: (url: string, accept?: string) => Promise<Response>,
): Promise<string> {
  const cacheKey = `sec:text:${filing.ticker}:${filing.accessionNumber}`;
  const cached = await repository.getCache<{ text: string }>(cacheKey);
  if (cached && isFresh(cached.fetchedAt, FILING_TEXT_TTL_MS, now.getTime()) && cached.payload.text) {
    return cached.payload.text;
  }
  const response = await secRequest(filing.documentUrl, "text/html,application/xhtml+xml,text/plain,*/*");
  const text = htmlToSecText(await response.text()).slice(0, 60_000);
  if (!text) throw new Error("SEC filing document did not contain readable text");
  await repository.setCache(cacheKey, { text }, now.toISOString());
  return text;
}

function splitFilingSections(text: string): Array<{ name: string; text: string }> {
  const definitions: Array<[string, RegExp]> = [
    ["businessUpdate", /business update|overview|recent developments/i],
    ["revenueDrivers", /revenue|sales/i],
    ["margins", /gross margin|operating income|margin/i],
    ["liquidity", /liquidity|cash flow|working capital/i],
    ["guidance", /guidance|outlook|forecast|expect/i],
    ["riskFactors", /risk factors/i],
    ["subsequentEvents", /subsequent events/i],
  ];
  const buckets = Object.fromEntries(definitions.map(([name]) => [name, [] as string[]]));
  let current = "businessUpdate";
  for (const line of text.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const match = definitions.find(([, pattern]) => pattern.test(line));
    if (match) current = match[0];
    if (buckets[current].join(" ").length < 4_500) buckets[current].push(line);
  }
  return definitions.flatMap(([name]) => {
    const content = buckets[name].join("\n").slice(0, 4_500);
    return content ? [{ name, text: content }] : [];
  });
}

function summarySystemPrompt(form: string): string {
  const focus = form.startsWith("8-K") || form.startsWith("6-K")
    ? "说明事件本身、发生原因，以及对盈利、现金流或资产负债表的具体影响。"
    : "说明收入与增长驱动、利润率、现金流、资本开支、管理层指引和关键风险的变化。";
  return [
    "你是负责美股基本面研究的资深金融分析师。",
    "只根据给定 SEC filing 内容输出简体中文，不使用外部信息，不编造数字。",
    focus,
    "没有证据的维度直接省略。禁止输出需要复核、未找到、建议关注等空泛措辞。",
    "headline 是一句有方向性的结论；bullets 输出 3 至 5 条具体事实；analystView 说明对投资判断的含义，但不给买卖建议。",
    "输出 JSON：{\"headline\":\"\",\"bullets\":[{\"label\":\"\",\"detail\":\"\",\"importance\":\"high|medium|low\"}],\"analystView\":\"\"}",
  ].join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object");
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function isFresh(timestamp: string, ttlMs: number, nowMs: number): boolean {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && nowMs - parsed < ttlMs;
}

function filingCacheKey(ticker: string): string {
  return `sec:filings:${ticker}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
