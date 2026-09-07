import {
  COMPANY_ANALYSIS_BLOCK_TYPES,
  COMPANY_ANALYSIS_MAX_BLOCKS_PER_HIGHLIGHT,
  COMPANY_ANALYSIS_MAX_HIGHLIGHTS,
  COMPANY_ANALYSIS_MIN_HIGHLIGHTS,
} from "../../../shared/analysis-contract/company-analysis.ts";
import { REPORT_BLOCK_OUTPUT_SCHEMA } from "../../../shared/analysis-contract/report-blocks.ts";
import type { CompanyMemoryItem } from "./sec/analysis.ts";
import {
  normalizeCompanyAnalysisOverview,
  type CompanyAnalysisOverview,
} from "./company-analysis/contracts.ts";
import type { CompanyAnalysisPacket } from "./company-analysis/packet.ts";
import { callWorkerSecModel, type SecPipelineEnv } from "./operations.ts";

export type QuarterDiagnostic = {
  summary: string;
  drivers: Array<{ statement: string; evidenceRefs: string[] }>;
  risks: Array<{ statement: string; evidenceRefs: string[] }>;
  unresolved: string[];
};

export type CompanyAnalysisDecision = {
  headline: string;
  thesis: string;
  internalPillars: Array<{
    key: "business_stability" | "earning_power" | "balance_sheet" | "cash_quality" | "valuation_readiness";
    state: "strengthening" | "intact" | "watch" | "impaired" | "unobserved";
    claim: string;
    evidenceRefs: string[];
    falsifier: string;
    nextCheck: string;
  }>;
  selectedEvidenceRefs: string[];
};

export type CompanyAnalysisAgentOutput = {
  diagnostic: QuarterDiagnostic;
  decision: CompanyAnalysisDecision;
  overview: CompanyAnalysisOverview;
  rounds: number;
};

type AgentAction =
  | { action: "inspect_memory"; memoryIds: string[]; reason: string }
  | { action: "finalize"; decision: CompanyAnalysisDecision };

