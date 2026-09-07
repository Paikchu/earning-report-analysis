import { ANALYSIS_API_VERSION, type AnalysisApiErrorCode } from "../../../shared/analysis-contract/version.ts";
import { hasInternalSecAccess } from "./sec/api.ts";
import { D1SecRepository } from "./sec/d1.ts";
import { getPublicFiling, getPublicFilingPage } from "./sec/public-api.ts";
import { D1CompanyAnalysisRepository } from "./company-analysis/repository.ts";
import { handlePublicCompanyAnalysisRequest } from "./company-analysis/api.ts";
import { D1FundamentalsRepository } from "./fundamentals/fundamentals-d1.ts";
import { handlePublicFundamentalsRequest } from "./fundamentals/fundamentals-api.ts";
import { scheduleFundamentalRefresh } from "./fundamentals/fundamentals-runtime.ts";
import { isTrackedTicker, parseTrackedTickers } from "./sec/config.ts";
import { handleSecAnalysisRequest } from "./core.ts";
import type { SecPipelineEnv } from "./operations.ts";

function error(status: number, code: AnalysisApiErrorCode, message: string) {
  return Response.json({ error: message, code }, { status, headers: { "cache-control": "no-store" } });
}

/** The only remotely callable surface. Persistence commands remain local to Pipeline. */
async function executeAnalysisApi(request: Request, env: SecPipelineEnv, context?: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
  const url = new URL(request.url);
  if (!await hasInternalSecAccess(request, env.SEC_REFRESH_KEY)) return error(401, "UNAUTHORIZED", "Unauthorized");
  try {
    if (/^\/(jobs|backfill)\/[^/]+$/.test(url.pathname)) return handleSecAnalysisRequest(request, env);
    const admin = url.pathname.match(/^\/api\/v1\/admin\/companies\/([^/]+)\/(refresh|backfill)$/);
    if (admin && request.method === "POST") {
      const target = new URL(`/${admin[2] === "refresh" ? "jobs" : "backfill"}/${admin[1]}`, url);
      return handleSecAnalysisRequest(new Request(target, { method: "POST", headers: request.headers }), env);
    }
    const match = url.pathname.match(/^\/api\/v1\/companies\/([^/]+)\/(filings|fundamentals|analysis)(?:\/([^/]+))?$/);
    if (!match || request.method !== "GET" || (match[3] && match[2] !== "filings")) return error(404, "NOT_FOUND", "Not found");
    const ticker = decodeURIComponent(match[1]);
    if (match[2] === "analysis") return handlePublicCompanyAnalysisRequest(new D1CompanyAnalysisRepository(env.DB), ticker);
    if (match[2] === "fundamentals") return handlePublicFundamentalsRequest(request, ticker, {
      getRepository: async () => new D1FundamentalsRepository(env.DB),
      isRefreshEligible: (value) => isTrackedTicker(value, parseTrackedTickers(env.SEC_TRACKED_TICKERS)),
      scheduleRefresh: (repository, value) => context
        ? scheduleFundamentalRefresh(repository, value, { waitUntil: (promise) => context.waitUntil(promise) })
        : Promise.resolve(false),
    });
    const repository = new D1SecRepository(env.DB);
    const payload = match[3]
      ? await getPublicFiling(repository, ticker, decodeURIComponent(match[3]))
      : await getPublicFilingPage(repository, ticker, url.searchParams.get("cursor"), url.searchParams.get("limit"));
    if (!payload) return error(404, "NOT_FOUND", "SEC filing not found");
    return Response.json(payload, { headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=300",
      "x-analysis-api-version": ANALYSIS_API_VERSION,
    } });
  } catch (cause) {
    if (cause instanceof URIError || (cause instanceof Error && /^Invalid (ticker|cursor)$/.test(cause.message))) return error(400, "INVALID_REQUEST", "Invalid request");
    console.error("Analysis API failed", { errorName: cause instanceof Error ? cause.name : "UnknownError" });
    return error(503, "UNAVAILABLE", "Analysis service unavailable");
  }
}

export async function handleAnalysisApi(request: Request, env: SecPipelineEnv, context?: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
  const response = await executeAnalysisApi(request, env, context);
  if (response.status >= 400) {
    const code: AnalysisApiErrorCode = response.status === 401 ? "UNAUTHORIZED"
      : response.status === 403 ? "FORBIDDEN"
      : response.status === 404 ? "NOT_FOUND"
      : response.status >= 500 ? "UNAVAILABLE" : "INVALID_REQUEST";
    const messages: Record<AnalysisApiErrorCode, string> = {
      UNAUTHORIZED: "Unauthorized", FORBIDDEN: "Ticker is not tracked", NOT_FOUND: "Not found",
      UNAVAILABLE: "Analysis service unavailable", INVALID_REQUEST: "Invalid request", INTERNAL_ERROR: "Analysis service failed",
    };
    const result = error(response.status, code, messages[code]);
    result.headers.set("x-analysis-api-version", ANALYSIS_API_VERSION);
    return result;
  }
  response.headers.set("x-analysis-api-version", ANALYSIS_API_VERSION);
  return response;
}
