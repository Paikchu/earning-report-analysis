import { ANALYSIS_API_SCHEMA_VERSION } from "./versions.ts";

/**
 * Every error the backend can return, and the single HTTP status each one maps to. The mapping
 * lives in one table so the router cannot drift from the published contract, and so a consumer can
 * branch on `code` without pattern-matching prose. No code here carries a prompt, a credential, a
 * stack, or a provider response — §4.4 requires the error surface to stay that small.
 */
export const ANALYSIS_ERROR_STATUS = {
  INVALID_TICKER: 400,
  INVALID_ACCESSION: 400,
  INVALID_CURSOR: 400,
  INVALID_LIMIT: 400,
  INVALID_METRICS: 400,
  INVALID_PERIOD_COUNT: 400,
  REQUEST_TOO_LARGE: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN_SCOPE: 403,
  ROUTE_NOT_FOUND: 404,
  FILING_NOT_FOUND: 404,
  FUNDAMENTALS_NOT_AVAILABLE: 404,
  METHOD_NOT_ALLOWED: 405,
  RATE_LIMITED: 429,
  READ_AUTH_NOT_CONFIGURED: 503,
  STORAGE_UNAVAILABLE: 503,
  BACKEND_UNAVAILABLE: 503,
} as const;

export type AnalysisErrorCode = keyof typeof ANALYSIS_ERROR_STATUS;

export type AnalysisErrorBody = {
  apiSchemaVersion: typeof ANALYSIS_API_SCHEMA_VERSION;
  error: string;
  code: AnalysisErrorCode;
};

export function analysisErrorStatus(code: AnalysisErrorCode): number {
  return ANALYSIS_ERROR_STATUS[code];
}

export function analysisErrorBody(code: AnalysisErrorCode, message: string): AnalysisErrorBody {
  return { apiSchemaVersion: ANALYSIS_API_SCHEMA_VERSION, error: message, code };
}

/** Thrown by query services; the router is the only thing that turns one into a response. */
export class AnalysisRequestError extends Error {
  readonly code: AnalysisErrorCode;

  constructor(code: AnalysisErrorCode, message: string) {
    super(message);
    this.name = "AnalysisRequestError";
    this.code = code;
  }
}
