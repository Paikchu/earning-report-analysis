export const SEC_ANALYSIS_SCHEMA_VERSION = "sec-analysis.v2";
export const SEC_ANALYSIS_PROMPT_VERSION = "sec-analysis-prompt.v1";

export const SEC_DATA_NEEDS = {
  coreFacts: [
    "revenue",
    "revenue_growth",
    "gross_profit",
    "gross_margin",
    "operating_income",
    "operating_margin",
    "net_income",
    "eps",
    "operating_cash_flow",
    "capex",
    "free_cash_flow",
    "cash",
    "debt",
    "segment_revenue",
    "segment_margin",
    "guidance",
    "capital_return",
  ],
  narrativeNeeds: [
    "growth_driver",
    "volume_price_mix",
    "demand_and_backlog",
    "ai_and_cloud",
    "cost_and_margin_driver",
    "capex_and_capacity",
    "liquidity",
    "material_risk",
    "accounting_change",
    "internal_control",
    "subsequent_event",
  ],
  comparisons: ["qoq", "yoy", "guidance_revision", "disclosure_change"],
} as const;

export const SEC_ANALYSIS_MODULES = [
  {
    key: "performance",
    fields: ["revenue", "revenue_growth", "gross_profit", "operating_income", "net_income", "eps"],
    questions: ["What changed in reported performance?", "What explains the direction and pace of growth?"],
  },
  {
    key: "segments_and_kpis",
    fields: ["segment_revenue", "segment_margin", "business_kpi", "backlog"],
    questions: ["Which segment or KPI drove the difference?", "Did the issuer change the definition or grouping?"],
  },
  {
    key: "margins_and_costs",
    fields: ["gross_margin", "operating_margin", "cost_driver", "one_off"],
    questions: ["What moved margins?", "Is the movement recurring or below-the-line?"],
  },
  {
    key: "cash_and_capital",
    fields: ["operating_cash_flow", "capex", "free_cash_flow", "cash", "debt", "capital_return"],
    questions: ["How did cash conversion and capital intensity change?", "Did liquidity or capital allocation change?"],
  },
  {
    key: "guidance_and_tone",
    fields: ["guidance", "outlook", "management_claim"],
    questions: ["Did guidance change for the same target period?", "Did management tone strengthen or weaken?"],
  },
  {
    key: "risks_and_controls",
    fields: ["material_risk", "accounting_change", "internal_control", "subsequent_event"],
    questions: ["What risks or controls were added, changed, resolved, or merely repeated?"],
  },
  {
    key: "capital_allocation",
    fields: ["buyback", "dividend", "debt_repayment", "acquisition", "capex_commitment"],
    questions: ["What changed in capital allocation and future commitments?"],
  },
] as const;

export type SecAnalysisModuleKey = typeof SEC_ANALYSIS_MODULES[number]["key"];
export type SecComparisonType = "qoq" | "yoy" | "guidance_revision" | "disclosure_change";

export function buildPeriodIdentity(ticker: string, form: string, reportDate: string): { periodId: string; periodScope: "quarter" | "annual" } {
  const periodScope = form.startsWith("10-K") || form.startsWith("20-F") ? "annual" : "quarter";
  return {
    periodId: `${ticker}:${reportDate}:${periodScope}`,
    periodScope,
  };
}

export type FilingBlock = {
  blockId: string;
  ordinal: number;
  heading: string;
  headingPath: string;
  elementType: "heading_and_text" | "text" | "table_like";
  preview: string;
  body: string;
  tokenCount: number;
  numericDensity: number;
  tableCount: number;
  contentHash: string;
};

export type RouterSelection = {
  moduleKey: SecAnalysisModuleKey;
  blockIds: string[];
  expectedFields: string[];
  priority: "high" | "medium" | "low";
  needFullText: boolean;
  confidence: number;
};

export type RouterResult = {
  selections: RouterSelection[];
  source: "model" | "fallback";
  status: "complete" | "partial" | "failed";
  missingModules: SecAnalysisModuleKey[];
};

