import { normalizeTrackedTicker } from "../sec-config.ts";
import type { AnalysisRunSummary } from "../analysis-contract/filings.ts";
import { ANALYSIS_API_SCHEMA_VERSION } from "../analysis-contract/versions.ts";

export const COMPANY_ANALYSIS_SCHEMA_VERSION = "company-analysis.v1";
export const COMPANY_ANALYSIS_PROMPT_VERSION = "company-analysis-skill.v2";

export type CompanyAnalysisCoverageStatus = "complete" | "partial";
export type CompanyAnalysisRunStatus =
  | "waiting_fundamentals"
  | "calculating"
  | "analyzing"
  | "validating"
  | "ready"
  | "insufficient_data"
  | "failed";

export type CompanyAnalysisHighlight = {
  ordinal: "01" | "02" | "03" | "04";
  title: string;
  body: string;
  evidenceRefs: string[];
};

export type CompanyAnalysisOverview = {
  label: string;
  headline: string;
  introduction: string;
  highlights: [
    CompanyAnalysisHighlight,
    CompanyAnalysisHighlight,
    CompanyAnalysisHighlight,
    CompanyAnalysisHighlight,
  ];
};

export type CompanyAnalysisPublication = {
  schemaVersion: typeof COMPANY_ANALYSIS_SCHEMA_VERSION;
  analysisId: string;
  ticker: string;
  triggerRef: string;
  periodId: string;
  periodEnd: string;
  reportLabel: string;
  inputHash: string;
  memoryVersion: number;
  fundamentalsDataVersion: string;
  status: Extract<CompanyAnalysisRunStatus, "ready">;
  coverageStatus: CompanyAnalysisCoverageStatus;
  overview: CompanyAnalysisOverview;
  modelVersion: string;
  promptVersion: string;
  generatedAt: string;
};

export type PublicCompanyAnalysisResponse = {
  /** The HTTP contract's version. Distinct from `schemaVersion`, which versions this payload. */
  apiSchemaVersion: typeof ANALYSIS_API_SCHEMA_VERSION;
  schemaVersion: typeof COMPANY_ANALYSIS_SCHEMA_VERSION;
  ticker: string;
  /**
   * The **published result**'s state, with exactly the meaning it had before the backend refactor:
   * `ready` when a published analysis is current, `updating` when a newer run is in flight and what
   * you are reading is the previous published result, `unavailable` when nothing is published.
   * It says nothing about a failed run — `latestRun` does.
   */
  status: "ready" | "updating" | "insufficient_data" | "unavailable";
  analysisId: string | null;
  period: { periodId: string; periodEnd: string; label: string } | null;
  generatedAt: string | null;
  coverageStatus: CompanyAnalysisCoverageStatus | null;
  overview: CompanyAnalysisOverview | null;
  /**
   * The newest execution known for this company, published separately from the result so a queued,
   * running or failed run is visible without redefining `status`. `none` means the backend looked
   * and found no history; `unknown` means history could not be read.
   */
  latestRun: AnalysisRunSummary;
  /** API schema, content revision and internal pipeline versions, each named for what it is. */
  versions: {
    apiSchema: typeof ANALYSIS_API_SCHEMA_VERSION;
    payloadSchema: typeof COMPANY_ANALYSIS_SCHEMA_VERSION;
    /** Which generated revision this is — the publication's input hash. */
    contentRevision: string | null;
    /** Version *labels* only. Never a prompt, never a credential. */
    model: string | null;
    prompt: string | null;
  };
};

/** Where a run summary comes from when the backend could not read run history at all. */
export const UNKNOWN_ANALYSIS_RUN: AnalysisRunSummary = { state: "unknown", updatedAt: null, errorCode: null };
export const NO_ANALYSIS_RUN: AnalysisRunSummary = { state: "none", updatedAt: null, errorCode: null };

export class CompanyAnalysisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyAnalysisValidationError";
  }
}

