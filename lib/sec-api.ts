import { cleanSecTicker, type SecFilingFeed } from "./sec.ts";
import { getCachedSecFeed, type SecRepository } from "./sec-service.ts";

type SecSecurity = {
  symbol: string;
  type: "stock" | "etf";
};

export async function hasInternalSecAccess(request: Request, expectedSecret: string): Promise<boolean> {
  const supplied = request.headers.get("x-sec-refresh-key") ?? "";
  if (!expectedSecret || !supplied) return false;
  const [expectedHash, suppliedHash] = await Promise.all([digest(expectedSecret), digest(supplied)]);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash[index] ^ suppliedHash[index];
  }
  return difference === 0;
}

export function buildSecWatchlist(
  positionTickers: string[],
  planTickers: string[],
  securityType: (ticker: string) => "stock" | "etf" | null,
): string[] {
  const tickers = [...positionTickers, ...planTickers]
    .map(cleanSecTicker)
    .filter((ticker) => ticker && securityType(ticker) === "stock");
  return [...new Set(tickers)].sort();
}

export async function handleSecFeedRequest({
  user,
  ticker,
  security,
  repository,
}: {
  user: { email: string } | null;
  ticker: string;
  security: SecSecurity | null;
  repository: SecRepository;
}): Promise<Response> {
  if (!user) return Response.json({ error: "未登录。" }, { status: 401 });
  if (!security) return Response.json({ error: "未找到对应的美股或 ETF。" }, { status: 404 });
  if (security.type === "etf") {
    const feed: SecFilingFeed = {
      ticker: security.symbol,
      company: null,
      filings: [],
      fetchedAt: null,
      status: "not_applicable",
    };
    return privateJson(feed);
  }
  return privateJson(await getCachedSecFeed(repository, cleanSecTicker(ticker)));
}

function privateJson(value: unknown): Response {
  return Response.json(value, { headers: { "cache-control": "private, no-store" } });
}

async function digest(value: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
