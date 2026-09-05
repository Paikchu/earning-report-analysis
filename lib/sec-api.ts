import { cleanSecTicker } from "./sec.ts";

/**
 * Control-plane helpers for the Web Worker: administrative authentication, and forwarding a
 * refresh or backfill down to the analysis backend. Nothing here reads analysis data.
 *
 * It used to also hold `handleSecFeedRequest` and `buildSecWatchlist`. Both were left without a
 * caller by earlier work — the whitelist moved to the Pipeline Worker, and the feed endpoint was
 * replaced by `/api/v1/companies/:ticker/filings` — and `handleSecFeedRequest` was the one thing
 * pulling a repository into this module, which put a storage-touching import one hop away from the
 * admin routes. Removing the dead pair is what makes `tests/analysis-boundary.test.ts` pass on the
 * control plane rather than having to grant it an exception.
 */
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

export async function hasSecAdminAccess(request: Request, expectedSecret: string): Promise<boolean> {
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!expectedSecret || !supplied) return false;
  const [expectedHash, suppliedHash] = await Promise.all([digest(expectedSecret), digest(supplied)]);
  if (expectedHash.length !== suppliedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) difference |= expectedHash[index] ^ suppliedHash[index];
  return difference === 0;
}

export async function requestSecAnalysis({
  ticker,
  pipelineOrigin,
  refreshKey,
  fetcher = fetch,
  path = "jobs",
}: {
  ticker: string;
  pipelineOrigin: string;
  refreshKey: string;
  fetcher?: typeof fetch;
  path?: "jobs" | "backfill";
}): Promise<Response> {
  const symbol = cleanSecTicker(ticker);
  const origin = pipelineOrigin.replace(/\/+$/, "");
  if (!symbol || !origin || !refreshKey) {
    return Response.json({ error: "SEC 后台分析服务尚未配置。" }, { status: 503 });
  }
  try {
    const response = await fetcher(`${origin}/${path}/${encodeURIComponent(symbol)}`, {
      method: "POST",
      headers: { "x-sec-refresh-key": refreshKey },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.text();
    return new Response(payload, {
      status: response.status,
      headers: { "cache-control": "no-store", "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: "SEC 后台分析任务暂时无法创建。" }, { status: 502 });
  }
}

export async function requestSecBackfill({
  ticker,
  pipelineOrigin,
  refreshKey,
  fetcher = fetch,
}: {
  ticker: string;
  pipelineOrigin: string;
  refreshKey: string;
  fetcher?: typeof fetch;
}): Promise<Response> {
  return requestSecAnalysis({ ticker, pipelineOrigin, refreshKey, fetcher, path: "backfill" });
}

async function digest(value: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
