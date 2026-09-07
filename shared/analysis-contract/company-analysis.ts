export type CompanyAnalysisCoverageStatus = "complete" | "partial";

export type PublicCompanyAnalysisResponse = {
  schemaVersion: "company-analysis.v1";
  ticker: string;
  status: "ready" | "updating" | "insufficient_data" | "unavailable";
  analysisId: string | null;
  period: { periodId: string; periodEnd: string; label: string } | null;
  generatedAt: string | null;
  coverageStatus: CompanyAnalysisCoverageStatus | null;
  overview: {
    label: string;
    headline: string;
    introduction: string;
    highlights: Array<{ ordinal: "01" | "02" | "03" | "04"; title: string; body: string }>;
  } | null;
};
