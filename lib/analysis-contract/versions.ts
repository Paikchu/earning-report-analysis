/**
 * Version identifiers carried by the analysis backend's HTTP contract.
 *
 * Three different things were all called "version" before this module existed, and §4.3 of the
 * refactor brief asks for them to be told apart, so each one is named here once:
 *
 * - `ANALYSIS_API_SCHEMA_VERSION` — the **wire** contract. It changes when a response's shape
 *   changes. It says nothing about the data inside the response.
 * - Per-resource `schemaVersion` (`fundamentals-api.v1`, `company-analysis.v1`) — the payload
 *   schema of one resource. These already existed and keep their meaning untouched.
 * - **Content revision** — which generated artefact you are looking at. For a SEC filing report
 *   that is `reportVersion`, which the pipeline builds as `"<analysis schema>:<content hash>"`
 *   (`lib/sec-pipeline.ts`); the hash half is surfaced separately as `contentRevision` so a
 *   consumer can diff revisions without parsing the compound string. For a company analysis it
 *   is `inputHash`.
 * - **Internal pipeline versions** — `modelVersion` / `promptVersion`. These are version
 *   *labels*, never the prompt text, never a credential.
 */
export const ANALYSIS_API_SCHEMA_VERSION = "analysis-api.v1";

/** Read scopes. A credential carrying `*` holds all of them. */
export const ANALYSIS_READ_SCOPES = ["filings:read", "analysis:read", "fundamentals:read"] as const;

export type AnalysisReadScope = (typeof ANALYSIS_READ_SCOPES)[number];

export const ANALYSIS_SCOPE_WILDCARD = "*";

export function isAnalysisReadScope(value: string): value is AnalysisReadScope {
  return (ANALYSIS_READ_SCOPES as readonly string[]).includes(value);
}

/**
 * Splits a `reportVersion` into the analysis schema it was produced under and the content hash
 * identifying that exact report. Anything that does not carry the compound form is reported as an
 * unknown schema with the whole value as the revision, rather than guessed at.
 */
export function splitReportVersion(reportVersion: string | null): {
  analysisSchemaVersion: string | null;
  contentRevision: string | null;
} {
  if (!reportVersion) return { analysisSchemaVersion: null, contentRevision: null };
  const separator = reportVersion.lastIndexOf(":");
  if (separator <= 0 || separator === reportVersion.length - 1) {
    return { analysisSchemaVersion: null, contentRevision: reportVersion };
  }
  return {
    analysisSchemaVersion: reportVersion.slice(0, separator),
    contentRevision: reportVersion.slice(separator + 1),
  };
}
