import {
  cleanSecTicker,
  htmlToSecText,
  isSummaryRetryDue,
  normalizeSecSummary,
  parseSecSubmissions,
  sortSecFilings,
  type SecCompany,
  type SecFiling,
  type SecFilingFeed,
  type SecFilingSummary,
} from "./sec.ts";
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
  type MemoryCandidate,
  type PriorSnapshotContext,
  type PublishedSecReport,
  type RouterResult,
  type SecAnalysisModuleKey,
  type SnapshotSummary,
} from "./sec-analysis.ts";

const TICKER_MAP_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const FILING_TEXT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const SEC_FETCH_INTERVAL_MS = 200;
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export type SecCacheRecord<T> = {
  payload: T;
  fetchedAt: string;
};

export type SecRepository = {
  getCache<T>(key: string): Promise<SecCacheRecord<T> | null>;
  setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void>;
  getSummary(ticker: string, accessionNumber: string): Promise<SecFilingSummary | null>;
  setSummary(summary: SecFilingSummary): Promise<void>;
  getPublishedReport?(ticker: string, periodId: string): Promise<PublishedSecReport | null>;
  getAnalysisContext?(filing: SecFiling): Promise<SecAnalysisContext>;
  saveAnalysis?(artifact: SecAnalysisArtifact): Promise<void>;
};

export type SecServiceRuntime = {
  apiKey: string;
  model: string;
  userAgent: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
};

type StoredSecFeed = Omit<SecFilingFeed, "filings"> & {
  filings: SecFiling[];
};

export type SecAnalysisContext = {
  currentPeriodId: string;
  qoqPeriodId: string | null;
  yoyPeriodId: string | null;
  qoq: Partial<Record<SecAnalysisModuleKey, PriorSnapshotContext>>;
  yoy: Partial<Record<SecAnalysisModuleKey, PriorSnapshotContext>>;
  activeMemory: PriorSnapshotContext["activeMemory"];
};

export type SecAnalysisArtifact = {
  filing: SecFiling;
  periodId: string;
  periodScope: "quarter" | "annual";
  blocks: FilingBlock[];
  moduleAnalyses: ModuleAnalysis[];
  snapshots: SnapshotSummary[];
  comparisons: ComparisonResult[];
  memoryCandidates: MemoryCandidate[];
  report: PublishedSecReport;
  router: RouterResult;
};

export async function getCachedSecFeed(repository: SecRepository, rawTicker: string): Promise<SecFilingFeed> {
  const ticker = cleanSecTicker(rawTicker);
  const cached = await repository.getCache<StoredSecFeed>(filingCacheKey(ticker));
  if (!cached) return { ticker, company: null, filings: [], fetchedAt: null, status: "pending" };
  const filings: SecFilingFeed["filings"] = [];
  const structuredPeriods = new Set<string>();
  for (const filing of sortSecFilings(cached.payload.filings)) {
    const periodId = buildPeriodIdentity(ticker, filing.form, filing.reportDate).periodId;
    const periodic = /^(10-Q|10-K|20-F)(\/A)?$/.test(filing.form);
    const attachStructuredReport = periodic && !structuredPeriods.has(periodId);
    if (periodic) structuredPeriods.add(periodId);
    filings.push({
      ...filing,
      summary: await repository.getSummary(ticker, filing.accessionNumber),
      analysis: attachStructuredReport && repository.getPublishedReport
        ? await repository.getPublishedReport(ticker, periodId).catch(() => null)
        : null,
    });
  }
  return { ...cached.payload, filings };
}

