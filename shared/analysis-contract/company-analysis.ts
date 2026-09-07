import type { AnalysisRunSummary } from "./filings.ts";
import type { ReportBlock } from "./report-blocks.ts";
export type CompanyAnalysisCoverageStatus = "complete" | "partial";

/**
 * How many judgments an overview may carry. The count used to be fixed at four, which made every
 * filing look equally eventful: a quarter with two things worth saying padded to four, and one with
 * six had two cut. The editorial phase now decides, within these bounds — below two there is no
 * list to read, and past six the page stops being a summary.
 *
 * Widening, not breaking: a stored four-highlight overview stays valid, so the payload schema
 * version does not move and published analyses keep rendering.
 */
export const COMPANY_ANALYSIS_MIN_HIGHLIGHTS = 2;
export const COMPANY_ANALYSIS_MAX_HIGHLIGHTS = 6;

/**
 * Which block forms a judgment may take. `metrics` and `evidence` are absent on purpose, not by
 * oversight: `metrics` resolves against the SEC report's verified figures, a different vocabulary
 * from the Yahoo features this analysis reasons over, and `evidence` carries filing character
 * offsets, which company analysis evidence — feature and memory references — does not have.
 */
export const COMPANY_ANALYSIS_BLOCK_TYPES = ["prose", "key_points", "callout", "chart"] as const;

/** Past a few, the extra forms stop supporting the judgment and become the judgment. */
export const COMPANY_ANALYSIS_MAX_BLOCKS_PER_HIGHLIGHT = 3;

export type CompanyAnalysisBlock = Extract<ReportBlock, { type: (typeof COMPANY_ANALYSIS_BLOCK_TYPES)[number] }>;

export type CompanyAnalysisHighlight = {
  /** Assigned by position at normalization ("01", "02", …), never taken from the model. */
  ordinal: string;
  title: string;
  body: string;
  evidenceRefs: string[];
  /**
   * The forms this judgment chose beyond its prose, rendered under the body. Optional and additive:
   * an overview published before this existed carries none and renders exactly as it did, so the
   * payload schema version does not move and no consumer loses a field it relied on.
   */
  blocks?: CompanyAnalysisBlock[];
};

export type CompanyAnalysisOverview = {
  label: string;
  headline: string;
  introduction: string;
  highlights: CompanyAnalysisHighlight[];
};

export type PublicCompanyAnalysisResponse = {
  /** The HTTP contract's version. Distinct from `schemaVersion`, which versions this payload. */
  apiSchemaVersion: "analysis-api.v1";
  schemaVersion: "company-analysis.v1";
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
    apiSchema: "analysis-api.v1";
    payloadSchema: "company-analysis.v1";
    /** Which generated revision this is — the publication's input hash. */
    contentRevision: string | null;
    /** Version *labels* only. Never a prompt, never a credential. */
    model: string | null;
    prompt: string | null;
  };
};