export type AnalysisFact = {
  factId?: string;
  metricKey: string;
  value: string;
  unit: string;
  currency?: string;
  periodScope?: string;
  basis: "gaap" | "non_gaap" | "management_kpi" | "derived" | "unknown";
  evidenceIds: string[];
  confidence: "high" | "medium" | "low";
  sourceLabel: "fact_source_reported" | "management_adjusted" | "derived_calculation" | "unknown";
  definitionHash?: string;
};

export type AnalysisClaim = {
  claimId?: string;
  topicKey: string;
  claimType: "driver" | "guidance" | "risk" | "one_off" | "accounting" | "commitment" | "tone";
  statement: string;
  direction: "positive" | "negative" | "mixed" | "neutral" | "unknown";
  horizon: "current" | "next_period" | "longer_term" | "unknown";
  materialityScore: number;
  confidence: "high" | "medium" | "low";
  evidenceIds: string[];
  targetPeriodId?: string;
};

export type MemoryCandidate = AnalysisClaim & {
  memoryType: "guidance" | "risk" | "commitment" | "definition" | "driver" | "one_off";
  firstSeenPeriod?: string;
  expectedResolutionPeriod?: string;
};

export type ModuleAnalysis = {
  moduleKey: SecAnalysisModuleKey;
  facts: AnalysisFact[];
  claims: AnalysisClaim[];
  memoryCandidates: MemoryCandidate[];
  missingFields: string[];
  evidenceCoverage: number;
  verificationStatus: "verified" | "partial" | "failed";
};

export type SnapshotSummary = {
  ticker: string;
  periodId: string;
  filingId: string;
  moduleKey: SecAnalysisModuleKey;
  facts: AnalysisFact[];
  claims: AnalysisClaim[];
  memoryCandidates: MemoryCandidate[];
  missingFields: string[];
  evidenceCoverage: number;
  verificationStatus: ModuleAnalysis["verificationStatus"];
};

export type PriorSnapshotContext = {
  periodId: string;
  moduleKey: SecAnalysisModuleKey;
  facts: AnalysisFact[];
  claims: AnalysisClaim[];
  activeMemory: Array<Pick<MemoryCandidate, "topicKey" | "statement" | "memoryType" | "materialityScore" | "confidence" | "evidenceIds"> & {
    firstSeenPeriod: string;
    lastConfirmedPeriod: string;
    status: string;
  }>;
};

export type ComparisonResult = {
  comparisonType: SecComparisonType;
  currentPeriodId: string;
  priorPeriodId: string;
  comparability: "full" | "partial" | "not_comparable";
  metricDeltas: Array<{
    metricKey: string;
    currentValue: string;
    priorValue: string;
    absoluteDelta?: string;
    percentageDelta?: string;
    reason?: string;
  }>;
  narrativeDeltas: Array<{
    topicKey: string;
    changeType: "introduced" | "reaffirmed" | "strengthened" | "weakened" | "withdrawn" | "resolved" | "not_mentioned";
    currentStatement?: string;
    priorStatement?: string;
    evidenceIds: string[];
    materialityScore: number;
  }>;
};

export type PublishedSecReport = {
  ticker: string;
  periodId: string;
  reportVersion: string;
  headline: string;
  keyMetrics: Array<{
    metricKey: string;
    currentValue: string;
    qoq?: string;
    yoy?: string;
    status: "verified" | "derived" | "not_comparable" | "not_disclosed";
    evidenceIds: string[];
  }>;
  changes: {
    qoq: ComparisonResult["narrativeDeltas"];
    yoy: ComparisonResult["narrativeDeltas"];
    guidance: AnalysisClaim[];
    risks: AnalysisClaim[];
  };
  dataQuality: {
    coverage: number;
    verificationStatus: "verified" | "partial" | "failed";
    warnings: string[];
  };
};

