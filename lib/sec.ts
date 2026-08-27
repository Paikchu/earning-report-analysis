import type { AnalysisFact, ManagerReview, PublishedSecReport, SecNodeSpecV2 } from "./sec-analysis.ts";

export const SEC_SUMMARY_VERSION = 5;

const MAX_HEADING_CHARACTERS = 120;
const ITEM_HEADING_LEVEL = 2;
const BOLD_HEADING_LEVEL = 7;

export const BUSINESS_FILING_FORMS = new Set([
  "10-K",
  "10-Q",
  "8-K",
  "20-F",
  "6-K",
  "10-K/A",
  "10-Q/A",
  "8-K/A",
  "20-F/A",
  "6-K/A",
]);

export type SecSummaryImportance = "high" | "medium" | "low";

export type SecSummaryBullet = {
  label: string;
  detail: string;
  importance: SecSummaryImportance;
};

export type SecHeadingCandidate = {
  title: string;
  level: number;
  start: number;
};

export type SecDocument = {
  text: string;
  headings: SecHeadingCandidate[];
};

export type SecNodeSpec = SecNodeSpecV2;

export type SecNodePlan = {
  nodes: SecNodeSpec[];
  outlineSections: number;
  clamped?: number;
};

export type SecWorkflowEvidence = {
  start: number;
  end: number;
  score: number;
  reasons: string[];
  excerpt: string;
};

export type SecNodeResult = {
  id: string;
  title: string;
  status: "complete" | "empty" | "error";
  findings: SecSummaryBullet[];
  narrative: string;
  facts?: AnalysisFact[];
  evidence: SecWorkflowEvidence[];
  evidenceIds?: string[];
  error?: string;
};

export type SecFiling = {
  ticker: string;
  cik: string;
  cikNumber: number;
  companyName: string;
  form: string;
  filingDate: string;
  reportDate: string;
  accessionNumber: string;
  primaryDocument: string;
  description: string;
  items: string;
  documentUrl: string;
  indexUrl: string;
};

export type SecFilingSummary = {
  ticker: string;
  form: string;
  filingDate: string;
  accessionNumber: string;
  headline: string;
  bullets: SecSummaryBullet[];
  analystView: string;
  report?: string;
  version?: number;
  nodes?: SecNodeResult[];
  plan?: SecNodePlan;
  managerReview?: ManagerReview;
  repairRounds?: number;
  source: "deepseek" | "error";
  generatedAt: string;
  error?: string;
};

export type SecFilingWithSummary = SecFiling & {
  summary: SecFilingSummary | null;
  analysis?: PublishedSecReport | null;
};

export type SecFilingFeed = {
  ticker: string;
  company: { ticker: string; cik: string; name: string } | null;
  filings: SecFilingWithSummary[];
  fetchedAt: string | null;
  status: "ready" | "empty" | "pending" | "unsupported" | "not_applicable" | "stale";
  error?: string;
};

const SEC_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1_000;

export function isSecFeedRefreshDue(feed: SecFilingFeed, nowMs = Date.now()): boolean {
  if (feed.status === "unsupported" || feed.status === "not_applicable") return false;
  if (feed.status === "pending" || feed.status === "stale" || !feed.fetchedAt) return true;
  const fetchedAt = Date.parse(feed.fetchedAt);
  return !Number.isFinite(fetchedAt) || nowMs - fetchedAt >= SEC_REFRESH_INTERVAL_MS;
}

export type SecCompany = {
  ticker: string;
  cik: string;
  cikNumber: number;
  name: string;
};

type SummaryFilingIdentity = Pick<SecFiling, "ticker" | "form" | "filingDate" | "accessionNumber">;

export function cleanSecTicker(value: string): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export function cleanSecAccession(value: string): string {
  return String(value ?? "").trim().replace(/[^0-9A-Za-z-]/g, "");
}

export function isBusinessFiling(form: string): boolean {
  return BUSINESS_FILING_FORMS.has(form);
}

export function sortSecFilings(filings: SecFiling[]): SecFiling[] {
  return [...filings].sort((left, right) => {
    const filingDate = right.filingDate.localeCompare(left.filingDate);
    if (filingDate !== 0) return filingDate;
    return 0;
  });
}

export function htmlToSecText(html: string): string {
  return flattenSecHtml(stripSecNonContent(String(html ?? "")));
}

export function htmlToSecDocument(html: string): SecDocument {
  const source = stripSecNonContent(String(html ?? ""));
  const text = flattenSecHtml(source);
  const emphasis = collectSecEmphasis(source);
  const headings: SecHeadingCandidate[] = [];
  let cursor = 0;
  for (const line of text.split("\n")) {
    const title = line.trim();
    if (title) {
      const level = emphasis.get(title) ?? (isSecItemHeading(title) ? ITEM_HEADING_LEVEL : 0);
      if (level) headings.push({ title, level, start: cursor + line.length - line.trimStart().length });
    }
    cursor += line.length + 1;
  }
  return { text, headings };
}

function stripSecNonContent(html: string): string {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<xbrli:context[\s\S]*?<\/xbrli:context>/gi, " ")
    .replace(/<xbrli:unit[\s\S]*?<\/xbrli:unit>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
}