export async function refreshSecTicker(
  repository: SecRepository,
  rawTicker: string,
  runtime: SecServiceRuntime,
): Promise<SecFilingFeed> {
  const ticker = cleanSecTicker(rawTicker);
  const now = (runtime.now ?? (() => new Date()))();
  const fetcher = runtime.fetcher ?? fetch;
  const wait = runtime.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastSecRequestAt = 0;
  const secRequest = async (url: string, accept = "application/json") => {
    const elapsed = Date.now() - lastSecRequestAt;
    if (lastSecRequestAt && elapsed < SEC_FETCH_INTERVAL_MS) await wait(SEC_FETCH_INTERVAL_MS - elapsed);
    const response = await fetcher(url, {
      cache: "no-store",
      headers: { accept, "user-agent": runtime.userAgent },
      signal: AbortSignal.timeout(15_000),
    });
    lastSecRequestAt = Date.now();
    if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
    return response;
  };

  try {
    const company = await getCompany(repository, ticker, now, secRequest);
    if (!company) {
      const unsupported: StoredSecFeed = {
        ticker,
        company: null,
        filings: [],
        fetchedAt: now.toISOString(),
        status: "unsupported",
      };
      await repository.setCache(filingCacheKey(ticker), unsupported, now.toISOString());
      return { ...unsupported, filings: [] };
    }

    const submissionsResponse = await secRequest(`https://data.sec.gov/submissions/CIK${company.cik}.json`);
    const allFilings = parseSecSubmissions(await submissionsResponse.json(), company, 40);
    const filings = allFilings.slice(0, 5);
    const stored: StoredSecFeed = {
      ticker,
      company: { ticker, cik: company.cik, name: filings[0]?.companyName ?? company.name },
      filings,
      fetchedAt: now.toISOString(),
      status: filings.length ? "ready" : "empty",
    };
    await repository.setCache(filingCacheKey(ticker), stored, now.toISOString());

    for (const filing of selectAnalysisFilings(allFilings)) {
      if (repository.getAnalysisContext && repository.saveAnalysis && runtime.apiKey) {
        const analysis = await analyzeFiling(repository, filing, runtime, now, secRequest);
        if (analysis) {
          await repository.setSummary(toLegacySummary(analysis.report, filing, now));
          continue;
        }
      }
      const cachedSummary = await repository.getSummary(ticker, filing.accessionNumber);
      if (cachedSummary && !isSummaryRetryDue(cachedSummary, now.getTime())) continue;
      const summary = await summarizeFiling(repository, filing, runtime, now, secRequest);
      await repository.setSummary(summary);
    }

    return getCachedSecFeed(repository, ticker);
  } catch {
    const previous = await getCachedSecFeed(repository, ticker);
    if (previous.status !== "pending") {
      return {
        ...previous,
        status: "stale",
        error: "SEC 数据暂时无法更新，当前显示上次成功结果。",
      };
    }
    throw new Error("SEC 数据暂时无法更新。");
  }
}

function selectAnalysisFilings(filings: SecFiling[]): SecFiling[] {
  const primary = filings.filter((filing) => /^(10-Q|10-K|20-F)(\/A)?$/.test(filing.form));
  const primaryDates = new Set(primary.map((filing) => filing.reportDate));
  const supporting = filings.filter((filing) => /^(8-K|6-K)(\/A)?$/.test(filing.form) && primaryDates.has(filing.reportDate));
  return [...primary.slice(0, 12), ...supporting.slice(0, 12)].filter((filing, index, all) => all.findIndex((item) => item.accessionNumber === filing.accessionNumber) === index);
}

