import {
  buildFilingBlocks,
  buildPeriodIdentity,
  canonicalMetricKey,
  buildSecAnalysisBrief,
  hashString,
  normalizeManagerReview,
  normalizePublishedReport,
  SEC_ANALYSIS_SCHEMA_VERSION,
  type AnalysisFact,
  type ComparisonResult,
  type FilingBlock,
  type ManagerReview,
  type SecAnalysisBrief,
  type SecHistorySnapshot,
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
  hasOnlyEventMetadataBullets,
  htmlToSecDocument,
  normalizeSecSummary,
  parseSecSubmissions,
  SEC_SUMMARY_VERSION,
  streamSecSubmissionParts,
  type SecCompany,
  type SecDocument,
  type SecFiling,
  type SecFilingFeed,
  type SecFilingSummary,
  type SecNodePlan,
  type SecNodeResult,
  type SecNodeSpec,
} from "./sec.ts";
import type { SecAnalysisArtifact, SecAnalysisContext } from "./sec-types.ts";

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

/** Everything the planning, review and synthesis stages need — no filing text. */
export type PreparedSecFilingMeta = {
  filing: SecFiling;
  periodId: string;
  periodScope: "quarter" | "annual";
  outline: SecOutlineSection[];
  blockIds: string[];
};

/** Meta plus the filing body, needed only by node analysis, event summaries and publication. */
export type PreparedSecFiling = PreparedSecFilingMeta & {
  blocks: FilingBlock[];
  document: SecDocument;
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
      filings: allFilings.map((filing) => ({ ...filing, summary: null, analysis: null })),
      fetchedAt: now.toISOString(),
      status: allFilings.length ? "ready" : "empty",
    },
    filings: allFilings,
  };
}

export function selectWorkflowFilings(filings: SecFiling[]): SecFiling[] {
  const primary = filings.find((filing) => /^(10-Q|10-K|20-F)(\/A)?$/.test(filing.form));
  const events = filings.slice(0, 5).filter((filing) => /^(8-K|6-K)(\/A)?$/.test(filing.form));
  return [...(primary ? [primary] : []), ...events]
    .filter((filing, index, selected) => selected.findIndex((candidate) => candidate.accessionNumber === filing.accessionNumber) === index);
}

export async function prepareSecFiling(filing: SecFiling, runtime: SecPreparationRuntime): Promise<PreparedSecFiling> {
  if (/^(8-K|6-K)(\/A)?$/.test(filing.form)) {
    try {
      return await prepareEventFilingWithExhibits(filing, runtime);
    } catch {
      // Exhibit discovery is best-effort; fall back to the single-document path below.
    }
  }
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
  return {
    filing,
    periodId,
    periodScope,
    outline: buildSecOutline(document),
    blockIds: blocks.map((block) => `ev:${block.blockId}`),
    blocks,
    document,
  };
}

/**
 * 8-K/6-K bodies contain only regulatory metadata (form header, addresses, signers); the actual
 * disclosure lives in exhibits like EX-99.1. Streams the full-submission envelope, parses the body
 * and each exhibit into tagged blocks, and offsets spans so everything stays consistent with one
 * combined document text. Falls back to the single-document path when the envelope is unavailable.
 */