export function normalizeCompanyAnalysisPublication(value: unknown): CompanyAnalysisPublication {
  const item = record(value);
  const ticker = normalizeTrackedTicker(text(item?.ticker));
  const analysisId = bounded(item?.analysisId, 160);
  const triggerRef = bounded(item?.triggerRef, 240);
  const periodId = bounded(item?.periodId, 200);
  const periodEnd = date(item?.periodEnd);
  const reportLabel = bounded(item?.reportLabel, 80);
  const inputHash = hash(item?.inputHash);
  const fundamentalsDataVersion = hash(item?.fundamentalsDataVersion);
  const modelVersion = bounded(item?.modelVersion, 120);
  const promptVersion = bounded(item?.promptVersion, 120);
  const generatedAt = timestamp(item?.generatedAt);
  const memoryVersion = integer(item?.memoryVersion, 0);
  const coverageStatus = item?.coverageStatus === "partial" ? "partial" : item?.coverageStatus === "complete" ? "complete" : null;
  if (
    item?.schemaVersion !== COMPANY_ANALYSIS_SCHEMA_VERSION || item?.status !== "ready" || !ticker ||
    !analysisId || !triggerRef || !periodId || !periodEnd || !reportLabel || !inputHash ||
    !fundamentalsDataVersion || !modelVersion || !promptVersion || !generatedAt ||
    memoryVersion === null || !coverageStatus
  ) throw new CompanyAnalysisValidationError("Company analysis publication metadata is invalid.");

  return {
    schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    ticker,
    triggerRef,
    periodId,
    periodEnd,
    reportLabel,
    inputHash,
    memoryVersion,
    fundamentalsDataVersion,
    status: "ready",
    coverageStatus,
    overview: normalizeCompanyAnalysisOverview(item.overview),
    modelVersion,
    promptVersion,
    generatedAt,
  };
}

export function toPublicCompanyAnalysis(
  publication: CompanyAnalysisPublication,
  latestRun: AnalysisRunSummary = NO_ANALYSIS_RUN,
): PublicCompanyAnalysisResponse {
  return {
    apiSchemaVersion: ANALYSIS_API_SCHEMA_VERSION,
    schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    ticker: publication.ticker,
    status: "ready",
    analysisId: publication.analysisId,
    period: { periodId: publication.periodId, periodEnd: publication.periodEnd, label: publication.reportLabel },
    generatedAt: publication.generatedAt,
    coverageStatus: publication.coverageStatus,
    // Evidence references travel with the highlight they support. They used to be stripped here,
    // which left a consumer with prose and no way to reach the underlying observation.
    overview: publication.overview,
    latestRun,
    versions: {
      apiSchema: ANALYSIS_API_SCHEMA_VERSION,
      payloadSchema: COMPANY_ANALYSIS_SCHEMA_VERSION,
      contentRevision: publication.inputHash,
      model: publication.modelVersion,
      prompt: publication.promptVersion,
    },
  };
}

export function unavailableCompanyAnalysis(
  ticker: string,
  latestRun: AnalysisRunSummary = NO_ANALYSIS_RUN,
): PublicCompanyAnalysisResponse {
  return {
    apiSchemaVersion: ANALYSIS_API_SCHEMA_VERSION,
    schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    ticker,
    status: "unavailable",
    analysisId: null,
    period: null,
    generatedAt: null,
    coverageStatus: null,
    overview: null,
    latestRun,
    versions: {
      apiSchema: ANALYSIS_API_SCHEMA_VERSION,
      payloadSchema: COMPANY_ANALYSIS_SCHEMA_VERSION,
      contentRevision: null,
      model: null,
      prompt: null,
    },
  };
}

export function normalizeCompanyAnalysisOverview(value: unknown): CompanyAnalysisOverview {
  const item = record(value);
  const label = bounded(item?.label, 80);
  const headline = bounded(item?.headline, 180);
  const introduction = bounded(item?.introduction, 1_200);
  const highlights = Array.isArray(item?.highlights) ? item.highlights.map((raw, index) => {
    const highlight = record(raw);
    return {
      ordinal: String(index + 1).padStart(2, "0") as CompanyAnalysisHighlight["ordinal"],
      title: bounded(highlight?.title, 100),
      body: bounded(highlight?.body, 700),
      evidenceRefs: strings(highlight?.evidenceRefs, 16, 240),
    };
  }) : [];
  if (!label || !headline || !introduction || highlights.length !== 4 || highlights.some((highlight) =>
    !highlight.title || !highlight.body || !highlight.evidenceRefs.length)) {
    throw new CompanyAnalysisValidationError("Company analysis overview must contain one headline, one introduction, and exactly four evidence-backed highlights.");
  }
  return { label, headline, introduction, highlights: highlights as CompanyAnalysisOverview["highlights"] };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bounded(value: unknown, max: number): string {
  const result = text(value);
  return result && result.length <= max ? result : "";
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((item) => item && item.length <= maxLength).slice(0, maxItems);
}

function hash(value: unknown): string {
  const result = text(value);
  return /^[a-zA-Z0-9:_-]{8,256}$/.test(result) ? result : "";
}

function date(value: unknown): string {
  const result = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : "";
}

function timestamp(value: unknown): string {
  const result = text(value);
  return result && Number.isFinite(Date.parse(result)) ? result : "";
}

function integer(value: unknown, min: number): number | null {
  return Number.isInteger(value) && Number(value) >= min ? Number(value) : null;
}
