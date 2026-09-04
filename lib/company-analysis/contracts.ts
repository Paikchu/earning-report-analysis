import { normalizeTrackedTicker } from "../sec-config.ts";

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
  schemaVersion: typeof COMPANY_ANALYSIS_SCHEMA_VERSION;
  ticker: string;
  status: "ready" | "updating" | "insufficient_data" | "unavailable";
  analysisId: string | null;
  period: { periodId: string; periodEnd: string; label: string } | null;
  generatedAt: string | null;
  coverageStatus: CompanyAnalysisCoverageStatus | null;
  overview: Omit<CompanyAnalysisOverview, "highlights"> & {
    highlights: Array<Omit<CompanyAnalysisHighlight, "evidenceRefs">>;
  } | null;
};

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

export function toPublicCompanyAnalysis(publication: CompanyAnalysisPublication): PublicCompanyAnalysisResponse {
  return {
    schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    ticker: publication.ticker,
    status: "ready",
    analysisId: publication.analysisId,
    period: { periodId: publication.periodId, periodEnd: publication.periodEnd, label: publication.reportLabel },
    generatedAt: publication.generatedAt,
    coverageStatus: publication.coverageStatus,
    overview: {
      label: publication.overview.label,
      headline: publication.overview.headline,
      introduction: publication.overview.introduction,
      highlights: publication.overview.highlights.map((highlight) => ({
        ordinal: highlight.ordinal,
        title: highlight.title,
        body: highlight.body,
      })),
    },
  };
}

export function unavailableCompanyAnalysis(ticker: string): PublicCompanyAnalysisResponse {
  return {
    schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    ticker,
    status: "unavailable",
    analysisId: null,
    period: null,
    generatedAt: null,
    coverageStatus: null,
    overview: null,
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
