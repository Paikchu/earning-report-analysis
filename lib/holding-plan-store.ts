import type { PlanAction, PlanLevelInput, ValidatedHoldingPlan } from "./holding-plan.ts";

type BoundStatement = unknown;
type BatchDatabase = {
  prepare(sql: string): { bind(...values: unknown[]): BoundStatement };
  batch(statements: BoundStatement[]): Promise<unknown>;
};
type ReadDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
};

export type HoldingPlanRecord = {
  id: string;
  ticker: string;
  companyName: string;
  holdingReason: string;
  levels: Array<Required<Pick<PlanLevelInput, "id">> & PlanLevelInput>;
  updatedAt: string;
};

export async function getHoldingPlan(database: ReadDatabase, ownerEmail: string, ticker: string): Promise<HoldingPlanRecord | null> {
  const normalizedOwner = normalizeOwnerEmail(ownerEmail);
  const plan = await database.prepare(`
    SELECT id, ticker, company_name AS companyName, holding_reason AS holdingReason, updated_at AS updatedAt
    FROM holding_plans WHERE owner_email = ? AND ticker = ?
  `).bind(normalizedOwner, ticker).first<Omit<HoldingPlanRecord, "levels">>();
  if (!plan) return null;
  const result = await database.prepare(`
    SELECT id, action, price_cents AS priceCents, size_note AS sizeNote, trigger_note AS triggerNote, sort_order AS sortOrder
    FROM plan_levels WHERE plan_id = ? ORDER BY sort_order, id
  `).bind(plan.id).all<{ id: string; action: PlanAction; priceCents: number; sizeNote: string; triggerNote: string; sortOrder: number }>();
  return { ...plan, levels: result.results };
}

export async function saveHoldingPlan(
  database: BatchDatabase,
  ownerEmail: string,
  companyName: string,
  input: ValidatedHoldingPlan,
): Promise<HoldingPlanRecord> {
  const normalizedOwner = normalizeOwnerEmail(ownerEmail);
  const id = await stablePlanId(normalizedOwner, input.ticker);
  const updatedAt = new Date().toISOString();
  const levels = input.levels.map((level) => ({ ...level, id: level.id ?? crypto.randomUUID() }));
  const statements: BoundStatement[] = [
    database.prepare(`
      INSERT INTO holding_plans (id, owner_email, ticker, company_name, holding_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_email, ticker) DO UPDATE SET
        company_name = excluded.company_name,
        holding_reason = excluded.holding_reason,
        updated_at = excluded.updated_at
    `).bind(id, normalizedOwner, input.ticker, companyName, input.holdingReason, updatedAt, updatedAt),
    database.prepare("DELETE FROM plan_levels WHERE plan_id = ?").bind(id),
    ...levels.map((level) => database.prepare(`
      INSERT INTO plan_levels (id, plan_id, action, price_cents, size_note, trigger_note, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(level.id, id, level.action, level.priceCents, level.sizeNote, level.triggerNote, level.sortOrder)),
  ];
  await database.batch(statements);
  return { id, ticker: input.ticker, companyName, holdingReason: input.holdingReason, levels, updatedAt };
}

async function stablePlanId(ownerEmail: string, ticker: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ownerEmail}\n${ticker}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeOwnerEmail(value: string): string {
  return value.trim().toLowerCase();
}