export async function runCompanyAnalysisAgent(input: {
  env: SecPipelineEnv;
  fetcher?: typeof fetch;
  currentPacket: CompanyAnalysisPacket;
  crossPeriodPacket: CompanyAnalysisPacket;
  analysisId: string;
  generatedAt: string;
  runStage?: <T>(stage: string, callback: () => Promise<T>) => Promise<T>;
}): Promise<CompanyAnalysisAgentOutput> {
  const fetcher = input.fetcher ?? fetch;
  const runStage = input.runStage ?? (async <T>(_stage: string, callback: () => Promise<T>) => callback());
  if (!input.currentPacket.features || !input.crossPeriodPacket.features) {
    throw new Error("Company analysis cannot run before Yahoo features are ready.");
  }
  if (input.currentPacket.historicalMemory.length || input.currentPacket.priorConclusion) {
    throw new Error("Call A packet leaked historical context.");
  }
  const currentQuarterEvidence = collectAllowedEvidence(input.currentPacket);
  const allowedEvidence = collectAllowedEvidence(input.crossPeriodPacket);
  const diagnostic = await runStage("current-quarter", async () => normalizeDiagnostic(await callWorkerSecModel(
    input.env,
    fetcher,
    "company-current-quarter",
    currentQuarterPrompt(),
    {
      task: "Analyze the current quarter without seeing earlier conclusions.",
      features: input.currentPacket.features,
      currentMemory: input.currentPacket.currentMemory,
      outputSchema: {
        summary: "string",
        drivers: "[{statement,evidenceRefs}]",
        risks: "[{statement,evidenceRefs}]",
        unresolved: "string[]",
      },
    },
  ), currentQuarterEvidence));

  const memoryById = new Map(
    [...input.crossPeriodPacket.currentMemory, ...input.crossPeriodPacket.historicalMemory]
      .map((item) => [item.memoryId, item]),
  );
  const memoryIndex = [...memoryById.values()].map((item) => ({
    memoryId: item.memoryId,
    topicKey: item.topicKey,
    status: item.status,
    materialityScore: item.materialityScore,
    lastConfirmedPeriod: item.lastConfirmedPeriod,
  }));
  const inspected = new Map<string, CompanyMemoryItem>();
  let decision: CompanyAnalysisDecision | null = null;
  let rounds = 0;
  for (let round = 1; round <= 4; round += 1) {
    rounds = round;
    const action = await runStage(`cross-period-round-${String(round).padStart(2, "0")}`, async () => normalizeAction(await callWorkerSecModel(
      input.env,
      fetcher,
      `company-cross-period-round-${String(round).padStart(2, "0")}`,
      crossPeriodPrompt(round),
      {
        diagnostic,
        features: input.crossPeriodPacket.features,
        memoryIndex,
        inspectedMemory: [...inspected.values()],
        priorConclusion: input.crossPeriodPacket.priorConclusion,
        outputSchema: round === 4
          ? { action: "finalize", decision: decisionSchema() }
          : { action: "inspect_memory|finalize", memoryIds: "string[] when inspect_memory", reason: "string", decision: decisionSchema() },
      },
    ), memoryById, allowedEvidence, round === 4));
    if (action.action === "finalize") {
      decision = action.decision;
      break;
    }
    for (const memoryId of action.memoryIds) {
      const memory = memoryById.get(memoryId);
      if (memory) inspected.set(memoryId, memory);
    }
  }
  if (!decision) throw new Error("Company analysis Agent exhausted its decision loop without finalizing.");

  // Only metrics the run actually observed can be charted. A feature the packet marked unavailable
  // has no points to draw, so offering it would only produce a block the page has to drop.
  const chartMetricKeys = new Set(
    input.crossPeriodPacket.features.features
      .filter((feature) => feature.quality !== "unavailable")
      .map((feature) => feature.metricKey),
  );

  const overview = await runStage("editorial", async () => {
    const editorialRaw = await callWorkerSecModel(
      input.env,
      fetcher,
      "company-editorial-report-v1",
      editorialPrompt(),
      {
        analysisId: input.analysisId,
        ticker: input.crossPeriodPacket.ticker,
        generatedAt: input.generatedAt,
        decision,
        approvedEvidence: approvedEvidence(decision.selectedEvidenceRefs, input.crossPeriodPacket),
        // The metrics a chart may name. Naming one the run never observed is the single most likely
        // way a block gets dropped, so the list is supplied rather than left to recall.
        chartMetricKeys: [...chartMetricKeys],
        outputSchema: {
          // No label: the section's name is fixed, so it is not something a run can restate.
          headline: "string, a forward judgment and its condition",
          introduction: "string, how the present position constrains the paths from here",
          highlights: `${COMPANY_ANALYSIS_MIN_HIGHLIGHTS}-${COMPANY_ANALYSIS_MAX_HIGHLIGHTS} [{title,body,watchFor,evidenceRefs,blocks?}], ordered by importance; the count is yours to choose`,
          watchFor: "string, the observation that would confirm or overturn this judgment next period",
          blocks: `optional, 0-${COMPANY_ANALYSIS_MAX_BLOCKS_PER_HIGHLIGHT} per highlight, rendered under its body`,
          blockTypes: blockVocabulary(),
        },
      },
    );
    const overview = normalizeCompanyAnalysisOverview(editorialRaw, { chartMetricKeys });
    validateEditorialEvidence(overview, new Set(decision.selectedEvidenceRefs));
    return overview;
  });
  return { diagnostic, decision, overview, rounds };
}

function currentQuarterPrompt(): string {
  return [
    "You are the current-quarter phase of one company-analysis Agent.",
    "Use only the supplied Yahoo Finance features and current-period Memory. You cannot infer prior conclusions.",
    "Every factual driver or risk must cite supplied featureRef or evidenceIds. Do not calculate financial actuals yourself.",
    "Separate reported fact, management explanation, and analytical inference. Return one JSON object only.",
  ].join("\n");
}

function crossPeriodPrompt(round: number): string {
  return [
    "You are the cross-period phase of the same company-analysis Agent.",
    "Decide whether the evidence is enough. You may inspect named Memory items or finalize; no other action exists.",
    "The five internal pillars are reasoning constraints, never the public report outline.",
    "Return exactly these five pillar keys: business_stability, earning_power, balance_sheet, cash_quality, valuation_readiness.",
    "Each pillar state must be exactly one of strengthening, intact, watch, impaired, unobserved; never translate these keys or states.",
    "Fixed Buffett thresholds are references, not universal scores. Mark unavailable evidence unobserved.",
    "Every pillar claim must be falsifiable and cite supplied featureRef or Memory evidenceIds.",
    round === 4 ? "This is the last round. You must finalize or fail." : "Request only Memory items material to the unresolved decision.",
    "Return one JSON object only.",
  ].join("\n");
}

