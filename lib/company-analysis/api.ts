import { normalizeTrackedTicker } from "../sec-config.ts";
import {
  COMPANY_ANALYSIS_SCHEMA_VERSION,
  toPublicCompanyAnalysis,
  unavailableCompanyAnalysis,
  type PublicCompanyAnalysisResponse,
} from "./contracts.ts";
import type { D1CompanyAnalysisRepository } from "./repository.ts";

export async function getPublicCompanyAnalysis(
  repository: Pick<D1CompanyAnalysisRepository, "getLatestPublication" | "hasNewerActiveRun">,
  rawTicker: string,
): Promise<PublicCompanyAnalysisResponse> {
  const ticker = normalizeTrackedTicker(rawTicker);
  if (!ticker) throw new CompanyAnalysisQueryError("INVALID_TICKER", "Ticker is invalid.");
  const publication = await repository.getLatestPublication(ticker);
  if (!publication) return unavailableCompanyAnalysis(ticker);
  const result = toPublicCompanyAnalysis(publication);
  return await repository.hasNewerActiveRun(ticker, publication.generatedAt)
    ? { ...result, status: "updating" }
    : result;
}

export async function handlePublicCompanyAnalysisRequest(
  repository: Pick<D1CompanyAnalysisRepository, "getLatestPublication" | "hasNewerActiveRun">,
  rawTicker: string,
): Promise<Response> {
  try {
    const payload = await getPublicCompanyAnalysis(repository, rawTicker);
    return json(payload, 200, payload.status === "unavailable" ? "no-store" : "public, max-age=30, stale-while-revalidate=300");
  } catch (error) {
    if (error instanceof CompanyAnalysisQueryError) return json({ error: error.message, code: error.code }, 400, "no-store");
    return json({ error: "Company analysis query failed.", code: "COMPANY_ANALYSIS_QUERY_FAILED" }, 500, "no-store");
  }
}

export class CompanyAnalysisQueryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CompanyAnalysisQueryError";
    this.code = code;
  }
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(value: unknown, status: number, cacheControl: string): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": cacheControl,
      "access-control-allow-origin": "*",
      vary: "Origin",
      "x-company-analysis-schema": COMPANY_ANALYSIS_SCHEMA_VERSION,
    },
  });
}
