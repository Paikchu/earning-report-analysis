import type { AnalysisRunSummary } from "../analysis-contract/filings.ts";
import { AnalysisRequestError } from "../analysis-contract/errors.ts";
import { normalizeTrackedTicker } from "../sec-config.ts";
import {
  NO_ANALYSIS_RUN,
  UNKNOWN_ANALYSIS_RUN,
  toPublicCompanyAnalysis,
  unavailableCompanyAnalysis,
  type PublicCompanyAnalysisResponse,
} from "./contracts.ts";
import type { D1CompanyAnalysisRepository } from "./repository.ts";

export type CompanyAnalysisQueryRepository = Pick<
  D1CompanyAnalysisRepository,
  "getLatestPublication" | "hasNewerActiveRun" | "getLatestRunSummary"
>;

/**
 * The company-analysis read query. Pure of transport: the backend router calls it for both the
 * Service Binding and the public HTTPS surface, so neither can drift from the other.
 *
 * Published result and latest run are read separately and reported separately. `status` keeps the
 * meaning it always had — it describes the publication — and `latestRun` carries the execution,
 * which is what makes the six situations in §4.4 of the brief distinguishable:
 *
 * | # | situation                                | status        | latestRun.state    |
 * |---|------------------------------------------|---------------|--------------------|
 * | 1 | nothing published, no history            | unavailable   | none               |
 * | 2 | first run queued/running                 | unavailable   | queued / running   |
 * | 3 | first run failed                         | unavailable   | failed (+errorCode)|
 * | 4 | published, newer run in flight           | updating      | queued / running   |
 * | 5 | published, newer run failed              | ready         | failed (+errorCode)|
 * | 6 | newly validated result published         | ready         | succeeded          |
 *
 * Run history that cannot be read reports `unknown` rather than `none`: not knowing is not the
 * same as knowing there is nothing, and a publication stays readable either way.
 */
export async function getPublicCompanyAnalysis(
  repository: CompanyAnalysisQueryRepository,
  rawTicker: string,
): Promise<PublicCompanyAnalysisResponse> {
  const ticker = normalizeTrackedTicker(rawTicker);
  if (!ticker) throw new AnalysisRequestError("INVALID_TICKER", "Ticker is invalid.");
  const publication = await repository.getLatestPublication(ticker);
  const latestRun = await readRunSummary(repository, ticker);
  if (!publication) return unavailableCompanyAnalysis(ticker, latestRun);
  const result = toPublicCompanyAnalysis(publication, latestRun);
  return await repository.hasNewerActiveRun(ticker, publication.generatedAt)
    ? { ...result, status: "updating" }
    : result;
}

/**
 * Run history is supporting metadata, not the result. A repository that cannot answer must not
 * take a readable published report down with it, so the failure becomes `unknown` here rather than
 * a rejected query. A failure to read the *publication* is a different matter and does propagate.
 */
async function readRunSummary(
  repository: CompanyAnalysisQueryRepository,
  ticker: string,
): Promise<AnalysisRunSummary> {
  if (typeof repository.getLatestRunSummary !== "function") return NO_ANALYSIS_RUN;
  try {
    return await repository.getLatestRunSummary(ticker);
  } catch {
    return UNKNOWN_ANALYSIS_RUN;
  }
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