function editorialPrompt(): string {
  return [
    "You are the editorial phase of the same company-analysis Agent.",
    "The decision is locked. Do not add evidence, alter pillar states, or invent numbers.",

    // What this section is for. Everything below follows from it: the reasoning phases look
    // backwards because that is where evidence lives, but the reader is here for what comes next.
    "This section answers where this company and its industry are heading over the next several quarters to years. It is not a quarter recap and not earnings commentary.",
    "The financials are evidence for that judgment, never its subject. Never open with the period's results, never structure the section around them, and never summarise them for their own sake.",
    "Write natural Chinese investment-research prose.",
    "The headline states a forward judgment and what it turns on — a direction and its condition — not what the quarter did.",
    "The introduction says how the company's present position constrains the paths open to it from here.",
    `Then write ${COMPANY_ANALYSIS_MIN_HIGHLIGHTS}-${COMPANY_ANALYSIS_MAX_HIGHLIGHTS} highlights. Each is one judgment about what changes from here: what the trajectory is, why the locked decision's evidence supports it, and what it would mean for the business.`,
    "Choose how many the decision earns: as many as it supports and no more. Never pad to a count, never split one judgment in two, never merge two to fit.",
    "Order them by importance — a run that exceeds the maximum is truncated from the end.",
    "Title each highlight yourself. A title states the forward judgment, not the topic: prefer 「资本开支高峰将在两到三个季度内压制利润率」 over 「资本开支」 or 「利润率承压」.",
    "Give each highlight a watchFor: the one observation that would confirm or overturn it. Take it from that pillar's falsifier or nextCheck, and write it as something a reader could actually check next period — not as a restatement of the judgment.",

    // The two ways this section drifts back into a quarter recap, both observed in published copy.
    "Never write about the sufficiency of your own evidence. A reader wants the judgment, or the honest absence of one, never a report on how much was observable.",
    "An industry-level judgment is in scope when the locked decision supports it. A judgment that is true of the whole sector and says nothing about this company is not.",

    "Do not write a full report or source-label prose. Do not expose pillar names, scores, confidence badges, feature IDs, Memory IDs, or repeated revenue/gross-margin cards in public copy.",
    "Numbers may appear only when an approved Yahoo feature is indispensable to the explanation.",
    "A highlight may add blocks under its body when prose alone reads worse: a list where the prose would enumerate, a callout for a condition that interrupts the argument, a chart where the point is a trend the reader should extrapolate. Most highlights need none — add one only when it replaces prose rather than repeating it.",
    "A chart names series from the supplied chartMetricKeys and nothing else. Never write data points; the page draws them from verified fundamentals.",
    "Return one JSON object only.",
  ].join("\n");
}

/** The block vocabulary, taken from the shared definition so the prompt cannot drift from it. */
function blockVocabulary(): Record<string, string> {
  return Object.fromEntries(
    COMPANY_ANALYSIS_BLOCK_TYPES.map((type) => [type, REPORT_BLOCK_OUTPUT_SCHEMA.blockTypes[type]]),
  );
}

function decisionSchema() {
  return {
    headline: "string",
    thesis: "string",
    internalPillars: ["business_stability", "earning_power", "balance_sheet", "cash_quality", "valuation_readiness"].map((key) => ({
      key,
      state: "strengthening|intact|watch|impaired|unobserved",
      claim: "string",
      evidenceRefs: "string[] containing supplied featureRef or Memory evidenceIds",
      falsifier: "string describing what would invalidate this claim",
      nextCheck: "string describing what to verify next",
    })),
    selectedEvidenceRefs: "string[]",
  };
}

function normalizeDiagnostic(value: unknown, allowed: Set<string>): QuarterDiagnostic {
  const item = record(value);
  const mapClaims = (raw: unknown) => Array.isArray(raw) ? raw.flatMap((candidate) => {
    const claim = record(candidate);
    const statement = string(claim?.statement, 800);
    const evidenceRefs = refs(claim?.evidenceRefs, allowed);
    return statement && evidenceRefs.length ? [{ statement, evidenceRefs }] : [];
  }).slice(0, 10) : [];
  const diagnostic = {
    summary: string(item?.summary, 1_200),
    drivers: mapClaims(item?.drivers),
    risks: mapClaims(item?.risks),
    unresolved: strings(item?.unresolved, 10, 400),
  };
  if (!diagnostic.summary || (!diagnostic.drivers.length && !diagnostic.risks.length)) {
    throw new Error("Current-quarter diagnostic is not decision grade.");
  }
  return diagnostic;
}