function flattenSecHtml(html: string): string {
  return decodeEntities(html
    .replace(/<\/(p|div|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function collectSecEmphasis(html: string): Map<string, number> {
  const levels = new Map<string, number>();
  const record = (raw: string, level: number) => {
    const title = flattenSecHtml(raw).replace(/\s+/g, " ").trim();
    if (!title || title.length > MAX_HEADING_CHARACTERS) return;
    levels.set(title, Math.min(levels.get(title) ?? level, level));
  };
  for (const match of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]{0,400}?)<\/h\1\s*>/gi)) record(match[2], Number(match[1]));
  for (const match of html.matchAll(/<(b|strong)\b[^>]*>([\s\S]{0,400}?)<\/\1\s*>/gi)) record(match[2], BOLD_HEADING_LEVEL);
  for (const match of html.matchAll(/<([a-z]+)\b[^>]*font-weight\s*:\s*(?:bold(?:er)?|[6-9]00)[^>]*>([\s\S]{0,400}?)<\/\1\s*>/gi)) record(match[2], BOLD_HEADING_LEVEL);
  return levels;
}

function isSecItemHeading(value: string): boolean {
  return /^(?:part\s+[ivx]+|items?\s+\d{1,2}[a-z]?)\b/i.test(value.trim());
}

export function cleanSecNodeId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function normalizeSecSummary(
  value: unknown,
  filing: SummaryFilingIdentity,
  now = new Date(),
): SecFilingSummary {
  const input = asRecord(value) ?? {};
  const blocked = [/did not contain readable text/i, /未找到/i, /未定位到/i, /无法读取/i, /需要.*复核/i, /需.*复核/i, /等待.*复核/i];
  const clean = (item: unknown, max: number) => String(item ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const useful = (item: string) => Boolean(item) && !blocked.some((pattern) => pattern.test(item));
  const rawBullets = Array.isArray(input.bullets) ? input.bullets : [];
  const bullets = rawBullets.flatMap((item): SecSummaryBullet[] => {
    const bullet = asRecord(item);
    const label = clean(bullet?.label, 24);
    const detail = clean(bullet?.detail, 320);
    if (!label || !useful(detail)) return [];
    const importance = bullet?.importance === "high" || bullet?.importance === "low" ? bullet.importance : "medium";
    return [{ label, detail, importance }];
  }).slice(0, 5);
  const headline = clean(input.headline, 180);
  const analystView = clean(input.analystView, 260);
  const report = String(input.report ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6_000);

  return {
    ticker: cleanSecTicker(filing.ticker),
    form: String(filing.form ?? ""),
    filingDate: String(filing.filingDate ?? ""),
    accessionNumber: cleanSecAccession(filing.accessionNumber),
    headline: useful(headline) ? headline : "",
    bullets,
    analystView: useful(analystView) ? analystView : "",
    ...(useful(report) ? { report } : {}),
    ...(Number.isInteger(input.version) ? { version: Number(input.version) } : {}),
    source: input.source === "error" ? "error" : "deepseek",
    generatedAt: typeof input.generatedAt === "string" ? input.generatedAt : now.toISOString(),
    ...(typeof input.error === "string" && input.error ? { error: clean(input.error, 240) } : {}),
  };
}

export function isSummaryRetryDue(summary: SecFilingSummary, nowMs = Date.now()): boolean {
  const fullReportForm = /^(10-K|10-Q|20-F)(\/A)?$/.test(summary.form);
  if (fullReportForm && summary.source !== "error" && (summary.version !== SEC_SUMMARY_VERSION || !summary.report)) return true;
  if (summary.headline || summary.bullets.length || summary.analystView) return false;
  if (summary.source !== "error") return true;
  if (summary.error === "DeepSeek HTTP 400") return true;
  const generatedAt = Date.parse(summary.generatedAt);
  return !Number.isFinite(generatedAt) || nowMs - generatedAt >= 24 * 60 * 60 * 1_000;
}

export function parseSecSubmissions(payload: unknown, company: SecCompany, limit = 5): SecFiling[] {
  const root = asRecord(payload);
  const filingsRoot = asRecord(root?.filings);
  const recent = asRecord(filingsRoot?.recent);
  const accessions = asArray(recent?.accessionNumber);
  const forms = asArray(recent?.form);
  const filingDates = asArray(recent?.filingDate);
  const reportDates = asArray(recent?.reportDate);
  const primaryDocuments = asArray(recent?.primaryDocument);
  const descriptions = asArray(recent?.primaryDocDescription);
  const items = asArray(recent?.items);
  const companyName = typeof root?.name === "string" && root.name ? root.name : company.name;

  const filings = accessions.flatMap((accessionValue, index): SecFiling[] => {
    const accessionNumber = String(accessionValue ?? "");
    const form = String(forms[index] ?? "");
    const primaryDocument = String(primaryDocuments[index] ?? "");
    if (!isBusinessFiling(form) || !accessionNumber || !primaryDocument) return [];
    const accessionPath = accessionNumber.replaceAll("-", "");
    const archiveRoot = `https://www.sec.gov/Archives/edgar/data/${company.cikNumber}/${accessionPath}`;
    return [{
      ticker: company.ticker,
      cik: company.cik,
      cikNumber: company.cikNumber,
      companyName,
      form,
      filingDate: String(filingDates[index] ?? ""),
      reportDate: String(reportDates[index] ?? ""),
      accessionNumber,
      primaryDocument,
      description: String(descriptions[index] ?? ""),
      items: String(items[index] ?? ""),
      documentUrl: `${archiveRoot}/${primaryDocument}`,
      indexUrl: `${archiveRoot}/${accessionNumber}-index.html`,
    }];
  });

  return sortSecFilings(filings).slice(0, Math.max(0, limit));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