async function analyzeFiling(
  repository: SecRepository,
  filing: SecFiling,
  runtime: SecServiceRuntime,
  now: Date,
  secRequest: (url: string, accept?: string) => Promise<Response>,
): Promise<SecAnalysisArtifact | null> {
  if (!repository.getAnalysisContext || !repository.saveAnalysis) return null;
  try {
    const document = await getFilingDocument(repository, filing, now, secRequest);
    const blocks = buildFilingBlocks(document.text, filing.accessionNumber);
    const { periodId, periodScope } = buildPeriodIdentity(filing.ticker, filing.form, filing.reportDate);
    const context = await repository.getAnalysisContext(filing);
    const priorModules = [
      ...Object.entries(context.qoq).map(([moduleKey, prior]) => prior ? { moduleKey: moduleKey as SecAnalysisModuleKey, periodId: prior.periodId } : null),
      ...Object.entries(context.yoy).map(([moduleKey, prior]) => prior ? { moduleKey: moduleKey as SecAnalysisModuleKey, periodId: prior.periodId } : null),
    ].filter((item): item is { moduleKey: SecAnalysisModuleKey; periodId: string } => Boolean(item));

    let router: RouterResult;
    try {
      const routerValue = await callSecModel(runtime, routerSystemPrompt(), buildRouterPayload(filing, blocks, priorModules));
      router = normalizeRouterResult(routerValue, blocks);
      if (!router.selections.length) router = fallbackRouterResult(blocks);
    } catch {
      router = fallbackRouterResult(blocks);
    }

    const evidenceIds = new Set(blocks.map((block) => `ev:${block.blockId}`));
    const moduleAnalyses = await Promise.all(SEC_ANALYSIS_MODULES.map(async (module): Promise<ModuleAnalysis> => {
      const selection = router.selections.find((item) => item.moduleKey === module.key);
      const selectedIds = new Set(selection?.blockIds ?? []);
      const currentBlocks = blocks.filter((block) => selectedIds.has(block.blockId)).slice(0, 8);
      if (!currentBlocks.length) {
        return { moduleKey: module.key, facts: [], claims: [], memoryCandidates: [], missingFields: [...module.fields], evidenceCoverage: 0, verificationStatus: "failed" };
      }
      const priorQoq = context.qoq[module.key];
      const priorYoy = context.yoy[module.key];
      const payload = buildModulePayload({
        moduleKey: module.key,
        filing,
        currentBlocks,
        currentFacts: [],
        qoq: priorQoq,
        yoy: priorYoy,
        activeMemory: context.activeMemory,
        precomputedDeltas: [],
      });
      try {
        const value = await callSecModel(runtime, moduleSystemPrompt(module.key), payload);
        return normalizeModuleAnalysis(value, module.key, evidenceIds);
      } catch {
        return { moduleKey: module.key, facts: [], claims: [], memoryCandidates: [], missingFields: [...module.fields], evidenceCoverage: 0, verificationStatus: "failed" };
      }
    }));

    const snapshots = moduleAnalyses.map((analysis): SnapshotSummary => ({
      ticker: filing.ticker,
      periodId,
      filingId: filing.accessionNumber,
      moduleKey: analysis.moduleKey,
      facts: analysis.facts,
      claims: analysis.claims,
      memoryCandidates: analysis.memoryCandidates,
      missingFields: analysis.missingFields,
      evidenceCoverage: analysis.evidenceCoverage,
      verificationStatus: analysis.verificationStatus,
    }));
    const qoqResults = snapshots.flatMap((snapshot) => {
      const prior = context.qoq[snapshot.moduleKey];
      return prior ? [compareSnapshots("qoq", snapshot, prior)] : [];
    });
    const yoyResults = snapshots.flatMap((snapshot) => {
      const prior = context.yoy[snapshot.moduleKey];
      return prior ? [compareSnapshots("yoy", snapshot, prior)] : [];
    });
    const qoq = mergeComparisons("qoq", qoqResults, periodId, context.qoqPeriodId);
    const yoy = mergeComparisons("yoy", yoyResults, periodId, context.yoyPeriodId);
    const summaryPayload = buildSummaryPayload({ ticker: filing.ticker, periodId, moduleSnapshots: snapshots, qoq, yoy });
    const fallbackReport = fallbackPublishedReport(filing.ticker, periodId, snapshots, qoq, yoy);
    let report = fallbackReport;
    try {
      const summaryValue = await callSecModel(runtime, structuredSummarySystemPrompt(), summaryPayload);
      report = normalizePublishedReport(summaryValue, {
        ticker: filing.ticker,
        periodId,
        reportVersion: `${SEC_ANALYSIS_SCHEMA_VERSION}:${hashPayload(summaryPayload)}`,
      }, new Set(blocks.map((block) => `ev:${block.blockId}`)));
    } catch {
      report = fallbackReport;
    }
    report = addDeterministicDeltas(report, qoq, yoy);
    const artifact: SecAnalysisArtifact = {
      filing,
      periodId,
      periodScope,
      blocks,
      moduleAnalyses,
      snapshots,
      comparisons: [...qoqResults, ...yoyResults],
      memoryCandidates: moduleAnalyses.flatMap((analysis) => analysis.memoryCandidates),
      report,
      router,
    };
    await repository.saveAnalysis(artifact);
    return artifact;
  } catch {
    return null;
  }
}

