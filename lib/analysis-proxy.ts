import { AnalysisRequestError } from "./analysis-contract/errors.ts";
import type { AnalysisBackendClient, AnalysisBackendResponse } from "./analysis-contract/client.ts";
import type { AnalysisBackendRuntime } from "./analysis-backend-runtime.ts";

/**
 * The compatibility layer for the Web Worker's public `/api/v1/*` routes.
 *
 * These URLs keep working for anonymous browsers exactly as they did — no consumer is asked to
 * suddenly supply a backend credential. Web holds one server-side and presents it on their behalf,
 * which is why this file is careful about two things:
 *
 * 1. **Nothing about that credential may escape.** A backend 401, 403 or misconfiguration is
 *    collapsed into one opaque 503 before it reaches a browser; the distinction between "Web's
 *    token is wrong" and "the backend is down" is an operator's business, not the internet's.
 * 2. **The proxy is a public front door and is limited like one.** The backend limits per
 *    credential, which would let one browser exhaust the quota Web shares with every other reader,
 *    so the proxy additionally limits per client IP through its own Cloudflare rate-limit binding.
 *
 * The backend's body is forwarded verbatim — never re-wrapped — so a response does not gain a
 * second envelope on the way through.
 */
export type WebProxyErrorCode =
  | "ANALYSIS_BACKEND_UNAVAILABLE"
  | "ANALYSIS_BACKEND_RATE_LIMITED"
  | "PUBLIC_RATE_LIMITED";

/** Statuses a caller caused and may usefully see. Everything else becomes an opaque 503. */
const FORWARDED_STATUSES = new Set([200, 400, 404, 429]);

export type RateLimiterLike = { limit(options: { key: string }): Promise<{ success: boolean }> };

/**
 * The two pieces of Worker environment this module needs. They are injected rather than imported so
 * the proxy's behaviour — which is mostly about what it refuses to reveal — can be tested without a
 * Workers runtime. Production passes nothing and gets the real bindings.
 */
export type ProxyDependencies = {
  getRuntime?: () => Promise<AnalysisBackendRuntime>;
  getRateLimiter?: () => Promise<RateLimiterLike | null>;
};

async function defaultRuntime(): Promise<AnalysisBackendRuntime> {
  return (await import("./analysis-backend-runtime.ts")).getAnalysisBackendRuntime();
}

async function defaultRateLimiter(): Promise<RateLimiterLike | null> {
  return (await import("./analysis-backend-runtime.ts")).getPublicApiRateLimiter();
}

export async function proxyAnalysisRead(
  request: Request,
  call: (client: AnalysisBackendClient) => Promise<AnalysisBackendResponse<unknown>>,
  dependencies: ProxyDependencies = {},
): Promise<Response> {
  const limited = await exceedsPublicRateLimit(request, dependencies.getRateLimiter ?? defaultRateLimiter);
  if (limited) {
    return publicJson({ error: "Too many requests.", code: "PUBLIC_RATE_LIMITED" satisfies WebProxyErrorCode }, 429, "no-store");
  }

  const runtime = await (dependencies.getRuntime ?? defaultRuntime)();
  if (!runtime.configured) {
    // An unconfigured backend is an outage, and says so. It must never render as "no reports" —
    // that was the failure mode the direct-database fallback used to hide.
    console.error(JSON.stringify({ event: "analysis-backend-unconfigured", reason: runtime.reason }));
    return backendUnavailable();
  }

  let result: AnalysisBackendResponse<unknown>;
  try {
    result = await call(runtime.client);
  } catch (error) {
    console.error(JSON.stringify({
      event: "analysis-backend-request-failed",
      code: error instanceof AnalysisRequestError ? error.code : "UNKNOWN",
    }));
    return backendUnavailable();
  }

  if (!FORWARDED_STATUSES.has(result.status)) {
    // 401/403/503 land here. The reason stays in the log; the browser gets one flat answer.
    console.error(JSON.stringify({ event: "analysis-backend-refused", status: result.status }));
    return backendUnavailable();
  }
  if (result.status === 429) {
    return publicJson(
      { error: "The analysis backend is rate limiting this request.", code: "ANALYSIS_BACKEND_RATE_LIMITED" satisfies WebProxyErrorCode },
      429,
      "no-store",
    );
  }
  return publicJson(result.body, result.status, publicCacheControl(result));
}

/**
 * Public routes serve public data, so a shared cache may hold it — but only when the backend said
 * the payload was cacheable in the first place. Execution status and absence responses come back
 * `no-store` from the backend and stay `no-store` here, so a transient state is never stored as
 * though it were report content.
 */
function publicCacheControl(result: AnalysisBackendResponse<unknown>): string {
  if (result.status !== 200) return "no-store";
  const backend = result.headers.get("cache-control") ?? "";
  return /no-store/.test(backend) ? "no-store" : "public, max-age=30, stale-while-revalidate=300";
}

function backendUnavailable(): Response {
  return publicJson(
    { error: "The analysis backend is unavailable.", code: "ANALYSIS_BACKEND_UNAVAILABLE" satisfies WebProxyErrorCode },
    503,
    "no-store",
  );
}

async function exceedsPublicRateLimit(
  request: Request,
  getRateLimiter: () => Promise<RateLimiterLike | null>,
): Promise<boolean> {
  const limiter = await getRateLimiter();
  if (!limiter) return false;
  // Set by Cloudflare at the edge and stripped from client input, so it identifies the caller in a
  // way a request header supplied by that caller could not.
  const key = request.headers.get("cf-connecting-ip") ?? "anonymous";
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false;
  }
}

export function publicJson(body: unknown, status: number, cacheControl: string): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": cacheControl,
      // CORS, not authentication: these routes are public by design and browsers read them
      // cross-origin. It grants nothing that an anonymous request did not already have.
      "access-control-allow-origin": "*",
      vary: "Origin",
    },
  });
}