async function prepareEventFilingWithExhibits(filing: SecFiling, runtime: SecPreparationRuntime): Promise<PreparedSecFiling> {
  const parts = await streamSecSubmissionParts(filing.cikNumber, filing.accessionNumber, runtime.fetcher ?? fetch, runtime.userAgent);
  if (!parts.length) throw new Error("SEC submission stream contained no text documents");
  // Body first, exhibits in stream order — keeps existing "document order" semantics.
  const ordered = [...parts].sort((left, right) => {
    const leftBody = /^(8-K|6-K)(\/A)?$/i.test(left.type) ? 0 : 1;
    const rightBody = /^(8-K|6-K)(\/A)?$/i.test(right.type) ? 0 : 1;
    return leftBody - rightBody;
  });
  const documents: SecDocument[] = [];
  const partBlocks: Array<{ blocks: FilingBlock[]; base: number; type: string; isBody: boolean }> = [];
  let base = 0;
  for (const part of ordered) {
    const document = htmlToSecDocument(part.text);
    if (!document.text) continue;
    documents.push(document);
    partBlocks.push({ blocks: buildFilingBlocks(document.text, filing.accessionNumber), base, type: part.type, isBody: /^(8-K|6-K)(\/A)?$/i.test(part.type) });
    base += document.text.length + 2; // 2 = "\n\n" separator in the combined text
  }
  if (!documents.length) throw new Error("SEC submission stream contained no readable text");
  const combinedText = documents.map((document) => document.text).join("\n\n");
  const blocks = partBlocks.flatMap(({ blocks: partBlocksForPart, base: partBase, type, isBody }) =>
    partBlocksForPart.map((block) => ({
      ...block,
      start: block.start + partBase,
      end: block.end + partBase,
      ...(isBody ? { source: "body" as const } : { source: "exhibit" as const, exhibitType: type }),
    })));
  const document: SecDocument = {
    text: combinedText,
    headings: partBlocks.flatMap(({ base: partBase }, index) =>
      documents[index].headings.map((heading) => ({ ...heading, start: heading.start + partBase }))),
  };
  const { periodId, periodScope } = buildPeriodIdentity(filing.ticker, filing.form, filing.reportDate);
  return {
    filing,
    periodId,
    periodScope,
    outline: buildSecOutline(document),
    blockIds: blocks.map((block) => `ev:${block.blockId}`),
    blocks,
    document,
  };
}

export async function planPreparedSecFiling(prepared: PreparedSecFilingMeta, model: SecModelCall, brief?: SecAnalysisBrief): Promise<SecNodePlan> {
  if (!prepared.outline.length) return { nodes: [], outlineSections: 0 };
  const value = await model("manager", managerSystemPrompt(), {
    ticker: prepared.filing.ticker,
    companyName: prepared.filing.companyName,
    form: prepared.filing.form,
    reportDate: prepared.filing.reportDate,
    filingDate: prepared.filing.filingDate,
    sections: describeSecOutline(prepared.outline),
    brief: brief ? briefForAnalysis(brief) : null,
  });
  return normalizeSecNodePlan(value, prepared.outline);
}

/**
 * The analysis stages read the current filing only. Company Memory stays on the brief — it is the
 * record written to R2 and the `priorMemory` the extraction stage needs to continue a memory thread
 * — but no planning, node or synthesis prompt sees it.
 */
function briefForAnalysis(brief: SecAnalysisBrief): Omit<SecAnalysisBrief, "companyMemorySummary" | "memoryItems"> {
  // Deliberately a whitelist rather than a spread minus two keys: a field added to the brief later
  // has to be named here before it can reach a prompt.
  return {
    version: brief.version,
    ticker: brief.ticker,
    filingId: brief.filingId,
    periodId: brief.periodId,
    periodScope: brief.periodScope,
    currentFacts: brief.currentFacts,
    history: brief.history,
    comparisons: brief.comparisons,
    allowedMetricKeys: brief.allowedMetricKeys,
    missingSeriesIds: brief.missingSeriesIds,
  };
}

/**
 * Blocks whose character span overlaps one of the node's outline sections. Text matching cannot
 * work here: buildFilingBlocks normalizes whitespace, so a block body is not a verbatim substring
 * of the document it came from.
 */
export function selectNodeBlocks(blocks: FilingBlock[], sections: Array<{ start: number; end: number }>): FilingBlock[] {
  return blocks
    .filter((block) => sections.some((section) => block.start < section.end && block.end > section.start))
    .slice(0, 24);
}

