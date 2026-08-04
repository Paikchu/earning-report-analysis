import {
  buildFilingBlocks,
  buildModulePayload,
  buildPeriodIdentity,
  buildRouterPayload,
  buildSummaryPayload,
  compareSnapshots,
  fallbackRouterResult,
  hashString,
  normalizeModuleAnalysis,
  normalizePublishedReport,
  normalizeRouterResult,
  SEC_ANALYSIS_MODULES,
  SEC_ANALYSIS_SCHEMA_VERSION,
  type ComparisonResult,
  type FilingBlock,
  type ModuleAnalysis,
  type RouterResult,
  type SecAnalysisModuleKey,
  type SnapshotSummary,
} from "./sec-analysis.ts";
import { cleanSecTicker, htmlToSecText, parseSecSubmissions, type SecCompany, type SecFiling, type SecFilingFeed, type SecFilingSummary } from "./sec.ts";
import type { SecAnalysisArtifact, SecAnalysisContext } from "./sec-service.ts";

export type SecModelCall = (stage: string, system: string, payload: unknown) => Promise<Record<string, unknown>>;

export type SecDiscoveryRuntime = {
  userAgent: string;
  fetcher?: typeof fetch;
  now?: () => Date;
};

export type SecPreparationRuntime = {
  userAgent: string;
  fetcher?: typeof fetch;
};

export type PreparedSecFiling = {
  filing: SecFiling;
  periodId: string;
  periodScope: "quarter" | "annual";
  blocks: FilingBlock[];
};

