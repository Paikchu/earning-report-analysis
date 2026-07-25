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
  source: "deepseek" | "error";
  generatedAt: string;
  error?: string;
};

export type SecFilingWithSummary = SecFiling & {
  summary: SecFilingSummary | null;
};

export type SecFilingFeed = {
  ticker: string;
  company: { ticker: string; cik: string; name: string } | null;
  filings: SecFilingWithSummary[];
  fetchedAt: string | null;
  status: "ready" | "empty" | "pending" | "unsupported" | "not_applicable" | "stale";
  error?: string;
};

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

export function htmlToSecText(html: string): string {
  return decodeEntities(String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
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

  return {
    ticker: cleanSecTicker(filing.ticker),
    form: String(filing.form ?? ""),
    filingDate: String(filing.filingDate ?? ""),
    accessionNumber: cleanSecAccession(filing.accessionNumber),
    headline: useful(headline) ? headline : "",
    bullets,
    analystView: useful(analystView) ? analystView : "",
    source: input.source === "error" ? "error" : "deepseek",
    generatedAt: typeof input.generatedAt === "string" ? input.generatedAt : now.toISOString(),
    ...(typeof input.error === "string" && input.error ? { error: clean(input.error, 240) } : {}),
  };
}

export function isSummaryRetryDue(summary: SecFilingSummary, nowMs = Date.now()): boolean {
  if (summary.headline || summary.bullets.length || summary.analystView) return false;
  if (summary.source !== "error") return true;
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

  return accessions.flatMap((accessionValue, index): SecFiling[] => {
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
  }).slice(0, Math.max(0, limit));
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
