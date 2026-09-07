export const ANALYSIS_API_SCHEMA_VERSION = "analysis-api.v1";

export const ANALYSIS_READ_SCOPES = ["filings:read", "analysis:read", "fundamentals:read"] as const;

export type AnalysisReadScope = (typeof ANALYSIS_READ_SCOPES)[number];

export const ANALYSIS_SCOPE_WILDCARD = "*";

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