export async function discoverSecTicker(rawTicker: string, runtime: SecDiscoveryRuntime): Promise<{ feed: SecFilingFeed; filings: SecFiling[] }> {
  const ticker = cleanSecTicker(rawTicker);
  const now = (runtime.now ?? (() => new Date()))();
  const fetcher = runtime.fetcher ?? fetch;
  const request = async (url: string) => {
    const response = await fetcher(url, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": runtime.userAgent },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
    return response;
  };
  const tickerMap = parseTickerMap(await (await request("https://www.sec.gov/files/company_tickers_exchange.json")).json());
  const company = tickerMap[ticker];
  if (!company) {
    return { feed: { ticker, company: null, filings: [], fetchedAt: now.toISOString(), status: "unsupported" }, filings: [] };
  }
  const submissions = await request(`https://data.sec.gov/submissions/CIK${company.cik}.json`);
  const allFilings = parseSecSubmissions(await submissions.json(), company, 40);
  return {
    feed: {
      ticker,
      company: { ticker, cik: company.cik, name: allFilings[0]?.companyName ?? company.name },
      filings: allFilings.slice(0, 5).map((filing) => ({ ...filing, summary: null, analysis: null })),
      fetchedAt: now.toISOString(),
      status: allFilings.length ? "ready" : "empty",
    },
    filings: selectWorkflowFilings(allFilings),
  };
}

export function selectWorkflowFilings(filings: SecFiling[]): SecFiling[] {
  const primary = filings.find((filing) => /^(10-Q|10-K|20-F)(\/A)?$/.test(filing.form));
  return primary ? [primary] : [];
}

export async function prepareSecFiling(filing: SecFiling, runtime: SecPreparationRuntime): Promise<PreparedSecFiling> {
  const response = await (runtime.fetcher ?? fetch)(filing.documentUrl, {
    cache: "no-store",
    headers: { accept: "text/html,application/xhtml+xml,text/plain,*/*", "user-agent": runtime.userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SEC filing HTTP ${response.status}`);
  const text = htmlToSecText(await response.text());
  if (!text) throw new Error("SEC filing document did not contain readable text");
  const blocks = buildFilingBlocks(text, filing.accessionNumber);
  if (!blocks.length) throw new Error("SEC filing did not produce analysis blocks");
  const { periodId, periodScope } = buildPeriodIdentity(filing.ticker, filing.form, filing.reportDate);
  return { filing, periodId, periodScope, blocks };
}

export async function routePreparedSecFiling(prepared: PreparedSecFiling, context: SecAnalysisContext, model: SecModelCall): Promise<RouterResult> {
  const priorModules = [
    ...Object.entries(context.qoq).map(([moduleKey, prior]) => prior ? { moduleKey: moduleKey as SecAnalysisModuleKey, periodId: prior.periodId } : null),
    ...Object.entries(context.yoy).map(([moduleKey, prior]) => prior ? { moduleKey: moduleKey as SecAnalysisModuleKey, periodId: prior.periodId } : null),
  ].filter((item): item is { moduleKey: SecAnalysisModuleKey; periodId: string } => Boolean(item));
  const value = await model("router", routerSystemPrompt(), buildRouterPayload(prepared.filing, prepared.blocks, priorModules));
  const router = normalizeRouterResult(value, prepared.blocks);
  return router.selections.length ? router : fallbackRouterResult(prepared.blocks);
}

export async function analyzePreparedSecModule(
  moduleKey: SecAnalysisModuleKey,
  prepared: PreparedSecFiling,
  context: SecAnalysisContext,
  router: RouterResult,
  model: SecModelCall,
): Promise<ModuleAnalysis> {
  const moduleDefinition = SEC_ANALYSIS_MODULES.find((item) => item.key === moduleKey);
  if (!moduleDefinition) throw new Error(`Unknown SEC analysis module: ${moduleKey}`);
  const selection = router.selections.find((item) => item.moduleKey === moduleKey);
  const selectedIds = new Set(selection?.blockIds ?? []);
  const currentBlocks = prepared.blocks.filter((block) => selectedIds.has(block.blockId)).slice(0, 8);
  if (!currentBlocks.length) {
    return { moduleKey, facts: [], claims: [], memoryCandidates: [], missingFields: [...moduleDefinition.fields], evidenceCoverage: 0, verificationStatus: "failed" };
  }
  const payload = buildModulePayload({
    moduleKey,
    filing: prepared.filing,
    currentBlocks,
    currentFacts: [],
    qoq: context.qoq[moduleKey],
    yoy: context.yoy[moduleKey],
    activeMemory: context.activeMemory,
    precomputedDeltas: [],
  });
  const value = await model(`module:${moduleKey}`, moduleSystemPrompt(moduleKey), payload);
  return normalizeModuleAnalysis(value, moduleKey, new Set(prepared.blocks.map((block) => `ev:${block.blockId}`)));
}

export async function summarizePreparedSecFiling(
  prepared: PreparedSecFiling,
  context: SecAnalysisContext,
  router: RouterResult,
  moduleAnalyses: ModuleAnalysis[],
  model: SecModelCall,
  now = new Date(),
): Promise<{ artifact: SecAnalysisArtifact; summary: SecFilingSummary }> {
  const snapshots = moduleAnalyses.map((analysis): SnapshotSummary => ({
    ticker: prepared.filing.ticker,
    periodId: prepared.periodId,
    filingId: prepared.filing.accessionNumber,
    moduleKey: analysis.moduleKey,
    facts: analysis.facts,
    claims: analysis.claims,
    memoryCandidates: analysis.memoryCandidates,
    missingFields: analysis.missingFields,
    evidenceCoverage: analysis.evidenceCoverage,
    verificationStatus: analysis.verificationStatus,
  }));
  const qoqResults = snapshots.flatMap((snapshot) => context.qoq[snapshot.moduleKey] ? [compareSnapshots("qoq", snapshot, context.qoq[snapshot.moduleKey]!)] : []);
  const yoyResults = snapshots.flatMap((snapshot) => context.yoy[snapshot.moduleKey] ? [compareSnapshots("yoy", snapshot, context.yoy[snapshot.moduleKey]!)] : []);
  const qoq = mergeComparisons("qoq", qoqResults, prepared.periodId, context.qoqPeriodId);
  const yoy = mergeComparisons("yoy", yoyResults, prepared.periodId, context.yoyPeriodId);
  const summaryPayload = buildSummaryPayload({ ticker: prepared.filing.ticker, periodId: prepared.periodId, moduleSnapshots: snapshots, qoq, yoy });
  const summaryValue = await model("summary", summarySystemPrompt(), summaryPayload);
  let report = normalizePublishedReport(summaryValue, {
    ticker: prepared.filing.ticker,
    periodId: prepared.periodId,
    reportVersion: `${SEC_ANALYSIS_SCHEMA_VERSION}:${hashString(JSON.stringify(summaryPayload))}`,
  }, new Set(prepared.blocks.map((block) => `ev:${block.blockId}`)));
  report = addDeterministicDeltas(report, qoq, yoy);
  report = enforceDeterministicReportQuality(report, moduleAnalyses);
  const artifact: SecAnalysisArtifact = {
    filing: prepared.filing,
    periodId: prepared.periodId,
    periodScope: prepared.periodScope,
    blocks: prepared.blocks,
    moduleAnalyses,
    snapshots,
    comparisons: [...qoqResults, ...yoyResults],
    memoryCandidates: moduleAnalyses.flatMap((analysis) => analysis.memoryCandidates),
    report,
    router,
  };
  return { artifact, summary: toLegacySummary(artifact, now) };
}

function parseTickerMap(payload: unknown): Record<string, SecCompany> {
  const root = asRecord(payload);
  const fields = Array.isArray(root?.fields) ? root.fields.map(String) : [];
  const rows = Array.isArray(root?.data) ? root.data : [];
  const tickerIndex = fields.indexOf("ticker");
  const cikIndex = fields.indexOf("cik");
  const nameIndex = fields.indexOf("name");
  const result: Record<string, SecCompany> = {};
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const ticker = cleanSecTicker(String(row[tickerIndex] ?? ""));
    const cikNumber = Number(row[cikIndex]);
    if (!ticker || !Number.isFinite(cikNumber)) continue;
    result[ticker] = { ticker, cik: String(cikNumber).padStart(10, "0"), cikNumber, name: String(row[nameIndex] ?? "") };
  }
  return result;
}

function routerSystemPrompt() {
  return [
    "You are a filing section router.",
    "Select relevant blocks based on the data needs, not exact heading names.",
    "Only return block IDs present in the supplied inventory. Do not extract facts yet.",
    "Return JSON: {\"selections\":[{\"moduleKey\":\"\",\"blockIds\":[],\"expectedFields\":[],\"priority\":\"high|medium|low\",\"needFullText\":true,\"confidence\":0.0}]}",
  ].join("\n");
}

function moduleSystemPrompt(moduleKey: SecAnalysisModuleKey) {
  return [
    "You are a financial filing module analyst.",
    `Module: ${moduleKey}.`,
    "Use only the supplied evidence. Preserve GAAP, non-GAAP, management KPI, units, periods, and definitions.",
    "Every fact and claim must cite one or more evidence IDs.",
    "Return one JSON object using the exact outputSchema keys and types in the user payload.",
  ].join("\n");
}

function summarySystemPrompt() {
  return [
    "You are the final filing summary composer.",
    "Use only verified module snapshots and deterministic comparison results.",
    "Do not invent numbers, evidence, or changes. Keep qoq and yoy separate.",
    "Return simplified Chinese JSON with headline, keyMetrics, changes, and dataQuality.",
  ].join("\n");
}

function mergeComparisons(
  comparisonType: "qoq" | "yoy",
  results: ComparisonResult[],
  currentPeriodId: string,
  priorPeriodId: string | null,
): ComparisonResult | null {
  if (!priorPeriodId) return null;
  return {
    comparisonType,
    currentPeriodId,
    priorPeriodId,
    comparability: results.some((result) => result.comparability === "full") ? "full" : results.length ? "partial" : "not_comparable",
    metricDeltas: results.flatMap((result) => result.metricDeltas),
    narrativeDeltas: results.flatMap((result) => result.narrativeDeltas),
  };
}

function addDeterministicDeltas(report: SecAnalysisArtifact["report"], qoq: ComparisonResult | null, yoy: ComparisonResult | null) {
  const deltaValue = (comparison: ComparisonResult | null, metricKey: string) => {
    const delta = comparison?.metricDeltas.find((item) => item.metricKey === metricKey)?.percentageDelta;
    if (delta === undefined) return undefined;
    const value = Number(delta);
    return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%` : undefined;
  };
  return {
    ...report,
    keyMetrics: report.keyMetrics.map((metric) => ({
      ...metric,
      qoq: deltaValue(qoq, metric.metricKey) ?? metric.qoq,
      yoy: deltaValue(yoy, metric.metricKey) ?? metric.yoy,
    })),
  };
}

function enforceDeterministicReportQuality(report: SecAnalysisArtifact["report"], moduleAnalyses: ModuleAnalysis[]): SecAnalysisArtifact["report"] {
  const factKeys = new Set(moduleAnalyses.flatMap((module) => module.facts.map((fact) => fact.metricKey)));
  const informativeModules = moduleAnalyses.filter((module) => module.facts.length + module.claims.length > 0).length;
  const keyMetrics = report.keyMetrics.filter((metric) => factKeys.has(metric.metricKey));
  const coverage = moduleAnalyses.length ? informativeModules / moduleAnalyses.length : 0;
  const verificationStatus = !factKeys.size || !keyMetrics.length
    ? "failed"
    : factKeys.size >= 3 && keyMetrics.length >= 2 && informativeModules >= 3
      ? "verified"
      : "partial";
  const warnings = [...report.dataQuality.warnings];
  if (verificationStatus === "failed") warnings.push("No evidence-grounded financial metrics passed deterministic verification");
  else if (verificationStatus === "partial") warnings.push("Verified evidence coverage is below the full-report threshold");
  return {
    ...report,
    keyMetrics,
    dataQuality: {
      coverage,
      verificationStatus,
      warnings: [...new Set(warnings)].slice(0, 20),
    },
  };
}

function toLegacySummary(artifact: SecAnalysisArtifact, now: Date): SecFilingSummary {
  return {
    ticker: artifact.filing.ticker,
    form: artifact.filing.form,
    filingDate: artifact.filing.filingDate,
    accessionNumber: artifact.filing.accessionNumber,
    headline: artifact.report.headline,
    bullets: artifact.report.keyMetrics.slice(0, 5).map((metric) => ({
      label: metric.metricKey.slice(0, 24),
      detail: `${metric.currentValue}${metric.yoy ? `，同比 ${metric.yoy}` : ""}${metric.qoq ? `，环比 ${metric.qoq}` : ""}`,
      importance: metric.status === "verified" ? "high" as const : "medium" as const,
    })),
    analystView: artifact.report.dataQuality.warnings.join("；"),
    source: "deepseek",
    generatedAt: now.toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
