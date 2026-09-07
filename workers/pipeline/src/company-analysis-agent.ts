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

/**
 * The five axes the reasoning phase must cover.
 *
 * They are a coverage discipline, not a report outline: the phase returns all five and marks what
 * it could not observe, so a run cannot answer the interesting questions and quietly skip the
 * balance sheet.
 *
 * They replace the quality pillars this phase used to score. `valuation_readiness` is gone because
 * it had no evidence to stand on — the feature pack carries no valuation metrics, so it resolved to
 * `unobserved` every run and surfaced in published copy as 「估值证据完全缺失」. In its place,
 * `reinvestment_efficiency` asks what today's capital spending turns into, which the feature pack
 * can actually answer and which is the question a forward view turns on. `demand_and_position`
 * carries the industry: where demand is going and whether this company's position in it is holding.
 */
export const COMPANY_TRAJECTORY_KEYS = [
  "demand_and_position",
  "earning_power",
  "reinvestment_efficiency",
  "cash_generation",
  "balance_sheet_capacity",
] as const;

/** Direction of travel, not present quality. `inflecting` is a turn the evidence already shows. */
export const COMPANY_TRAJECTORY_STATES = ["improving", "stable", "deteriorating", "inflecting", "unobserved"] as const;

/** A forward claim without a time frame cannot be checked, so the horizon is part of the claim. */
export const COMPANY_TRAJECTORY_HORIZONS = ["next_1_2_quarters", "next_4_quarters", "multi_year", "unobserved"] as const;

export type CompanyAnalysisDecision = {
  headline: string;
  thesis: string;
  internalTrajectories: Array<{
    key: (typeof COMPANY_TRAJECTORY_KEYS)[number];
    trajectory: (typeof COMPANY_TRAJECTORY_STATES)[number];
    horizon: (typeof COMPANY_TRAJECTORY_HORIZONS)[number];
    /**
     * The causal chain that moves this axis. What separates a forward judgment from an extrapolated
     * line: a claim carrying a mechanism has to survive being asked why, and one without it is a
     * trend drawn forward.
     */
    mechanism: string;
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
          highlights: `${COMPANY_ANALYSIS_MIN_HIGHLIGHTS}-${COMPANY_ANALYSIS_MAX_HIGHLIGHTS} [{title,body,evidenceRefs,blocks?}], ordered by importance; the count is yours to choose`,
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
    "Decide where this business is heading and whether the evidence is enough to say so. You may inspect named Memory items or finalize; no other action exists.",
    "The five internal axes are reasoning constraints, never the public report outline.",
    `Return exactly these five axis keys: ${COMPANY_TRAJECTORY_KEYS.join(", ")}.`,
    `Each trajectory must be exactly one of ${COMPANY_TRAJECTORY_STATES.join(", ")}, and each horizon exactly one of ${COMPANY_TRAJECTORY_HORIZONS.join(", ")}; never translate these keys or values.`,
    "A trajectory is a direction of travel, not a verdict on current quality. Ask what changes over the horizon and why, not how good the axis looks today.",
    "Every axis must name the mechanism that moves it — the causal chain, not the trend line. 「收入增长所以利润率扩张」 restates a number; 「利润率扩张会持续到新增产能转固，届时折旧反转它」 is a mechanism.",
    "Quality thresholds describe where an axis stands today. That is the starting point of a trajectory, never the judgment itself.",
    "Mark an axis unobserved when the supplied evidence cannot carry a forward claim. An honest unobserved is worth more than a claim the evidence does not support, and it never reaches public copy.",
    "Every axis claim must be falsifiable and cite supplied featureRef or Memory evidenceIds.",
    round === 4 ? "This is the last round. You must finalize or fail." : "Request only Memory items material to the unresolved decision.",
    "Return one JSON object only.",
  ].join("\n");
}