export async function analyzePreparedSecNode(
  prepared: PreparedSecFiling,
  spec: SecNodeSpec,
  model: SecModelCall,
  brief?: SecAnalysisBrief,
): Promise<SecNodeResult> {
  const input = buildSecNodeInput(spec, prepared.outline, prepared.document.text);
  if (!input.sections.length) {
    return { id: spec.id, title: spec.title, status: "empty", findings: [], narrative: "", facts: [], evidence: [] };
  }
  const nodeSections = spec.sectionIds.flatMap((id) => {
    const section = prepared.outline.find((candidate) => candidate.id === id);
    return section ? [section] : [];
  });
  const nodeBlocks = selectNodeBlocks(prepared.blocks, nodeSections);
  const evidenceIds = nodeBlocks.map((block) => `ev:${block.blockId}`);
  const value = await model(`node:${spec.id}`, nodeSystemPrompt(), {
    ticker: prepared.filing.ticker,
    companyName: prepared.filing.companyName,
    form: prepared.filing.form,
    reportDate: prepared.filing.reportDate,
    task: { title: spec.title, question: spec.question },
    acceptanceCriteria: spec.acceptanceCriteria ?? [],
    history: brief ? brief.history.series.filter((series) => spec.historySeriesIds?.includes(series.seriesId)) : [],
    xbrlFacts: brief?.currentFacts ?? [],
    allowedMetricKeys: brief?.allowedMetricKeys ?? [],
    evidence: nodeBlocks.map((block) => ({ evidenceId: `ev:${block.blockId}`, heading: block.heading, preview: block.preview })),
    sections: input.sections.map(({ id, title, text, compressed }) => ({ id, title, text, compressed })),
  });
  const normalized = normalizeSecNodeResult(value, spec, input.evidence, new Set(evidenceIds));
  return { ...normalized, evidenceIds };
}

/** Degrades a node the model could not produce, once retries with the fallback model are exhausted. */
export function failedSecNode(spec: SecNodeSpec, error: unknown): SecNodeResult {
  return {
    id: spec.id,
    title: spec.title,
    status: "error",
    findings: [],
    narrative: "",
    facts: [],
    evidence: [],
    error: error instanceof Error ? error.message : "node failed",
  };
}

export function buildPreparedSecBrief(
  prepared: PreparedSecFilingMeta,
  context: SecAnalysisContext,
  history: SecHistorySnapshot = context.history ?? { registryVersion: "sec-canonical-series.v1", series: [] },
): SecAnalysisBrief {
  return buildSecAnalysisBrief({
    ticker: prepared.filing.ticker,
    filingId: prepared.filing.accessionNumber,
    periodId: prepared.periodId,
    periodScope: prepared.periodScope,
    reportDate: prepared.filing.reportDate,
    history,
    memorySummary: context.companyMemorySummary ?? "",
    memoryItems: context.memoryItems ?? [],
  });
}

export async function reviewPreparedSecAnalysis(
  prepared: PreparedSecFilingMeta,
  brief: SecAnalysisBrief,
  plan: SecNodePlan,
  nodes: SecNodeResult[],
  round: number,
  model: SecModelCall,
): Promise<ManagerReview> {
  const value = await model(`manager-review:${round}`, managerReviewSystemPrompt(), {
    brief,
    plan,
    round,
    nodes: nodes.map(({ id, title, status, findings, narrative, error }) => ({ id, title, status, findings, narrative, error })),
    outputSchema: {
      status: "complete|needs_repair|partial",
      questions: "[{questionId,status:answered|partial|unanswered|not_disclosed,explanation}]",
      repairTasks: "[{id,questionId,targetNodeId,title,question,sectionIds,keywords,historySeriesIds,acceptanceCriteria,materiality,missingEvidence}]",
      unresolvedQuestions: "[string]",
      coverageScore: "number 0-1",
      stopReason: "complete|max_rounds|no_progress|analysis_incomplete|null",
    },
  });
  return normalizeManagerReview(value, new Set(plan.nodes.map((node) => node.id)), new Set(prepared.outline.map((section) => section.id)));
}

/**
 * Picks the most informative blocks for an event (8-K/6-K) summary.
 * The filing body is mostly regulatory boilerplate, so: drop boilerplate blocks, prefer exhibit
 * blocks (where the actual disclosure lives), and rank each group by numeric density with
 * table-like blocks boosted. Falls back to the original order when filtering leaves too little.
 */
export function selectEventBlocks(blocks: FilingBlock[], limit = 12): FilingBlock[] {
  const usable = blocks.filter((block) => !isEventBoilerplateBlock(block));
  if (usable.length < 3) return blocks.slice(0, limit);
  const exhibits = usable.filter((block) => block.source === "exhibit");
  const body = usable.filter((block) => block.source !== "exhibit");
  const score = (block: FilingBlock) => block.numericDensity + (block.elementType === "table_like" ? 50 : 0);
  const rank = (list: FilingBlock[]) => [...list].sort((left, right) => score(right) - score(left));
  return [...rank(exhibits), ...rank(body)].slice(0, limit);
}

