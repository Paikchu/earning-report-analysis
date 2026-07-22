import { normalizeTicker } from "./symbol-directory.ts";

export const PLAN_ACTIONS = ["add", "reduce", "stop", "target"] as const;
export type PlanAction = typeof PLAN_ACTIONS[number];

export type PlanLevelInput = {
  id?: string;
  action: PlanAction;
  priceCents: number;
  sizeNote: string;
  triggerNote: string;
  sortOrder: number;
};

export type HoldingPlanInput = {
  holdingReason: string;
  levels: PlanLevelInput[];
};

export type ValidatedHoldingPlan = HoldingPlanInput & { ticker: string };
export type ValidationResult = { ok: true; value: ValidatedHoldingPlan } | { ok: false; error: string };

const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,13}$/;

export function validateHoldingPlanInput(rawTicker: string, rawInput: unknown): ValidationResult {
  const ticker = normalizeTicker(rawTicker);
  if (!TICKER_PATTERN.test(ticker)) return { ok: false, error: "Ticker 格式无效。" };
  if (!rawInput || typeof rawInput !== "object") return { ok: false, error: "计划内容无效。" };

  const input = rawInput as Partial<HoldingPlanInput>;
  const holdingReason = typeof input.holdingReason === "string" ? input.holdingReason.trim() : "";
  if (!holdingReason) return { ok: false, error: "请填写持仓原因。" };
  if (holdingReason.length > 5_000) return { ok: false, error: "持仓原因不能超过 5,000 字。" };
  if (!Array.isArray(input.levels)) return { ok: false, error: "规划点位格式无效。" };
  if (input.levels.length > 20) return { ok: false, error: "规划点位最多 20 条。" };

  const levels: PlanLevelInput[] = [];
  for (const [index, rawLevel] of input.levels.entries()) {
    if (!rawLevel || typeof rawLevel !== "object") return { ok: false, error: `第 ${index + 1} 条点位无效。` };
    const level = rawLevel as Partial<PlanLevelInput>;
    if (!PLAN_ACTIONS.includes(level.action as PlanAction)) return { ok: false, error: `第 ${index + 1} 条点位动作无效。` };
    if (!Number.isSafeInteger(level.priceCents) || (level.priceCents ?? 0) <= 0) return { ok: false, error: `第 ${index + 1} 条点位价格无效。` };
    const sizeNote = typeof level.sizeNote === "string" ? level.sizeNote.trim() : "";
    const triggerNote = typeof level.triggerNote === "string" ? level.triggerNote.trim() : "";
    if (sizeNote.length > 200 || triggerNote.length > 500) return { ok: false, error: `第 ${index + 1} 条点位内容过长。` };
    levels.push({
      id: typeof level.id === "string" && level.id.length <= 100 ? level.id : undefined,
      action: level.action as PlanAction,
      priceCents: level.priceCents as number,
      sizeNote,
      triggerNote,
      sortOrder: index,
    });
  }

  return { ok: true, value: { ticker, holdingReason, levels } };
}