export function buildFilingBlocks(text: string, accessionNumber: string): FilingBlock[] {
  const lines = String(text ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (current && (candidate.length > 2_400 || isStructuralHeading(line))) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  let heading = "Document";
  return chunks.map((body, index) => {
    const firstLine = body.split("\n")[0] ?? "";
    if (isStructuralHeading(firstLine)) heading = firstLine.slice(0, 160);
    const blockId = `${accessionNumber}:block:${String(index + 1).padStart(4, "0")}:${hashString(body)}`;
    const digits = (body.match(/[0-9]/g) ?? []).length;
    const tableLikeLines = body.split("\n").filter((line) => (line.match(/[0-9]/g) ?? []).length >= 3).length;
    return {
      blockId,
      ordinal: index,
      heading,
      headingPath: `${heading} / block ${index + 1}`,
      elementType: tableLikeLines >= 2 ? "table_like" : isStructuralHeading(firstLine) ? "heading_and_text" : "text",
      preview: body.slice(0, 420),
      body,
      tokenCount: Math.ceil(body.length / 4),
      numericDensity: Math.round((digits / Math.max(body.length, 1)) * 1000),
      tableCount: Math.max(0, Math.floor(tableLikeLines / 4)),
      contentHash: hashString(body),
    };
  });
}

export function buildRouterPayload(
  filing: { ticker: string; form: string; filingDate: string; reportDate: string; accessionNumber: string },
  blocks: FilingBlock[],
  priorModules: Array<{ moduleKey: SecAnalysisModuleKey; periodId: string }>,
) {
  const inventoryBlocks = blocks.length <= 240
    ? blocks
    : [...blocks.slice(0, 60), ...[...blocks].sort((left, right) => right.numericDensity - left.numericDensity).slice(0, 140), ...blocks.slice(-40)]
      .filter((block, index, all) => all.findIndex((item) => item.blockId === block.blockId) === index);
  return {
    task: "Select filing blocks for financial analysis. Choose only block IDs from this filing.",
    filing,
    dataNeeds: SEC_DATA_NEEDS,
    modules: SEC_ANALYSIS_MODULES,
    priorModules,
    inventory: inventoryBlocks.map((item) => ({
      blockId: item.blockId,
      ordinal: item.ordinal,
      heading: item.heading,
      headingPath: item.headingPath,
      elementType: item.elementType,
      preview: item.preview,
      tokenCount: item.tokenCount,
      numericDensity: item.numericDensity,
      tableCount: item.tableCount,
      contentHash: item.contentHash,
    })),
    outputSchema: {
      selections: "[{moduleKey, blockIds, expectedFields, priority, needFullText, confidence}]",
    },
  };
}

export function normalizeRouterResult(value: unknown, blocks: FilingBlock[]): RouterResult {
  const root = asRecord(value);
  const validIds = new Set(blocks.map((block) => block.blockId));
  const moduleKeys = new Set<SecAnalysisModuleKey>(SEC_ANALYSIS_MODULES.map((module) => module.key));
  const rawSelections = Array.isArray(root?.selections) ? root.selections : [];
  const normalizedSelections = rawSelections.flatMap((raw): RouterSelection[] => {
    const item = asRecord(raw);
    const moduleKey = String(item?.moduleKey ?? "") as SecAnalysisModuleKey;
    if (!moduleKeys.has(moduleKey)) return [];
    const blockIds = Array.isArray(item?.blockIds)
      ? item.blockIds.map(String).filter((blockId) => validIds.has(blockId)).slice(0, 16)
      : [];
    if (!blockIds.length) return [];
    const priority = item?.priority === "high" || item?.priority === "low" ? item.priority : "medium";
    const confidence = clamp(Number(item?.confidence ?? 0), 0, 1);
    return [{
      moduleKey,
      blockIds,
      expectedFields: Array.isArray(item?.expectedFields) ? item.expectedFields.map(String).slice(0, 20) : [],
      priority,
      needFullText: item?.needFullText === true,
      confidence,
    }];
  });
  const selections = [...normalizedSelections.reduce((grouped, selection) => {
    const existing = grouped.get(selection.moduleKey);
    if (!existing) {
      grouped.set(selection.moduleKey, selection);
      return grouped;
    }
    const priority = existing.priority === "high" || selection.priority === "high"
      ? "high"
      : existing.priority === "medium" || selection.priority === "medium" ? "medium" : "low";
    grouped.set(selection.moduleKey, {
      moduleKey: selection.moduleKey,
      blockIds: [...new Set([...existing.blockIds, ...selection.blockIds])].slice(0, 16),
      expectedFields: [...new Set([...existing.expectedFields, ...selection.expectedFields])].slice(0, 20),
      priority,
      needFullText: existing.needFullText || selection.needFullText,
      confidence: Math.max(existing.confidence, selection.confidence),
    });
    return grouped;
  }, new Map<SecAnalysisModuleKey, RouterSelection>()).values()];
  const selectedModules = new Set(selections.map((selection) => selection.moduleKey));
  const missingModules = SEC_ANALYSIS_MODULES.map((module) => module.key).filter((key) => !selectedModules.has(key));
  return {
    selections,
    source: selections.length ? "model" : "fallback",
    status: selections.length === SEC_ANALYSIS_MODULES.length ? "complete" : selections.length ? "partial" : "failed",
    missingModules,
  };
}

export function fallbackRouterResult(blocks: FilingBlock[]): RouterResult {
  const ranked = [...blocks].sort((left, right) => right.numericDensity - left.numericDensity || right.tokenCount - left.tokenCount);
  const blockIds = ranked.slice(0, 18).map((block) => block.blockId);
  return {
    source: "fallback",
    status: blockIds.length ? "partial" : "failed",
    missingModules: SEC_ANALYSIS_MODULES.map((module) => module.key),
    selections: blockIds.length ? SEC_ANALYSIS_MODULES.map((module) => ({
      moduleKey: module.key,
      blockIds,
      expectedFields: [...module.fields],
      priority: "medium" as const,
      needFullText: false,
      confidence: 0.2,
    })) : [],
  };
}

export function buildModulePayload(args: {
  moduleKey: SecAnalysisModuleKey;
  filing: { ticker: string; form: string; reportDate: string; accessionNumber: string };
  currentBlocks: FilingBlock[];
  currentFacts: AnalysisFact[];
  qoq?: PriorSnapshotContext;
  yoy?: PriorSnapshotContext;
  activeMemory: PriorSnapshotContext["activeMemory"];
  precomputedDeltas: ComparisonResult[];
}) {
  const moduleDefinition = SEC_ANALYSIS_MODULES.find((item) => item.key === args.moduleKey);
  return {
    task: "Extract verified facts and explain changes. Do not invent unavailable values.",
    filing: args.filing,
    module: { key: args.moduleKey, fields: moduleDefinition?.fields ?? [], questions: moduleDefinition?.questions ?? [] },
    current: {
      facts: args.currentFacts,
      evidence: args.currentBlocks.map((block) => ({
        blockId: block.blockId,
        evidenceId: `ev:${block.blockId}`,
        headingPath: block.headingPath,
        excerpt: block.body.slice(0, 3_200),
      })),
    },
    comparisons: {
      qoq: compactPriorContext(args.qoq),
      yoy: compactPriorContext(args.yoy),
      precomputedDeltas: args.precomputedDeltas,
    },
    activeMemory: args.activeMemory.slice(0, 5),
    outputSchema: {
      facts: [{
        metricKey: "string",
        value: "string",
        unit: "string",
        currency: "string",
        periodScope: "string",
        basis: "gaap|non_gaap|management_kpi|derived|unknown",
        evidenceIds: ["ev:<supplied blockId>"],
        confidence: "high|medium|low",
        sourceLabel: "fact_source_reported|management_adjusted|derived_calculation|unknown",
      }],
      claims: [{
        topicKey: "string",
        claimType: "driver|guidance|risk|one_off|accounting|commitment|tone",
        statement: "string",
        direction: "positive|negative|mixed|neutral|unknown",
        horizon: "current|next_period|longer_term|unknown",
        materialityScore: "number 0-100",
        confidence: "high|medium|low",
        evidenceIds: ["ev:<supplied blockId>"],
      }],
      memoryCandidates: [],
      missingFields: ["string"],
      evidenceCoverage: "number 0-1",
    },
    rules: [
      "Use the exact outputSchema keys and value types.",
      "Copy evidenceId values exactly from current.evidence; do not return quotes or evidence objects.",
      "Every fact and claim must cite evidence IDs.",
      "Put undisclosed field names in missingFields; do not create not_disclosed facts.",
      "Do not calculate numeric deltas; use precomputed deltas.",
      "Do not treat not_mentioned as withdrawn.",
    ],
  };
}

export function normalizeModuleAnalysis(value: unknown, moduleKey: SecAnalysisModuleKey, validEvidenceIds: Set<string>): ModuleAnalysis {
  const root = asRecord(value);
  const facts = Array.isArray(root?.facts) ? root.facts.flatMap((raw): AnalysisFact[] => {
    const item = asRecord(raw);
    const evidenceIds = evidenceList(item?.evidenceIds, validEvidenceIds);
    const valueText = String(item?.value ?? "").trim();
    const metricKey = String(item?.metricKey ?? "").trim();
    if (!metricKey || !valueText || !evidenceIds.length) return [];
    const basis = item?.basis === "gaap" || item?.basis === "non_gaap" || item?.basis === "management_kpi" || item?.basis === "derived" ? item.basis : "unknown";
    const sourceLabel = item?.sourceLabel === "fact_source_reported" || item?.sourceLabel === "management_adjusted" || item?.sourceLabel === "derived_calculation" ? item.sourceLabel : "unknown";
    return [{
      metricKey,
      value: valueText.slice(0, 80),
      unit: String(item?.unit ?? "").slice(0, 30),
      currency: String(item?.currency ?? "").slice(0, 8),
      periodScope: String(item?.periodScope ?? "").slice(0, 20),
      basis,
      evidenceIds,
      confidence: confidence(item?.confidence),
      sourceLabel,
      definitionHash: String(item?.definitionHash ?? "").slice(0, 80),
    }];
  }) : [];
  const claims = Array.isArray(root?.claims) ? root.claims.flatMap((raw): AnalysisClaim[] => normalizeClaim(raw, validEvidenceIds)) : [];
  const memoryCandidates = Array.isArray(root?.memoryCandidates) ? root.memoryCandidates.flatMap((raw): MemoryCandidate[] => {
    const claim = normalizeClaim(raw, validEvidenceIds)[0];
    const item = asRecord(raw);
    if (!claim) return [];
    const memoryType = item?.memoryType === "guidance" || item?.memoryType === "risk" || item?.memoryType === "commitment" || item?.memoryType === "definition" || item?.memoryType === "one_off" ? item.memoryType : "driver";
    return [{ ...claim, memoryType, firstSeenPeriod: String(item?.firstSeenPeriod ?? "") || undefined, expectedResolutionPeriod: String(item?.expectedResolutionPeriod ?? "") || undefined }];
  }) : [];
  const missingFields = Array.isArray(root?.missingFields) ? root.missingFields.map(String).slice(0, 30) : [];
  const evidenceCoverage = clamp(Number(root?.evidenceCoverage ?? (facts.length || claims.length ? 1 : 0)), 0, 1);
  const verificationStatus = evidenceCoverage >= 0.9 ? "verified" : evidenceCoverage > 0 ? "partial" : "failed";
  return { moduleKey, facts, claims, memoryCandidates, missingFields, evidenceCoverage, verificationStatus };
}

export function compareSnapshots(
  comparisonType: SecComparisonType,
  current: SnapshotSummary,
  prior: PriorSnapshotContext,
): ComparisonResult {
  const priorFacts = new Map(prior.facts.map((fact) => [`${fact.metricKey}:${fact.unit}:${fact.basis}:${fact.definitionHash ?? ""}`, fact]));
  const metricDeltas: ComparisonResult["metricDeltas"] = current.facts.flatMap((fact) => {
    const match = priorFacts.get(`${fact.metricKey}:${fact.unit}:${fact.basis}:${fact.definitionHash ?? ""}`);
    if (!match) return [];
    const currentNumber = numericValue(fact.value);
    const priorNumber = numericValue(match.value);
    if (currentNumber === null || priorNumber === null) return [{ metricKey: fact.metricKey, currentValue: fact.value, priorValue: match.value, reason: "non_numeric" }];
    const absoluteDelta = String(currentNumber - priorNumber);
    const percentageDelta = priorNumber === 0 ? undefined : String((currentNumber - priorNumber) / Math.abs(priorNumber));
    return [{ metricKey: fact.metricKey, currentValue: fact.value, priorValue: match.value, absoluteDelta, percentageDelta }];
  });
  const priorClaims = new Map(prior.claims.map((claim) => [claim.topicKey, claim]));
  const currentTopics = new Set(current.claims.map((claim) => claim.topicKey));
  const narrativeDeltas: ComparisonResult["narrativeDeltas"] = current.claims.map((claim) => {
    const previous = priorClaims.get(claim.topicKey);
    const changeType = !previous
      ? "introduced"
      : claim.direction !== previous.direction || claim.statement !== previous.statement
        ? claim.direction === "positive" && previous.direction !== "positive" ? "strengthened" : "weakened"
        : "reaffirmed";
    return { topicKey: claim.topicKey, changeType: changeType as ComparisonResult["narrativeDeltas"][number]["changeType"], currentStatement: claim.statement, priorStatement: previous?.statement, evidenceIds: [...new Set([...claim.evidenceIds, ...(previous?.evidenceIds ?? [])])], materialityScore: Math.max(claim.materialityScore, previous?.materialityScore ?? 0) };
  });
  for (const previous of prior.claims) {
    if (!currentTopics.has(previous.topicKey)) narrativeDeltas.push({ topicKey: previous.topicKey, changeType: "not_mentioned", priorStatement: previous.statement, evidenceIds: previous.evidenceIds, materialityScore: previous.materialityScore });
  }
  return {
    comparisonType,
    currentPeriodId: current.periodId,
    priorPeriodId: prior.periodId,
    comparability: metricDeltas.length || narrativeDeltas.length ? "full" : "not_comparable",
    metricDeltas,
    narrativeDeltas,
  };
}

export function buildSummaryPayload(args: {
  ticker: string;
  periodId: string;
  moduleSnapshots: SnapshotSummary[];
  qoq: ComparisonResult | null;
  yoy: ComparisonResult | null;
}) {
  return {
    task: "Compose the front-end report from verified module snapshots. Do not add facts.",
    ticker: args.ticker,
    periodId: args.periodId,
    moduleSnapshots: args.moduleSnapshots,
    comparisons: { qoq: args.qoq, yoy: args.yoy },
    outputSchema: {
      headline: "string",
      keyMetrics: "[{metricKey,currentValue,qoq,yoy,status,evidenceIds}]",
      changes: "{qoq,yoy,guidance,risks}",
      dataQuality: "{coverage,verificationStatus,warnings}",
    },
  };
}

export function normalizePublishedReport(
  value: unknown,
  fallback: Omit<PublishedSecReport, "headline" | "keyMetrics" | "changes" | "dataQuality">,
  validEvidenceIds: Set<string> = new Set(),
): PublishedSecReport {
  const root = asRecord(value);
  const keyMetrics: PublishedSecReport["keyMetrics"] = Array.isArray(root?.keyMetrics) ? root.keyMetrics.flatMap((raw) => {
    const item = asRecord(raw);
    const metricKey = String(item?.metricKey ?? "").trim();
    const evidenceIds = evidenceList(item?.evidenceIds, validEvidenceIds).slice(0, 10);
    if (!metricKey || !evidenceIds.length) return [];
    const status: PublishedSecReport["keyMetrics"][number]["status"] = item?.status === "derived" || item?.status === "not_comparable" || item?.status === "not_disclosed" ? item.status : "verified";
    return [{ metricKey, currentValue: String(item?.currentValue ?? "").slice(0, 80), qoq: optionalString(item?.qoq), yoy: optionalString(item?.yoy), status, evidenceIds }];
  }) : [];
  const changes = asRecord(root?.changes);
  const normalizeChangeList = (valueToNormalize: unknown): ComparisonResult["narrativeDeltas"] => Array.isArray(valueToNormalize) ? valueToNormalize.flatMap((item) => normalizeNarrativeDelta(item, validEvidenceIds)) : [];
  const qoq = normalizeChangeList(changes?.qoq);
  const yoy = normalizeChangeList(changes?.yoy);
  const guidance = Array.isArray(changes?.guidance) ? changes.guidance.flatMap((item) => normalizeClaim(item, validEvidenceIds)) : [];
  const risks = Array.isArray(changes?.risks) ? changes.risks.flatMap((item) => normalizeClaim(item, validEvidenceIds)) : [];
  const dataQuality = asRecord(root?.dataQuality);
  const coverage = clamp(Number(dataQuality?.coverage ?? 0), 0, 1);
  const verificationStatus = keyMetrics.length && coverage >= 0.9 && keyMetrics.every((metric) => metric.evidenceIds.length) ? "verified" : keyMetrics.length && coverage > 0 ? "partial" : "failed";
  return {
    ...fallback,
    headline: String(root?.headline ?? "").slice(0, 240),
    keyMetrics,
    changes: { qoq, yoy, guidance, risks },
    dataQuality: { coverage, verificationStatus, warnings: Array.isArray(dataQuality?.warnings) ? dataQuality.warnings.map(String).slice(0, 20) : [] },
  };
}

function normalizeNarrativeDelta(value: unknown, validEvidenceIds: Set<string> = new Set()) {
  const item = asRecord(value);
  const topicKey = String(item?.topicKey ?? "").trim();
  if (!topicKey) return [];
  const allowed = ["introduced", "reaffirmed", "strengthened", "weakened", "withdrawn", "resolved", "not_mentioned"] as const;
  const changeType = allowed.includes(item?.changeType as typeof allowed[number]) ? item?.changeType as typeof allowed[number] : "not_mentioned";
  return [{ topicKey, changeType, currentStatement: optionalString(item?.currentStatement), priorStatement: optionalString(item?.priorStatement), evidenceIds: evidenceList(item?.evidenceIds, validEvidenceIds).slice(0, 10), materialityScore: clamp(Number(item?.materialityScore ?? 0), 0, 100) }];
}

function normalizeClaim(value: unknown, validEvidenceIds: Set<string>): AnalysisClaim[] {
  const item = asRecord(value);
  const topicKey = String(item?.topicKey ?? "").trim();
  const statement = String(item?.statement ?? "").trim();
  const evidenceIds = evidenceList(item?.evidenceIds, validEvidenceIds);
  if (!topicKey || !statement || !evidenceIds.length) return [];
  const claimTypes = ["driver", "guidance", "risk", "one_off", "accounting", "commitment", "tone"] as const;
  const directions = ["positive", "negative", "mixed", "neutral", "unknown"] as const;
  const horizons = ["current", "next_period", "longer_term", "unknown"] as const;
  return [{
    topicKey,
    claimType: claimTypes.includes(item?.claimType as typeof claimTypes[number]) ? item?.claimType as typeof claimTypes[number] : "driver",
    statement: statement.slice(0, 600),
    direction: directions.includes(item?.direction as typeof directions[number]) ? item?.direction as typeof directions[number] : "unknown",
    horizon: horizons.includes(item?.horizon as typeof horizons[number]) ? item?.horizon as typeof horizons[number] : "unknown",
    materialityScore: clamp(Number(item?.materialityScore ?? 0), 0, 100),
    confidence: confidence(item?.confidence),
    evidenceIds,
    targetPeriodId: optionalString(item?.targetPeriodId),
  }];
}

function compactPriorContext(value: PriorSnapshotContext | undefined) {
  if (!value) return null;
  return {
    periodId: value.periodId,
    facts: value.facts.slice(0, 30),
    claims: value.claims.slice(0, 8).map((claim) => ({ ...claim, statement: claim.statement.slice(0, 240) })),
    activeMemory: value.activeMemory.slice(0, 5),
  };
}

function evidenceList(value: unknown, validEvidenceIds: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.map(String).filter(Boolean);
  if (!validEvidenceIds.size) return ids.slice(0, 10);
  return ids
    .map((id) => validEvidenceIds.has(id) ? id : `ev:${id}`)
    .filter((id) => validEvidenceIds.has(id))
    .slice(0, 10);
}

function isStructuralHeading(line: string): boolean {
  return line.length <= 160 && (/^(part|item)\s+[ivx0-9]/i.test(line) || /^[A-Z][A-Z0-9\s&,/'().:-]{12,}$/.test(line) || /^\d+(?:\.\d+)*\s+\S+/.test(line));
}

function numericValue(value: string): number | null {
  const normalized = String(value).replace(/[$,%\s,]/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function confidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "low" ? value : "medium";
}

function optionalString(value: unknown): string | undefined {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, 240) : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