const EVENT_BOILERPLATE_PATTERN = /(?:united states securities and exchange commission|commission file number|irs employer|state of incorporation|exact name of registrant|address of principal|date of report|power of attorney|\/s\/|telephone)/i;

function isEventBoilerplateBlock(block: FilingBlock): boolean {
  const sample = `${block.heading}\n${block.body}`.slice(0, 600);
  if (EVENT_BOILERPLATE_PATTERN.test(sample)) return true;
  // Very short blocks with no numbers are almost always envelope noise (addresses, checkboxes).
  return block.body.length <= 160 && block.numericDensity < 20;
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
    sections: selectEventBlocks(prepared.blocks, 12).map((block) => ({
      heading: block.heading,
      source: block.exhibitType ?? "filing body",
      text: block.body.slice(0, 2_400),
    })),
    outputSchema: {
      headline: "string",
      bullets: "[{label, detail, importance}]",
      analystView: "string",
      eventCategory: "earnings_update|guidance|m&a|executive|legal|other",
      report: "string",
    },
  });
  const summary = normalizeSecSummary({ ...value, source: "deepseek", version: SEC_SUMMARY_VERSION }, prepared.filing, now);
  if (!summary.headline || !summary.bullets.length || !summary.analystView || !summary.eventCategory) {
    throw new Error("Event summary returned incomplete analysis");
  }
  if (hasOnlyEventMetadataBullets(summary.bullets)) {
    throw new Error("Event summary contained only filing metadata");
  }
  return summary;
}

export async function summarizePreparedSecFiling(
  prepared: PreparedSecFilingMeta,
  context: SecAnalysisContext,
  model: SecModelCall,
  now = new Date(),
  plan?: SecNodePlan,
  nodes: SecNodeResult[] = [],
  brief?: SecAnalysisBrief,
  review?: ManagerReview,
): Promise<{ artifact: SecAnalysisArtifact; summary: SecFilingSummary }> {
  const usableNodes = nodes.filter((node) => node.status === "complete" && (node.narrative || node.findings.length));
  if (!plan?.nodes.length || !usableNodes.length) throw new Error("Manager produced no usable analysis nodes");
  const finalBrief = brief ?? buildPreparedSecBrief(prepared, context);
  const nodeFacts = nodes.flatMap((node) => node.facts ?? []);
  const qoq = comparisonFromBrief("qoq", finalBrief, context.qoqPeriodId);
  const yoy = comparisonFromBrief("yoy", finalBrief, context.yoyPeriodId);
  const finalReview = review ?? {
    status: "complete" as const,
    questions: plan.nodes.map((node) => ({ questionId: node.id, status: "answered" as const, explanation: "Completed before v3 review injection" })),
    repairTasks: [], unresolvedQuestions: [], coverageScore: 1, stopReason: "complete" as const,
  };
  const validEvidenceIds = [...new Set([
    ...prepared.blockIds,
    ...finalBrief.currentFacts.flatMap((fact) => fact.evidenceIds),
  ])].sort();
  const summaryPayload = {
    brief: briefForAnalysis(finalBrief),
    nodeAnalyses: usableNodes.map(({ id, title, findings, narrative, facts }) => ({ id, title, findings, narrative, facts: facts ?? [] })),
    managerReview: finalReview,
    allowedMetricKeys: [...new Set([...finalBrief.allowedMetricKeys, ...nodeFacts.map((fact) => fact.metricKey)])],
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
  }, new Set(validEvidenceIds));
  report = enforceDeterministicReportQuality(report, finalBrief, nodeFacts);
  report = addDeterministicDeltas(report, qoq, yoy);
  report = {
    ...report,
    dataQuality: {
      ...report.dataQuality,
      warnings: [...new Set([...report.dataQuality.warnings, ...(plan.warnings ?? [])])].slice(0, 20),
      analysisStatus: finalReview.status === "complete" ? "complete" : "partial",
      unresolvedQuestions: finalReview.unresolvedQuestions,
      failedNodeIds: nodes.filter((node) => node.status !== "complete").map((node) => node.id),
      stopReason: finalReview.stopReason,
      managerCoverageScore: finalReview.coverageScore,
    },
  };
  const artifact: SecAnalysisArtifact = {
    filing: prepared.filing,
    periodId: prepared.periodId,
    periodScope: prepared.periodScope,
    blocks: [],
    comparisons: [qoq, yoy].filter((comparison): comparison is ComparisonResult => Boolean(comparison)),
    report,
    brief: finalBrief,
    managerReview: finalReview,
    validEvidenceIds,
  };
  const normalizedSummary = normalizeSecSummary({ ...summaryValue, source: "deepseek", version: SEC_SUMMARY_VERSION }, prepared.filing, now);
  if (!normalizedSummary.report) {
    throw new Error("Synthesis must contain a report");
  }
  if (normalizedSummary.bullets.length < 3 || normalizedSummary.bullets.length > 5 || !normalizedSummary.analystView) {
    throw new Error("Synthesis must contain 3–5 core conclusions and an investment view");
  }
  const summary = {
    ...normalizedSummary,
    report: appendAnalysisLimitations(normalizedSummary.report, finalReview, nodes),
    nodes,
    plan,
    managerReview: finalReview,
  };
  return { artifact, summary };
}

