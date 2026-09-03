import { isTrackedTicker, normalizeTrackedTicker, parseTrackedTickers } from "../../lib/sec-config.ts";
import { hashString } from "../../lib/sec-analysis.ts";
import { serviceFetcher, type ServiceBinding } from "../../lib/service-binding.ts";

export type SecWorkflowBinding<T = SecWorkflowParams> = {
  create(options: { id: string; params: T }): Promise<{ id: string }>;
};

export type SecWorkflowParams = {
  ticker: string;
  requestedBy: "scheduled" | "manual";
  backfill?: boolean;
};

export type SecMemoryWorkflowParams = {
  jobId: string;
  ticker: string;
  ownerToken?: string;
};

export type CompanyAnalysisWorkflowParams = {
  analysisId?: string;
  ticker: string;
  memoryJobId: string;
  memoryVersion: number;
  periodId: string;
  reportDate: string;
  triggerRef: string;
};

export type CompanyAnalysisBackfillParams = {
  requestedBy?: "manual" | "scheduled";
  forceIncomplete?: boolean;
};

export type SecCronEnv = {
  WEB_APP_ORIGIN: string;
  SEC_REFRESH_KEY: string;
  SEC_ANALYSIS_WORKFLOW: SecWorkflowBinding;
  SEC_MEMORY_WORKFLOW?: SecWorkflowBinding<SecMemoryWorkflowParams>;
  COMPANY_ANALYSIS_WORKFLOW?: SecWorkflowBinding<CompanyAnalysisWorkflowParams>;
  /** Service Binding to the Web Worker. Its public hostname is unreachable from here. */
  WEB?: ServiceBinding;
};

