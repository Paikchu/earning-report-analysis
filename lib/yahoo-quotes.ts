export type MarketQuote = {
  price: number;
  changePercent: number;
  marketTime: string;
  rsi14: number | null;
};

export type MarketQuoteMap = Record<string, MarketQuote>;

type SymbolParseResult =
  | { ok: true; symbols: string[] }
  | { ok: false; error: string };

const TICKER_PATTERN = /^\^?[A-Z0-9][A-Z0-9.-]{0,14}$/;

export function parseYahooSparkQuotes(payload: unknown, requestedSymbols: string[]): MarketQuoteMap {
  const root = asRecord(payload);
  const spark = asRecord(root?.spark);
  const results = Array.isArray(spark?.result) ? spark.result : [];
  const localByYahoo = new Map(requestedSymbols.map((symbol) => [toYahooSymbol(symbol), symbol]));
  const parsed = new Map<string, MarketQuote>();

  for (const resultValue of results) {
    const result = asRecord(resultValue);
    const yahooSymbol = typeof result?.symbol === "string" ? result.symbol.toUpperCase() : "";
    const localSymbol = localByYahoo.get(yahooSymbol);
    const responses = Array.isArray(result?.response) ? result.response : [];
    const response = asRecord(responses[0]);
    const meta = asRecord(response?.meta);
    const price = meta?.regularMarketPrice;
    const marketTime = meta?.regularMarketTime;
    const indicators = asRecord(response?.indicators);
    const quoteSeries = Array.isArray(indicators?.quote) ? asRecord(indicators.quote[0]) : null;
    const closes = Array.isArray(quoteSeries?.close)
      ? quoteSeries.close.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
      : [];
    const previousClose = closes.at(-2) ?? (isPositiveFinite(meta?.previousClose) ? meta.previousClose : meta?.chartPreviousClose);

    if (
      !localSymbol ||
      !isPositiveFinite(price) ||
      !isPositiveFinite(previousClose) ||
      !isPositiveFinite(marketTime)
    ) continue;

    parsed.set(localSymbol, {
      price,
      changePercent: ((price - previousClose) / previousClose) * 100,
      marketTime: new Date(marketTime * 1_000).toISOString(),
      rsi14: calculateRsi(closes),
    });
  }

  return Object.fromEntries(
    requestedSymbols.flatMap((symbol) => {
      const quote = parsed.get(symbol);
      return quote ? [[symbol, quote]] : [];
    }),
  );
}

export function parseRequestedSymbols(value: string | null): SymbolParseResult {
  if (!value?.trim()) return { ok: false, error: "缺少 Ticker 参数。" };

  const symbols = [...new Set(value.split(",").map((symbol) => symbol.trim().toUpperCase()))];
  if (symbols.length > 50) return { ok: false, error: "一次最多查询 50 个 Ticker。" };
  if (symbols.some((symbol) => !TICKER_PATTERN.test(symbol))) {
    return { ok: false, error: "Ticker 参数无效。" };
  }

  return { ok: true, symbols };
}

export async function fetchYahooQuotes(
  symbols: string[],
  fetcher: typeof fetch = fetch,
): Promise<MarketQuoteMap> {
  const url = new URL("https://query1.finance.yahoo.com/v7/finance/spark");
  url.searchParams.set("symbols", symbols.map(toYahooSymbol).join(","));
  url.searchParams.set("range", "3mo");
  url.searchParams.set("interval", "1d");

  const response = await fetcher(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Yahoo Finance 请求失败：${response.status}`);

  return parseYahooSparkQuotes(await response.json(), symbols);
}

export function calculateRsi(closes: number[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 1 || closes.length <= period) return null;

  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index]! - closes[index - 1]!;
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= period;
  averageLoss /= period;

  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index]! - closes[index - 1]!;
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
  }

  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;
  return 100 - (100 / (1 + averageGain / averageLoss));
}

export async function handleQuoteRequest(
  request: Request,
  user: { email: string } | null,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!user) return Response.json({ error: "未登录。" }, { status: 401 });

  const parsed = parseRequestedSymbols(new URL(request.url).searchParams.get("symbols"));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const quotes = await fetchYahooQuotes(parsed.symbols, fetcher);
    return Response.json({ quotes }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "行情暂时无法获取。" }, { status: 502 });
  }
}

function toYahooSymbol(symbol: string): string {
  return symbol.replaceAll(".", "-");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
