export type SecCronEnv = {
  MAX_SITE_ORIGIN: string;
  MAX_SITE_BYPASS_TOKEN: string;
  SEC_REFRESH_KEY: string;
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export async function runSecRefresh(env: SecCronEnv, fetcher: typeof fetch = fetch) {
  const origin = env.MAX_SITE_ORIGIN.replace(/\/+$/, "");
  if (!origin || !env.MAX_SITE_BYPASS_TOKEN || !env.SEC_REFRESH_KEY) {
    throw new Error("SEC cron environment is incomplete");
  }
  const headers = {
    "oai-sites-authorization": `Bearer ${env.MAX_SITE_BYPASS_TOKEN}`,
    "x-sec-refresh-key": env.SEC_REFRESH_KEY,
  };
  const watchlistResponse = await fetcher(`${origin}/api/internal/sec/watchlist`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!watchlistResponse.ok) throw new Error(`SEC watchlist HTTP ${watchlistResponse.status}`);
  const body = await watchlistResponse.json() as { tickers?: unknown };
  const tickers = Array.isArray(body.tickers)
    ? body.tickers.filter((ticker): ticker is string => typeof ticker === "string")
    : [];
  const succeeded: string[] = [];
  const failed: string[] = [];

  for (const ticker of tickers) {
    try {
      const response = await fetcher(`${origin}/api/internal/sec/refresh/${encodeURIComponent(ticker)}`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      succeeded.push(ticker);
    } catch {
      failed.push(ticker);
    }
  }
  return { succeeded, failed };
}

const worker = {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/health") {
      return new Response("ok", { headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: unknown, env: SecCronEnv, context: ExecutionContext) {
    context.waitUntil(runSecRefresh(env).then((result) => {
      console.log(JSON.stringify({ event: "sec-refresh", ...result }));
    }));
  },
};

export default worker;
