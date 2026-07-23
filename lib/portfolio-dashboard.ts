import type { PositionGroupView } from "./portfolio-view-model.ts";

export type PositionSortKey =
  | "symbol"
  | "value"
  | "weight"
  | "cost"
  | "unrealized"
  | "realized"
  | "netPnl";
export type SortDirection = "asc" | "desc";

const HOLDING_COLORS = [
  "#17324d",
  "#2f4f68",
  "#48677d",
  "#617f90",
  "#7894a1",
  "#385c72",
  "#557487",
  "#8199a3",
] as const;

export function holdingColor(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  let hash = 0;
  for (const character of normalized) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return HOLDING_COLORS[hash % HOLDING_COLORS.length];
}

export function buildAllocation(groups: PositionGroupView[]) {
  const sorted = [...groups].sort((left, right) => right.weight - left.weight);
  const leading = sorted.filter((group) => group.weight > 0).slice(0, 4);
  const leadingWeight = Number(leading.reduce((sum, group) => sum + group.weight, 0).toFixed(2));
  return {
    leading,
    leadingWeight,
    other: sorted.filter((group) => !leading.includes(group)),
    otherWeight: Number(Math.max(0, 100 - leadingWeight).toFixed(2)),
  };
}

export function sortPositionGroups(
  groups: PositionGroupView[],
  key: PositionSortKey = "weight",
  direction: SortDirection = "desc",
) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...groups].sort((left, right) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return leftValue.localeCompare(rightValue) * multiplier;
    }
    return (Number(leftValue) - Number(rightValue)) * multiplier;
  });
}

export function hasShortOption(group: PositionGroupView) {
  return group.options.some((option) => option.marketValue < 0);
}
