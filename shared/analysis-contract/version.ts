export const ANALYSIS_API_VERSION = "v1";
export type AnalysisApiErrorCode = "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNAVAILABLE" | "INTERNAL_ERROR";
export type AnalysisApiError = { error: string; code: AnalysisApiErrorCode };
export type AnalysisJobResponse = {
  status: "queued";
  jobId: string;
  ticker: string;
  mode: "jobs" | "backfill";
};