function routerSystemPrompt(): string {
  return [
    "You are a filing section router.",
    "Select relevant blocks based on the data needs, not exact heading names.",
    "Only return block IDs present in the supplied inventory. Do not extract facts yet.",
    "Return JSON: {\"selections\":[{\"moduleKey\":\"\",\"blockIds\":[],\"expectedFields\":[],\"priority\":\"high|medium|low\",\"needFullText\":true,\"confidence\":0.0}]}.",
  ].join("\n");
}

function moduleSystemPrompt(moduleKey: SecAnalysisModuleKey): string {
  return [
    "You are a financial filing module analyst.",
    `Module: ${moduleKey}.`,
    "Use only the supplied evidence. Preserve GAAP, non-GAAP, management KPI, units, periods, and definitions.",
    "Every fact and claim must cite one or more evidence IDs.",
    "Return JSON with facts, claims, memoryCandidates, missingFields, and evidenceCoverage.",
  ].join("\n");
}

function structuredSummarySystemPrompt(): string {
  return [
    "You are the final filing summary composer.",
    "Use only verified module snapshots and deterministic comparison results.",
    "Do not invent numbers, evidence, or changes. Keep qoq and yoy separate.",
    "Return JSON with headline, keyMetrics, changes, and dataQuality.",
  ].join("\n");
}