export async function runCompanyAnalysisSweep(
  env: SecCronEnv,
  fetcher: typeof fetch = serviceFetcher(env.WEB),
  options: { forceIncomplete?: boolean } = {},
): Promise<{ candidates: number; started: string[]; failed: string[] }> {
  if (!env.COMPANY_ANALYSIS_WORKFLOW) return { candidates: 0, started: [], failed: [] };
  const response = await fetcher(`${env.WEB_APP_ORIGIN.replace(/\/+$/, "")}/api/internal/company-analysis/backfill-candidates`, {
    method: "POST",
    headers: siteHeaders(env),
    body: JSON.stringify({ limit: 100, includeIncomplete: options.forceIncomplete === true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Company analysis candidates HTTP ${response.status}`);
  const body = await response.json() as { candidates?: CompanyAnalysisWorkflowParams[] };
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const started: string[] = [];
  const failed: string[] = [];
  for (const candidate of candidates) {
    const ticker = normalizeTrackedTicker(candidate.ticker);
    if (!ticker || !candidate.triggerRef) continue;
    try {
      await env.COMPANY_ANALYSIS_WORKFLOW.create({
        id: options.forceIncomplete
          ? `company-${hashString(candidate.triggerRef)}-${crypto.randomUUID()}`
          : `company-${hashString(candidate.triggerRef)}`,
        params: { ...candidate, ticker },
      });
      started.push(ticker);
    } catch (error) {
      if (/already exists|duplicate/i.test(String(error))) {
        started.push(ticker);
      } else {
        failed.push(ticker);
      }
    }
  }
  return { candidates: candidates.length, started, failed };
}

/**
 * The whitelist lives on the Web Worker, which is also the side that rejects an untracked ticker on
 * every bridge and admin route. Keeping a second copy here meant a silent drift: this Worker would
 * start analysis the other side then refused, and the jobs just failed on repeat.
 *
 * There is deliberately no fall back to a local copy. The only time it would fire is when the Web
 * Worker is unreachable — and every filing needs that same Worker for context, publication and job
 * state, so a run started from a stale list could not finish anyway.
 */
export async function fetchTrackedTickers(env: SecCronEnv, fetcher: typeof fetch = serviceFetcher(env.WEB)): Promise<string[]> {
  if (!env.WEB_APP_ORIGIN || !env.SEC_REFRESH_KEY) throw new Error("SEC watchlist environment is incomplete");
  const response = await fetcher(`${env.WEB_APP_ORIGIN.replace(/\/+$/, "")}/api/internal/sec/watchlist`, {
    headers: siteHeaders(env),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SEC watchlist HTTP ${response.status}`);
  const body = await response.json() as { tickers?: unknown };
  // Re-validated rather than trusted: the parse is what guarantees the shape the rest of this file
  // relies on, whatever the bridge returned.
  return parseTrackedTickers(Array.isArray(body.tickers) ? body.tickers.join(",") : "");
}

export async function runSecRefresh(env: SecCronEnv, fetcher: typeof fetch = serviceFetcher(env.WEB), now = Date.now()) {
  if (!env.SEC_REFRESH_KEY || !env.SEC_ANALYSIS_WORKFLOW) {
    throw new Error("SEC cron environment is incomplete");
  }
  const tickers = [...new Set(await fetchTrackedTickers(env, fetcher))];
  const started: string[] = [];
  const failed: string[] = [];
  for (const ticker of tickers) {
    try {
      await startWorkflow(env.SEC_ANALYSIS_WORKFLOW, ticker, "scheduled", now, false);
      started.push(ticker);
    } catch {
      failed.push(ticker);
    }
  }
  /**
   * A watchlist that yielded tickers but started nothing is a failure, not an empty success: it
   * used to return the same shape a healthy run returns, so the Cron handler — the only reader
   * there is — could not tell it apart from "there was nothing to do". An empty watchlist stays a
   * no-op, because turning generation off entirely is a supported configuration.
   */
  if (tickers.length && !started.length) throw new Error(`SEC refresh started no workflows (watchlist: ${tickers.length}, failed: ${failed.length})`);
  return { started, failed };
}

export async function runSecMemorySweep(env: SecCronEnv, fetcher: typeof fetch = serviceFetcher(env.WEB)): Promise<{ started: string[] }> {
  if (!env.SEC_MEMORY_WORKFLOW) return { started: [] };
  const ownerToken = `sweeper:${crypto.randomUUID()}`;
  if (!env.WEB_APP_ORIGIN || !env.SEC_REFRESH_KEY) throw new Error("SEC memory environment is incomplete");
  const response = await fetcher(`${env.WEB_APP_ORIGIN.replace(/\/+$/, "")}/api/internal/sec/memory/claim`, {
    method: "POST",
    headers: siteHeaders(env),
    body: JSON.stringify({ ownerToken }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SEC memory claim HTTP ${response.status}`);
  const body = await response.json() as { claim?: { jobId: string; ticker: string } | null };
  if (!body.claim) return { started: [] };
  await env.SEC_MEMORY_WORKFLOW.create({
    id: `memory-${crypto.randomUUID()}`,
    params: { jobId: body.claim.jobId, ticker: body.claim.ticker, ownerToken },
  });
  return { started: [body.claim.jobId] };
}

export async function handleSecAnalysisRequest(request: Request, env: SecCronEnv, now = Date.now(), fetcher: typeof fetch = serviceFetcher(env.WEB)): Promise<Response> {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!env.SEC_REFRESH_KEY || request.headers.get("x-sec-refresh-key") !== env.SEC_REFRESH_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const match = new URL(request.url).pathname.match(/^\/(jobs|backfill)\/([^/]+)$/);
  const mode = match?.[1] ?? "jobs";
  let rawTicker = "";
  try {
    rawTicker = decodeURIComponent(match?.[2] ?? "");
  } catch {
    return Response.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const ticker = normalizeTrackedTicker(rawTicker);
  if (!ticker) return Response.json({ error: "Invalid ticker" }, { status: 400 });
  let trackedTickers: string[];
  try {
    trackedTickers = await fetchTrackedTickers(env, fetcher);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to read the SEC watchlist" }, { status: 503 });
  }
  if (!isTrackedTicker(ticker, trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  try {
    const instance = await startWorkflow(env.SEC_ANALYSIS_WORKFLOW, ticker, "manual", now, mode === "backfill");
    return Response.json({ status: "queued", jobId: instance.id, ticker, mode }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to queue analysis" }, { status: 503 });
  }
}

export function siteHeaders(env: Pick<SecCronEnv, "SEC_REFRESH_KEY">) {
  return {
    "content-type": "application/json",
    "x-sec-refresh-key": env.SEC_REFRESH_KEY,
  };
}

async function startWorkflow(binding: SecWorkflowBinding, ticker: string, requestedBy: SecWorkflowParams["requestedBy"], now: number, backfill: boolean) {
  const runKey = requestedBy === "manual" ? `${now}-${crypto.randomUUID()}` : Math.floor(now / (5 * 60_000));
  const id = `${requestedBy}-${ticker}-${runKey}`;
  return binding.create({ id, params: { ticker, requestedBy, backfill } });
}