function editorialPrompt(): string {
  return [
    "You are the editorial phase of the same company-analysis Agent.",
    "The decision is locked. Do not add evidence, alter any trajectory, or invent numbers.",

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

    // The two ways this section drifts back into a quarter recap, both observed in published copy.
    "Never write about the sufficiency of your own evidence. A reader wants the judgment, or the honest absence of one, never a report on how much was observable.",
    "An industry-level judgment is in scope when the locked decision supports it. A judgment that is true of the whole sector and says nothing about this company is not.",

    "Build each highlight on one axis's mechanism, and say what it implies. A highlight that restates an axis claim has added nothing the decision did not already hold.",
    "An axis marked unobserved supports no highlight. Leave it out silently; never write that it could not be assessed.",
    "Do not write a full report or source-label prose. Do not expose axis keys, trajectory or horizon values, scores, confidence badges, feature IDs, Memory IDs, or repeated revenue/gross-margin cards in public copy.",
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
    headline: "string stating where this business is heading and what that turns on",
    thesis: "string arguing that direction from the axes below",
    internalTrajectories: COMPANY_TRAJECTORY_KEYS.map((key) => ({
      key,
      trajectory: COMPANY_TRAJECTORY_STATES.join("|"),
      horizon: COMPANY_TRAJECTORY_HORIZONS.join("|"),
      mechanism: "string naming the causal chain that moves this axis over the horizon",
      claim: "string stating what will be true over that horizon",
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
  type Trajectory = CompanyAnalysisDecision["internalTrajectories"][number];
  const trajectories = Array.isArray(root?.internalTrajectories) ? root.internalTrajectories.flatMap((raw): Trajectory[] => {
    const axis = record(raw);
    const key = COMPANY_TRAJECTORY_KEYS.find((candidate) => candidate === axis?.key);
    const trajectory = COMPANY_TRAJECTORY_STATES.find((candidate) => candidate === axis?.trajectory);
    const horizon = COMPANY_TRAJECTORY_HORIZONS.find((candidate) => candidate === axis?.horizon);
    const mechanism = string(axis?.mechanism, 800);
    const claim = string(axis?.claim, 1_000);
    const evidenceRefs = refs(axis?.evidenceRefs, allowed);
    const falsifier = string(axis?.falsifier, 500);
    const nextCheck = string(axis?.nextCheck, 500);
    // `nextCheck` is asked of every axis, including one that could not be assessed: there, it is
    // what would make it assessable. The rest is required only of an axis making a claim — demanding
    // a mechanism for something the evidence could not show would push the model to invent one, or
    // to drop the axis and fail the five-axis coverage check. Both are worse than an honest
    // unobserved, which the prompt asks for and this must not punish.
    if (!key || !trajectory || !horizon || !nextCheck) return [];
    if (trajectory === "unobserved") {
      return [{ key, trajectory, horizon: "unobserved", mechanism, claim, evidenceRefs, falsifier, nextCheck }];
    }
    if (!mechanism || !claim || !falsifier || !evidenceRefs.length || horizon === "unobserved") return [];
    return [{ key, trajectory, horizon, mechanism, claim, evidenceRefs, falsifier, nextCheck }];
  }) : [];
  const byKey = new Map(trajectories.map((axis) => [axis.key, axis]));
  const internalTrajectories = COMPANY_TRAJECTORY_KEYS.map((key) => byKey.get(key)).filter(Boolean) as CompanyAnalysisDecision["internalTrajectories"];
  const selectedEvidenceRefs = refs(root?.selectedEvidenceRefs, allowed);
  const decision = {
    headline: string(root?.headline, 180),
    thesis: string(root?.thesis, 1_800),
    internalTrajectories,
    selectedEvidenceRefs,
  };
  if (!decision.headline || !decision.thesis || internalTrajectories.length !== COMPANY_TRAJECTORY_KEYS.length || !selectedEvidenceRefs.length) {
    throw new Error("Company analysis decision is invalid.");
  }
  // Covering all five axes says nothing about having seen anything: five `unobserved` axes satisfy
  // the count. The editorial phase is then asked for judgments built on axis mechanisms with no
  // mechanism on file, and its evidence check passes anyway — refs only have to belong to
  // selectedEvidenceRefs, which are features, not conclusions. So it would invent, publishably.
  // Each highlight rests on one observed axis, so the floor is the minimum highlight count.
  const observed = internalTrajectories.filter((axis) => axis.trajectory !== "unobserved");
  if (observed.length < COMPANY_ANALYSIS_MIN_HIGHLIGHTS) {
    throw new Error(
      `Company analysis decision observed ${observed.length} of ${COMPANY_TRAJECTORY_KEYS.length} axes; ${COMPANY_ANALYSIS_MIN_HIGHLIGHTS} are needed to publish a forward view.`,
    );
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
