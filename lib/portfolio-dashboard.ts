import type { PositionGroupView } from "./portfolio-view-model.ts";
import { heatmapDomain, heatmapDomainColor } from "./portfolio-heatmap.ts";

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
  "#2e6fdb",
  "#d27a1d",
  "#c45235",
  "#7654c6",
  "#16888e",
  "#a4478d",
  "#4d9078",
  "#8a6a3d",
] as const;

export function holdingColor(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  let hash = 0;
  for (const character of normalized) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return HOLDING_COLORS[hash % HOLDING_COLORS.length];
}

export function allocationColor(index: number) {
  return HOLDING_COLORS[index % HOLDING_COLORS.length];
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

export function buildSectorAllocation(groups: PositionGroupView[]) {
  const weights = new Map<string, number>();
  for (const group of groups) {
    if (group.weight <= 0) continue;
    const domain = heatmapDomain(group.symbol);
    weights.set(domain, (weights.get(domain) ?? 0) + group.weight);
  }
  const sectors = [...weights.entries()]
    .map(([domain, weight]) => ({ domain, weight: Number(weight.toFixed(2)), color: heatmapDomainColor(domain) }))
    .sort((left, right) => right.weight - left.weight);
  const classifiedWeight = Number(sectors.reduce((sum, sector) => sum + sector.weight, 0).toFixed(2));
  return {
    sectors,
    classifiedWeight,
    unallocatedWeight: Number(Math.max(0, 100 - classifiedWeight).toFixed(2)),
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
