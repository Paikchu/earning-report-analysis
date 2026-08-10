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
import {
  buildSecNodeInput,
  buildSecOutline,
  describeSecOutline,
  normalizeSecNodePlan,
  normalizeSecNodeResult,
  type SecOutlineSection,
} from "./sec-report.ts";
import {
  cleanSecTicker,
  htmlToSecDocument,
  normalizeSecSummary,
  parseSecSubmissions,
  SEC_SUMMARY_VERSION,
  type SecCompany,
  type SecDocument,
  type SecFiling,
  type SecFilingFeed,
  type SecFilingSummary,
  type SecNodePlan,
  type SecNodeResult,
  type SecNodeSpec,
} from "./sec.ts";
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
  document: SecDocument;
  outline: SecOutlineSection[];
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
  const events = filings.slice(0, 5).filter((filing) => /^(8-K|6-K)(\/A)?$/.test(filing.form));
  return [...(primary ? [primary] : []), ...events]
    .filter((filing, index, selected) => selected.findIndex((candidate) => candidate.accessionNumber === filing.accessionNumber) === index);
}

export async function prepareSecFiling(filing: SecFiling, runtime: SecPreparationRuntime): Promise<PreparedSecFiling> {
  const response = await (runtime.fetcher ?? fetch)(filing.documentUrl, {
    cache: "no-store",
    headers: { accept: "text/html,application/xhtml+xml,text/plain,*/*", "user-agent": runtime.userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SEC filing HTTP ${response.status}`);
  const document = htmlToSecDocument(await response.text());
  if (!document.text) throw new Error("SEC filing document did not contain readable text");
  const blocks = buildFilingBlocks(document.text, filing.accessionNumber);
  if (!blocks.length) throw new Error("SEC filing did not produce analysis blocks");
  const { periodId, periodScope } = buildPeriodIdentity(filing.ticker, filing.form, filing.reportDate);
  return { filing, periodId, periodScope, blocks, document, outline: buildSecOutline(document) };
}

export async function planPreparedSecFiling(prepared: PreparedSecFiling, model: SecModelCall): Promise<SecNodePlan> {
  if (!prepared.outline.length) return { nodes: [], outlineSections: 0 };
  const value = await model("manager", managerSystemPrompt(), {
    ticker: prepared.filing.ticker,
    companyName: prepared.filing.companyName,
    form: prepared.filing.form,
    reportDate: prepared.filing.reportDate,
    filingDate: prepared.filing.filingDate,
    sections: describeSecOutline(prepared.outline),
  });
  return normalizeSecNodePlan(value, prepared.outline);
}

export async function analyzePreparedSecNode(
  prepared: PreparedSecFiling,
  spec: SecNodeSpec,
  model: SecModelCall,
): Promise<SecNodeResult> {
  const input = buildSecNodeInput(spec, prepared.outline, prepared.document.text);
  if (!input.sections.length) {
    return { id: spec.id, title: spec.title, status: "empty", findings: [], narrative: "", evidence: [] };
  }
  try {
    const value = await model(`node:${spec.id}`, nodeSystemPrompt(), {
      ticker: prepared.filing.ticker,
      companyName: prepared.filing.companyName,
      form: prepared.filing.form,
      reportDate: prepared.filing.reportDate,
      task: { title: spec.title, question: spec.question },
      sections: input.sections.map(({ id, title, text, compressed }) => ({ id, title, text, compressed })),
    });
    return normalizeSecNodeResult(value, spec, input.evidence);
  } catch (error) {
    return {
      id: spec.id,
      title: spec.title,
      status: "error",
      findings: [],
      narrative: "",
      evidence: input.evidence,
      error: error instanceof Error ? error.message : "node failed",
    };
  }
}

export async function summarizePreparedSecEvent(
  prepared: PreparedSecFiling,
  model: SecModelCall,
  now = new Date(),
): Promise<SecFilingSummary> {
  const value = await model("event-summary", eventSummarySystemPrompt(), {
    ticker: prepared.filing.ticker,
    companyName: prepared.filing.companyName,
    form: prepared.filing.form,
    filingDate: prepared.filing.filingDate,
    reportDate: prepared.filing.reportDate,
    accessionNumber: prepared.filing.accessionNumber,
    items: prepared.filing.items,
    sections: prepared.blocks.slice(0, 12).map((block) => ({
      heading: block.heading,
      text: block.body.slice(0, 2_400),
    })),
  });
  const summary = normalizeSecSummary({ ...value, source: "deepseek" }, prepared.filing, now);
  if (!summary.headline || !summary.bullets.length || !summary.analystView) {
    throw new Error("Event summary returned incomplete analysis");
  }
  return summary;
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
  plan?: SecNodePlan,
  nodes: SecNodeResult[] = [],
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
  const usableNodes = nodes.filter((node) => node.status === "complete" && (node.narrative || node.findings.length));
  if (!plan?.nodes.length || !usableNodes.length) throw new Error("Manager produced no usable analysis nodes");
  const summaryPayload = {
    ...buildSummaryPayload({ ticker: prepared.filing.ticker, periodId: prepared.periodId, moduleSnapshots: snapshots, qoq, yoy }),
    nodeAnalyses: usableNodes.map(({ id, title, findings, narrative }) => ({ id, title, findings, narrative })),
    outputSchema: {
      headline: "string",
      bullets: "[{label, detail, importance}]",
      analystView: "string",
      report: "string",
      keyMetrics: "[{metricKey, currentValue, qoq?, yoy?, status, evidenceIds}]",
      changes: "{qoq, yoy, guidance, risks}",
      dataQuality: "{coverage, verificationStatus, warnings}",
    },
  };
  const summaryValue = await model("synthesis", synthesisSystemPrompt(), summaryPayload);
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
  const normalizedSummary = normalizeSecSummary({ ...summaryValue, source: "deepseek", version: SEC_SUMMARY_VERSION }, prepared.filing, now);
  if (!normalizedSummary.report || normalizedSummary.report.length < 900 || normalizedSummary.report.length > 1_600) {
    throw new Error("Synthesis report must contain 900–1,600 characters");
  }
  if (normalizedSummary.bullets.length < 3 || normalizedSummary.bullets.length > 5 || !normalizedSummary.analystView) {
    throw new Error("Synthesis must contain 3–5 core conclusions and an investment view");
  }
  const summary = {
    ...normalizedSummary,
    nodes,
    plan,
  };
  return { artifact, summary };
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

function managerSystemPrompt() {
  return [
    "你是负责美股财报研究的主编，正在为一份 SEC filing 编排分析任务。",
    "输入只有章节标题清单，不含正文。主题数量和内容必须由本期 filing 的实际结构决定，不要套用固定模板。",
    "并购、减值、重大诉讼、分部重组、会计政策变更等特殊事项应独立成节点。",
    "每个节点只能使用清单内的 sectionIds，至少绑定一个章节，不要让两个节点承担同一问题。",
    "title 和 question 使用简体中文；id 使用小写英文短横线 slug；keywords 使用英文原文术语。",
    "输出 JSON：{\"nodes\":[{\"id\":\"\",\"title\":\"\",\"question\":\"\",\"sectionIds\":[\"\"],\"keywords\":[\"\"]}]}",
  ].join("\n");
}

function nodeSystemPrompt() {
  return [
    "你是美股基本面研究团队的分段分析师，只处理主编交给你的一个任务。",
    "只使用给定的英文 SEC 原文章节，不引入外部信息，不编造数字。",
    "回答 question；数字必须带口径和比较期间，并说明变化方向及驱动原因。",
    "原文无法回答时将 narrative 留空，不要输出空泛措辞。",
    "findings 输出 2 至 6 条具体事实；narrative 输出 300 至 700 字简体中文，可用空行分段，不要使用 Markdown。",
    "输出 JSON：{\"findings\":[{\"label\":\"\",\"detail\":\"\",\"importance\":\"high|medium|low\"}],\"narrative\":\"\"}",
  ].join("\n");
}

function eventSummarySystemPrompt() {
  return [
    "你是负责美股基本面研究的资深金融分析师，只处理 8-K 或 6-K 事件简析。",
    "只根据给定 SEC filing 内容输出简体中文，不使用外部信息，不编造数字。",
    "说明事件本身、发生原因，以及对盈利、现金流或资产负债表的具体影响；没有证据的维度直接省略。",
    "headline 是一句有方向性的结论；bullets 输出 3 至 5 条具体事实；analystView 说明投资含义但不给买卖建议。",
    "输出 JSON：{\"headline\":\"\",\"bullets\":[{\"label\":\"\",\"detail\":\"\",\"importance\":\"high|medium|low\"}],\"analystView\":\"\"}",
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

function synthesisSystemPrompt() {
  return [
    "你是美股基本面研究团队的总编。输入只有分段分析、已验证模块快照和确定性比较结果，不含 filing 原文。",
    "完整研报的章节逻辑必须来自 nodeAnalyses，不要重新套用固定主题模板。",
    "数字、同比、环比和证据只能使用结构化输入中已有的值；不得编造或把 qoq 与 yoy 混写。",
    "report 输出 900 至 1,600 字简体中文正文，按投资者阅读逻辑用空行分段，不要使用 Markdown 标题或项目符号。",
    "headline 给出有方向性的结论；bullets 输出 3 至 5 条核心结论；analystView 说明投资含义但不给买卖建议。",
    "同时输出 keyMetrics、changes 和 dataQuality，字段严格遵循 outputSchema。",
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