function normalizeAction(
  value: unknown,
  memories: Map<string, CompanyMemoryItem>,
  allowed: Set<string>,
  mustFinalize: boolean,
): AgentAction {
  const item = record(value);
  if (!mustFinalize && item?.action === "inspect_memory") {
    const memoryIds = strings(item.memoryIds, 8, 200).filter((memoryId) => memories.has(memoryId));
    const reason = string(item.reason, 500);
    if (!memoryIds.length || !reason) throw new Error("Agent requested an invalid Memory inspection.");
    return { action: "inspect_memory", memoryIds, reason };
  }
  if (item?.action !== "finalize") throw new Error("Agent must return inspect_memory or finalize.");
  const root = record(item.decision);
  const allowedKeys = ["business_stability", "earning_power", "balance_sheet", "cash_quality", "valuation_readiness"] as const;
  const pillars = Array.isArray(root?.internalPillars) ? root.internalPillars.flatMap((raw) => {
    const pillar = record(raw);
    const key = allowedKeys.find((candidate) => candidate === pillar?.key);
    const states = ["strengthening", "intact", "watch", "impaired", "unobserved"] as const;
    const state = states.find((candidate) => candidate === pillar?.state);
    const claim = string(pillar?.claim, 1_000);
    const evidenceRefs = refs(pillar?.evidenceRefs, allowed);
    const falsifier = string(pillar?.falsifier, 500);
    const nextCheck = string(pillar?.nextCheck, 500);
    return key && state && claim && falsifier && nextCheck && (state === "unobserved" || evidenceRefs.length)
      ? [{ key, state, claim, evidenceRefs, falsifier, nextCheck }]
      : [];
  }) : [];
  const byKey = new Map(pillars.map((pillar) => [pillar.key, pillar]));
  const internalPillars = allowedKeys.map((key) => byKey.get(key)).filter(Boolean) as CompanyAnalysisDecision["internalPillars"];
  const selectedEvidenceRefs = refs(root?.selectedEvidenceRefs, allowed);
  const decision = {
    headline: string(root?.headline, 180),
    thesis: string(root?.thesis, 1_800),
    internalPillars,
    selectedEvidenceRefs,
  };
  if (!decision.headline || !decision.thesis || internalPillars.length !== 5 || !selectedEvidenceRefs.length) {
    throw new Error("Company analysis decision is invalid.");
  }
  return { action: "finalize", decision };
}

function collectAllowedEvidence(packet: CompanyAnalysisPacket): Set<string> {
  const allowed = new Set<string>();
  packet.features?.features.forEach((item) => allowed.add(item.featureRef));
  packet.features?.derived.forEach((item) => allowed.add(item.featureRef));
  for (const memory of [...packet.currentMemory, ...packet.historicalMemory]) {
    memory.evidenceIds.forEach((id) => allowed.add(id));
  }
  return allowed;
}

function approvedEvidence(selected: string[], packet: CompanyAnalysisPacket) {
  const featureByRef = new Map<string, unknown>();
  packet.features?.features.forEach((item) => featureByRef.set(item.featureRef, item));
  packet.features?.derived.forEach((item) => featureByRef.set(item.featureRef, item));
  const memoryByEvidence = new Map<string, CompanyMemoryItem>();
  for (const memory of [...packet.currentMemory, ...packet.historicalMemory]) {
    memory.evidenceIds.forEach((id) => memoryByEvidence.set(id, memory));
  }
  return selected.flatMap((evidenceRef) => {
    const feature = featureByRef.get(evidenceRef);
    if (feature) return [{ evidenceRef, kind: "yahoo_feature", value: feature }];
    const memory = memoryByEvidence.get(evidenceRef);
    return memory ? [{ evidenceRef, kind: "company_memory", value: {
      statement: memory.statement,
      status: memory.status,
      lastConfirmedPeriod: memory.lastConfirmedPeriod,
    } }] : [];
  });
}

function validateEditorialEvidence(
  overview: CompanyAnalysisOverview,
  allowed: Set<string>,
): void {
  const refsToCheck = overview.highlights.flatMap((item) => item.evidenceRefs);
  if (!refsToCheck.length || refsToCheck.some((value) => !allowed.has(value))) {
    throw new Error("Editorial overview cited evidence outside the locked decision.");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown, max: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  return result && result.length <= max ? result : "";
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value) ? value.map((item) => string(item, maxLength)).filter(Boolean).slice(0, maxItems) : [];
}

function refs(value: unknown, allowed: Set<string>): string[] {
  return strings(value, 32, 260).filter((item) => allowed.has(item));
}
