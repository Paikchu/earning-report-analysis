import { D1CompanyAnalysisRepository } from "../../lib/company-analysis/repository.ts";
import { D1SecRepository } from "../../lib/sec-d1.ts";
import { isTrackedTicker, normalizeTrackedTicker, parseTrackedTickers } from "../../lib/sec-config.ts";
import { hashString } from "../../lib/sec-analysis.ts";

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
  /** This Worker's own copy of the whitelist — nothing here asks another Worker for it. */
  SEC_TRACKED_TICKERS?: string;
  SEC_REFRESH_KEY: string;
  /** The same D1 database the Web Worker binds. Optional only so tests can build a partial env. */
  DB?: D1Database;
  SEC_ANALYSIS_WORKFLOW: SecWorkflowBinding;
  SEC_MEMORY_WORKFLOW?: SecWorkflowBinding<SecMemoryWorkflowParams>;
  COMPANY_ANALYSIS_WORKFLOW?: SecWorkflowBinding<CompanyAnalysisWorkflowParams>;
};

/**
 * Reads this Worker's own copy of the whitelist. There is deliberately no other Worker to ask: a
 * second copy living on the Web Worker is exactly what let the two sides disagree silently — one
 * side would start analysis the other side then refused, and the jobs just failed on repeat. The
 * whitelist now has exactly one home, this one, and this Worker is also the one deciding whether to
 * start a run — so the two can no longer drift apart.
 */
export function trackedTickersFor(env: Pick<SecCronEnv, "SEC_TRACKED_TICKERS">): string[] {
  return parseTrackedTickers(env.SEC_TRACKED_TICKERS);
}

export function assertTrackedTicker(env: Pick<SecCronEnv, "SEC_TRACKED_TICKERS">, ticker: string): void {
  if (!isTrackedTicker(ticker, trackedTickersFor(env))) throw new Error("Ticker is not tracked");
}

export function requireDb(env: Pick<SecCronEnv, "DB">): D1Database {
  if (!env.DB) throw new Error("SEC pipeline D1 binding is not configured");
  return env.DB;
}

export async function runCompanyAnalysisSweep(
  env: SecCronEnv,
  options: { forceIncomplete?: boolean } = {},
): Promise<{ candidates: number; started: string[]; failed: string[] }> {
  if (!env.COMPANY_ANALYSIS_WORKFLOW) return { candidates: 0, started: [], failed: [] };
  const candidates = await new D1CompanyAnalysisRepository(requireDb(env))
    .listBackfillCandidates(trackedTickersFor(env), 100, options.forceIncomplete === true);
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

export async function runSecRefresh(env: SecCronEnv, now = Date.now()) {
  if (!env.SEC_REFRESH_KEY || !env.SEC_ANALYSIS_WORKFLOW) {
    throw new Error("SEC cron environment is incomplete");
  }
  const tickers = [...new Set(trackedTickersFor(env))];
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

export async function runSecMemorySweep(env: SecCronEnv): Promise<{ started: string[] }> {
  if (!env.SEC_MEMORY_WORKFLOW) return { started: [] };
  const ownerToken = `sweeper:${crypto.randomUUID()}`;
  const claim = await new D1SecRepository(requireDb(env)).claimMemoryJob(null, ownerToken, new Date(), undefined, trackedTickersFor(env));
  if (!claim) return { started: [] };
  await env.SEC_MEMORY_WORKFLOW.create({
    id: `memory-${crypto.randomUUID()}`,
    params: { jobId: claim.jobId, ticker: claim.ticker, ownerToken },
  });
  return { started: [claim.jobId] };
}

export async function handleSecAnalysisRequest(request: Request, env: SecCronEnv, now = Date.now()): Promise<Response> {
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
    trackedTickers = trackedTickersFor(env);
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

async function startWorkflow(binding: SecWorkflowBinding, ticker: string, requestedBy: SecWorkflowParams["requestedBy"], now: number, backfill: boolean) {
  const runKey = requestedBy === "manual" ? `${now}-${crypto.randomUUID()}` : Math.floor(now / (5 * 60_000));
  const id = `${requestedBy}-${ticker}-${runKey}`;
  return binding.create({ id, params: { ticker, requestedBy, backfill } });
}