export async function callSecModel(runtime: SecServiceRuntime, system: string, payload: unknown): Promise<Record<string, unknown>> {
  if (!runtime.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  const response = await (runtime.fetcher ?? fetch)(DEEPSEEK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${runtime.apiKey}` },
    body: JSON.stringify({
      model: runtime.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
  const data = asRecord(await response.json());
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  const message = asRecord(asRecord(choices[0])?.message);
  if (typeof message?.content !== "string" || !message.content) throw new Error("DeepSeek returned empty content");
  return parseJsonObject(message.content);
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

function fallbackPublishedReport(
  ticker: string,
  periodId: string,
  snapshots: SnapshotSummary[],
  qoq: ComparisonResult | null,
  yoy: ComparisonResult | null,
): PublishedSecReport {
  const facts = snapshots.flatMap((snapshot) => snapshot.facts).slice(0, 12);
  const coverage = snapshots.length ? snapshots.reduce((sum, snapshot) => sum + snapshot.evidenceCoverage, 0) / snapshots.length : 0;
  return {
    ticker,
    periodId,
    reportVersion: `${SEC_ANALYSIS_SCHEMA_VERSION}:${hashPayload({ snapshots, qoq, yoy })}`,
    headline: coverage >= 0.9 ? "财报结构化分析已完成" : "财报已解析，部分模块仍需补充证据",
    keyMetrics: facts.map((fact) => ({ metricKey: fact.metricKey, currentValue: fact.value, qoq: undefined, yoy: undefined, status: fact.sourceLabel === "derived_calculation" ? "derived" : "verified", evidenceIds: fact.evidenceIds })),
    changes: { qoq: qoq?.narrativeDeltas ?? [], yoy: yoy?.narrativeDeltas ?? [], guidance: snapshots.flatMap((snapshot) => snapshot.claims.filter((claim) => claim.claimType === "guidance")), risks: snapshots.flatMap((snapshot) => snapshot.claims.filter((claim) => claim.claimType === "risk")) },
    dataQuality: { coverage, verificationStatus: coverage >= 0.9 ? "verified" : coverage > 0 ? "partial" : "failed", warnings: coverage >= 0.9 ? [] : ["部分模块没有得到足够的原文证据"] },
  };
}

function hashPayload(value: unknown): string {
  return hashString(JSON.stringify(value));
}

function addDeterministicDeltas(report: PublishedSecReport, qoq: ComparisonResult | null, yoy: ComparisonResult | null): PublishedSecReport {
  const deltaValue = (comparison: ComparisonResult | null, metricKey: string) => {
    const delta = comparison?.metricDeltas.find((item) => item.metricKey === metricKey)?.percentageDelta;
    if (delta === undefined) return undefined;
    const number = Number(delta);
    return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${(number * 100).toFixed(1)}%` : undefined;
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

function toLegacySummary(report: PublishedSecReport, filing: SecFiling, now: Date): SecFilingSummary {
  const bullets = report.keyMetrics.slice(0, 5).map((metric) => ({
    label: metric.metricKey.slice(0, 24),
    detail: `${metric.currentValue}${metric.yoy ? `，同比 ${metric.yoy}` : ""}${metric.qoq ? `，环比 ${metric.qoq}` : ""}`,
    importance: metric.status === "verified" ? "high" as const : "medium" as const,
  }));
  return {
    ticker: filing.ticker,
    form: filing.form,
    filingDate: filing.filingDate,
    accessionNumber: filing.accessionNumber,
    headline: report.headline,
    bullets,
    analystView: report.dataQuality.warnings.join("；"),
    source: "deepseek",
    generatedAt: now.toISOString(),
  };
}

async function getCompany(
  repository: SecRepository,
  ticker: string,
  now: Date,
  secRequest: (url: string, accept?: string) => Promise<Response>,
): Promise<SecCompany | null> {
  const cacheKey = "sec:ticker-map";
  const cached = await repository.getCache<Record<string, SecCompany>>(cacheKey);
  let tickerMap = cached && isFresh(cached.fetchedAt, TICKER_MAP_TTL_MS, now.getTime()) ? cached.payload : null;
  if (!tickerMap) {
    const response = await secRequest("https://www.sec.gov/files/company_tickers_exchange.json");
    tickerMap = parseTickerMap(await response.json());
    await repository.setCache(cacheKey, tickerMap, now.toISOString());
  }
  return tickerMap[ticker] ?? null;
}

function parseTickerMap(payload: unknown): Record<string, SecCompany> {
  const root = asRecord(payload);
  const fields = Array.isArray(root?.fields) ? root.fields.map(String) : [];
  const data = Array.isArray(root?.data) ? root.data : [];
  const tickerIndex = fields.indexOf("ticker");
  const cikIndex = fields.indexOf("cik");
  const nameIndex = fields.indexOf("name");
  const result: Record<string, SecCompany> = {};
  for (const value of data) {
    if (!Array.isArray(value)) continue;
    const ticker = cleanSecTicker(String(value[tickerIndex] ?? ""));
    const cikNumber = Number(value[cikIndex]);
    if (!ticker || !Number.isFinite(cikNumber)) continue;
    result[ticker] = {
      ticker,
      cik: String(cikNumber).padStart(10, "0"),
      cikNumber,
      name: String(value[nameIndex] ?? ""),
    };
  }
  return result;
}

async function summarizeFiling(
  repository: SecRepository,
  filing: SecFiling,
  runtime: SecServiceRuntime,
  now: Date,
  secRequest: (url: string, accept?: string) => Promise<Response>,
): Promise<SecFilingSummary> {
  try {
    if (!runtime.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
    const text = await getFilingText(repository, filing, now, secRequest);
    const sections = splitFilingSections(text);
    const response = await (runtime.fetcher ?? fetch)(DEEPSEEK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${runtime.apiKey}` },
      body: JSON.stringify({
        model: runtime.model,
        messages: [
          { role: "system", content: summarySystemPrompt(filing.form) },
          {
            role: "user",
            content: JSON.stringify({
              ticker: filing.ticker,
              form: filing.form,
              filingDate: filing.filingDate,
              reportDate: filing.reportDate,
              accessionNumber: filing.accessionNumber,
              sections,
            }),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const data = asRecord(await response.json());
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice?.message);
    if (typeof message?.content !== "string" || !message.content) throw new Error("DeepSeek returned empty content");
    return normalizeSecSummary({ ...parseJsonObject(message.content), source: "deepseek" }, filing, now);
  } catch (error) {
    return normalizeSecSummary({
      source: "error",
      error: error instanceof Error ? error.message : "summary failed",
    }, filing, now);
  }
}

async function getFilingText(
  repository: SecRepository,
  filing: SecFiling,
  now: Date,
  secRequest: (url: string, accept?: string) => Promise<Response>,
): Promise<string> {
  return (await getFilingDocument(repository, filing, now, secRequest)).text;
}

async function getFilingDocument(
  repository: SecRepository,
  filing: SecFiling,
  now: Date,
  secRequest: (url: string, accept?: string) => Promise<Response>,
): Promise<{ html: string; text: string }> {
  const cacheKey = `sec:text:${filing.ticker}:${filing.accessionNumber}`;
  const cached = await repository.getCache<{ html?: string; text: string }>(cacheKey);
  if (cached && isFresh(cached.fetchedAt, FILING_TEXT_TTL_MS, now.getTime()) && cached.payload.text) {
    return { html: cached.payload.html ?? "", text: cached.payload.text };
  }
  const response = await secRequest(filing.documentUrl, "text/html,application/xhtml+xml,text/plain,*/*");
  const html = await response.text();
  const text = htmlToSecText(html);
  if (!text) throw new Error("SEC filing document did not contain readable text");
  // Avoid the old fixed-prefix truncation. Large filings are persisted as blocks by
  // the structured pipeline; the compatibility cache only keeps reasonably sized text.
  if (text.length <= 750_000) {
    await repository.setCache(cacheKey, { html: html.length <= 750_000 ? html : "", text }, now.toISOString());
  }
  return { html, text };
}

function splitFilingSections(text: string): Array<{ name: string; text: string }> {
  const definitions: Array<[string, RegExp]> = [
    ["businessUpdate", /business update|overview|recent developments/i],
    ["revenueDrivers", /revenue|sales/i],
    ["margins", /gross margin|operating income|margin/i],
    ["liquidity", /liquidity|cash flow|working capital/i],
    ["guidance", /guidance|outlook|forecast|expect/i],
    ["riskFactors", /risk factors/i],
    ["subsequentEvents", /subsequent events/i],
  ];
  const buckets = Object.fromEntries(definitions.map(([name]) => [name, [] as string[]]));
  let current = "businessUpdate";
  for (const line of text.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const match = definitions.find(([, pattern]) => pattern.test(line));
    if (match) current = match[0];
    if (buckets[current].join(" ").length < 4_500) buckets[current].push(line);
  }
  return definitions.flatMap(([name]) => {
    const content = buckets[name].join("\n").slice(0, 4_500);
    return content ? [{ name, text: content }] : [];
  });
}

function summarySystemPrompt(form: string): string {
  const focus = form.startsWith("8-K") || form.startsWith("6-K")
    ? "说明事件本身、发生原因，以及对盈利、现金流或资产负债表的具体影响。"
    : "说明收入与增长驱动、利润率、现金流、资本开支、管理层指引和关键风险的变化。";
  return [
    "你是负责美股基本面研究的资深金融分析师。",
    "只根据给定 SEC filing 内容输出简体中文，不使用外部信息，不编造数字。",
    focus,
    "没有证据的维度直接省略。禁止输出需要复核、未找到、建议关注等空泛措辞。",
    "headline 是一句有方向性的结论；bullets 输出 3 至 5 条具体事实；analystView 说明对投资判断的含义，但不给买卖建议。",
    "输出 JSON：{\"headline\":\"\",\"bullets\":[{\"label\":\"\",\"detail\":\"\",\"importance\":\"high|medium|low\"}],\"analystView\":\"\"}",
  ].join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object");
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function isFresh(timestamp: string, ttlMs: number, nowMs: number): boolean {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && nowMs - parsed < ttlMs;
}

function filingCacheKey(ticker: string): string {
  return `sec:filings:${ticker}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