function appendAnalysisLimitations(report: string | undefined, review: ManagerReview, nodes: SecNodeResult[]): string | undefined {
  if (!report || review.status === "complete") return report;
  const failedNodeIds = nodes.filter((node) => node.status !== "complete").map((node) => node.id);
  const suffix = [
    "分析完整性说明",
    `停止原因：${review.stopReason ?? "analysis_incomplete"}`,
    `未解决问题：${review.unresolvedQuestions.length ? review.unresolvedQuestions.join("；") : "无额外披露"}`,
    `失败节点：${failedNodeIds.length ? failedNodeIds.join("、") : "无"}`,
  ].join("\n");
  return `${report.slice(0, Math.max(900, 1_600 - suffix.length - 2))}\n\n${suffix}`;
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

function managerSystemPrompt() {
  return [
    "你是负责美股财报研究的主编，正在为一份 SEC filing 编排分析任务。",
    "输入包含已核验的 XBRL 本期事实、历史序列、预计算的同比环比、缺失序列和章节标题，不含 filing 正文。",
    "只选择能改变投资判断的实质主题，通常输出 6 至 12 个节点；结构很短时可以更少，不要按 Item 顺序逐项复述。",
    "优先覆盖经营驱动、分部与 KPI、利润率与成本、现金流与资本投入、资本配置、管理层展望和重大风险，但只在标题清单确有对应章节时选择。",
    "并购、减值、重大诉讼、分部重组、会计政策变更等特殊事项应独立成节点。",
    "排除仅为 Not applicable、None、引用代理声明或例行合规的章节；未解决员工评论、矿山安全、物业、展品、签名、会计师变更、内部控制、外国司法辖区、10-K 摘要等，除非标题本身表明发生重大变化。",
    "每个节点只能使用清单内的 sectionIds，至少绑定一个章节，不要让两个节点承担同一问题。",
    "title 和 question 使用简体中文；id 使用小写英文短横线 slug；keywords 使用英文原文术语。",
    "每个节点必须指定 historySeriesIds、acceptanceCriteria 和 materiality。",
    "输出 JSON：{\"nodes\":[{\"id\":\"\",\"title\":\"\",\"question\":\"\",\"sectionIds\":[\"\"],\"keywords\":[\"\"],\"historySeriesIds\":[\"revenue\"],\"acceptanceCriteria\":[\"\"],\"materiality\":\"high|medium|low\"}]}",
  ].join("\n");
}

function managerReviewSystemPrompt() {
  return [
    "你是财报研究主编，负责判断每个计划问题是否被事实和节点分析回答。",
    "answered 表示结论、证据和期间口径均完整；not_disclosed 只用于 filing 明确未披露；不要把节点有文字等同于回答完整。",
    "只有 partial 或 unanswered 可以生成 repairTasks；repair 必须绑定原 questionId、targetNodeId、已有 sectionIds 和缺失证据。",
    "最多返回 3 个 repairTasks，按 materiality 从高到低排列，只有一轮修复机会。不要创建新主题。",
    "严格按 outputSchema 返回 JSON。",
  ].join("\n");
}

function nodeSystemPrompt() {
  return [
    "你是美股基本面研究团队的分段分析师，只处理主编交给你的一个任务。",
    "只使用给定的英文 SEC 原文章节，不引入外部信息，不编造数字。",
    "xbrlFacts 是已核验的本期 XBRL 数值，直接引用即可，不要从正文重新抠这些数字，也不要与之矛盾。",
    "回答 question；数字必须带口径和比较期间，并说明变化方向及驱动原因。",
    "原文无法回答时将 narrative 留空，不要输出空泛措辞。",
    "findings 输出 2 至 6 条具体事实；有实质内容时 narrative 输出 300 至 700 字简体中文，可用空行分段，不要使用 Markdown；无实质内容就留空，留空不扣分。",
    "facts 只收录 xbrlFacts 之外、正文明确披露的结构化数值：分部收入与利润率、管理层 KPI、指引数字、一次性项目。",
    "metricKey 优先使用 allowedMetricKeys 中的值；属于管理层自定义 KPI 时使用 business_kpi 并在 definition 写出该 KPI 的原文定义。",
    "每条 fact 必须给出 unit、basis 和至少一个来自 evidence 清单的 evidenceId；无法引用证据的数值直接省略。",
    "输出 JSON：{\"findings\":[{\"label\":\"\",\"detail\":\"\",\"importance\":\"high|medium|low\"}],\"narrative\":\"\",\"facts\":[{\"metricKey\":\"\",\"definition\":\"\",\"value\":\"\",\"unit\":\"\",\"currency\":\"\",\"periodScope\":\"\",\"basis\":\"gaap|non_gaap|management_kpi|derived\",\"sourceLabel\":\"fact_source_reported|management_adjusted|derived_calculation\",\"confidence\":\"high|medium|low\",\"evidenceIds\":[\"\"]}]}",
  ].join("\n");
}

function eventSummarySystemPrompt() {
  return [
    "你是负责美股基本面研究的资深金融分析师，只处理 8-K 或 6-K 事件简析。",
    "输入的 sections 来自 filing 主体与附件（EX-99.x 等），source 字段标注了出处。附件才是事件的实际披露内容；主体只有监管元信息。",
    "headline 和 bullets 必须基于附件披露的实质内容：业绩数字、指引、并购条款、人事变动、法律进展等。",
    "严禁把以下元信息写进 headline 或 bullets：签署人、办公地址、Commission File Number、IRS Employer ID、Item 编号、文件形式、报告日期。",
    "eventCategory 必须从以下选项中选择最贴切的一项：earnings_update（业绩与财务结果）、guidance（业绩指引）、m&a（并购、资产处置、合资）、executive（高管与董事变动）、legal（诉讼、监管、和解）、other。",
    "report 用 300 至 600 字简体中文连贯输出附件的核心披露内容：关键数字及其口径与比较期间、主要驱动因素、已披露的影响与后续安排；按投资者阅读逻辑分段，不使用 Markdown。",
    "数字必须带口径和比较期间（同比/环比/绝对值），只使用原文已有的数值，不编造、不推算。",
    "附件中没有具体数字时，如实描述事件性质和已披露的定性信息，不要复述表单结构或监管样板。",
    "说明事件本身、发生原因，以及对盈利、现金流或资产负债表的具体影响；没有证据的维度直接省略。",
    "headline 是一句有方向性的结论；bullets 输出 3 至 5 条具体事实；analystView 说明投资含义但不给买卖建议。",
    "以 JSON 对象输出 headline、bullets、analystView、eventCategory 和 report，字段严格遵循 outputSchema。",
  ].join("\n");
}

function synthesisSystemPrompt() {
  return [
    "你是美股基本面研究团队的总编。输入只有最终 SecAnalysisBrief、完成节点和 Manager Review，不含 filing 原文。",
    "brief.currentFacts 与 brief.comparisons 来自 SEC XBRL，是本期数字和同比环比的唯一权威来源；节点的 facts 用于补充分部、KPI 与指引。",
    "keyMetrics 的 metricKey 必须来自 allowedMetricKeys，超出列表的指标会被丢弃。",
    "完整研报的章节逻辑必须来自 nodeAnalyses，不要重新套用固定主题模板。",
    "数字、同比、环比和证据只能使用结构化输入中已有的值；不得编造或把 qoq 与 yoy 混写。",
    "report 输出 900 至 1,600 字简体中文正文，按投资者阅读逻辑用空行分段，不要使用 Markdown 标题或项目符号。",
    "headline 给出有方向性的结论；bullets 输出 3 至 5 条核心结论；analystView 说明投资含义但不给买卖建议。",
    "Manager Review 为 partial 时，report 必须明确列出未解决问题、失败节点和 stop reason。",
    "以 JSON 对象输出 headline、bullets、analystView、report、keyMetrics、changes 和 dataQuality，字段严格遵循 outputSchema。",
  ].join("\n");
}

function comparisonFromBrief(
  comparisonType: "qoq" | "yoy",
  brief: SecAnalysisBrief,
  knownPriorPeriodId: string | null,
): ComparisonResult | null {
  const entries = brief.comparisons.filter((comparison) => comparison.comparisonType === comparisonType);
  const priorPeriodId = knownPriorPeriodId ?? priorPeriodIdFromEntries(brief, entries);
  if (!priorPeriodId) return null;
  return {
    comparisonType,
    currentPeriodId: brief.periodId,
    priorPeriodId,
    comparability: entries.length ? "full" : "not_comparable",
    metricDeltas: entries.map((entry) => ({
      metricKey: entry.seriesId,
      currentValue: entry.currentValue,
      priorValue: entry.priorValue,
      percentageDelta: entry.percentageDelta,
      comparable: true,
      reason: undefined,
    })),
    narrativeDeltas: [],
  };
}

function priorPeriodIdFromEntries(brief: SecAnalysisBrief, entries: SecAnalysisBrief["comparisons"]): string | null {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.priorEndDate, (counts.get(entry.priorEndDate) ?? 0) + 1);
  const [priorEndDate] = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]))[0] ?? [];
  return priorEndDate ? `${brief.ticker}:${priorEndDate}:${brief.periodScope}` : null;
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

function enforceDeterministicReportQuality(
  report: SecAnalysisArtifact["report"],
  brief: SecAnalysisBrief,
  nodeFacts: AnalysisFact[],
): SecAnalysisArtifact["report"] {
  const allowed = new Set<string>();
  for (const fact of [...brief.currentFacts, ...nodeFacts]) {
    allowed.add(fact.metricKey);
    const canonical = canonicalMetricKey(fact.metricKey);
    if (canonical) allowed.add(canonical);
  }
  const keyMetrics: SecAnalysisArtifact["report"]["keyMetrics"] = [];
  const dropped: string[] = [];
  for (const metric of report.keyMetrics) {
    const canonical = canonicalMetricKey(metric.metricKey);
    if (allowed.has(metric.metricKey)) keyMetrics.push(metric);
    else if (canonical && allowed.has(canonical)) keyMetrics.push({ ...metric, metricKey: canonical });
    else dropped.push(metric.metricKey);
  }
  const coverage = brief.allowedMetricKeys.length
    ? brief.currentFacts.length / brief.allowedMetricKeys.length
    : 0;
  const verificationStatus = keyMetrics.length >= 2 && brief.currentFacts.length >= 3
    ? "verified"
    : allowed.size
      ? "partial"
      : "failed";
  const warnings = [...report.dataQuality.warnings];
  if (verificationStatus === "failed") warnings.push("No evidence-grounded financial metrics passed deterministic verification");
  else if (verificationStatus === "partial") warnings.push("Verified evidence coverage is below the full-report threshold");
  if (dropped.length) warnings.push(`Dropped unverifiable keyMetrics: ${[...new Set(dropped)].join(", ")}`);
  if (brief.missingSeriesIds.length) warnings.push(`XBRL has no current-period value for: ${brief.missingSeriesIds.join(", ")}`);
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
