import { canonicalUnderlying, type PortfolioSnapshotV1 } from "./portfolio-snapshot.ts";

export const HEATMAP_DOMAINS = {
  BOXX: "现金管理",
  MSFT: "AI / 企业软件",
  ORCL: "AI / 企业软件",
  NOW: "AI / 企业软件",
  NVDA: "半导体",
  DRAM: "半导体",
  AVGO: "半导体",
  MRVL: "半导体",
  TSLA: "智能汽车",
  RKLB: "太空与通信",
  NOK: "太空与通信",
  SPCX: "太空与通信",
  MSTR: "数字资产",
} as const satisfies Record<string, string>;

export const HEATMAP_DOMAIN_COLORS = {
  "现金管理": "#52718f",
  "AI / 企业软件": "#2e6fdb",
  "半导体": "#d27a1d",
  "智能汽车": "#c45235",
  "太空与通信": "#16888e",
  "数字资产": "#7654c6",
  "其他": "#68717b",
} as const;

export function heatmapDomain(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  return HEATMAP_DOMAINS[normalized as keyof typeof HEATMAP_DOMAINS] ?? "其他";
}

export function heatmapDomainColor(domain: string) {
  return HEATMAP_DOMAIN_COLORS[domain as keyof typeof HEATMAP_DOMAIN_COLORS] ?? HEATMAP_DOMAIN_COLORS.其他;
}

export function heatmapThemeColor(symbol: string) {
  return heatmapDomainColor(heatmapDomain(symbol));
}

export interface HeatmapHolding {
  symbol: string;
  company: string;
  domain: string;
  marketValue: number;
  portfolioWeight: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedRate: number;
}

export interface HeatmapGroup {
  domain: string;
  portfolioWeight: number;
  holdings: HeatmapHolding[];
}

export interface TreemapInput {
  id: string;
  weight: number;
}

export type HeatmapTileDensity = "full" | "compact" | "symbol-only";

export type TreemapRectangle<T extends TreemapInput> = T & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface HeatmapBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function heatmapTileDensity(width: number, height: number): HeatmapTileDensity {
  if (width < 32 || height < 28) return "symbol-only";
  if (width * height < 1_800 || width < 58 || height < 48) return "compact";
  return "full";
}

export function calculatePopoverPosition(
  plot: HeatmapBounds,
  tile: HeatmapBounds,
  popoverWidth = 236,
  popoverHeight = 132,
  edge = 8,
) {
  const width = Math.min(popoverWidth, plot.width - edge * 2);
  let left = tile.left - plot.left + tile.width;
  if (left + width > plot.width - edge) left = tile.left - plot.left - width;
  left = Math.min(Math.max(edge, left), plot.width - width - edge);
  const top = Math.min(
    Math.max(edge, tile.top - plot.top),
    plot.height - popoverHeight - edge,
  );
  return { left, top };
}

export function buildHeatmapHoldings(snapshot: PortfolioSnapshotV1): HeatmapHolding[] {
  const companyNames = snapshot.trades.reduce<Record<string, string>>((names, trade) => {
    if (trade.securityType === "STK") {
      names[canonicalUnderlying(trade.symbol)] ??= trade.contractDescription;
    }
    return names;
  }, {});

  return snapshot.positions
    .filter((position) => position.assetClass === "STK" && position.marketValue > 0)
    .map((position) => ({
      symbol: position.symbol,
      company: companyNames[position.symbol] ?? position.contractDescription,
      domain: heatmapDomain(position.symbol),
      marketValue: position.marketValue,
      portfolioWeight: position.marketValue / snapshot.account.netLiquidation * 100,
      costBasis: position.costBasis,
      unrealizedPnl: position.unrealizedPnl,
      unrealizedRate: position.costBasis === 0 ? 0 : position.unrealizedPnl / Math.abs(position.costBasis) * 100,
    }))
    .sort((left, right) => right.portfolioWeight - left.portfolioWeight);
}

export function groupHeatmapHoldings(holdings: HeatmapHolding[]): HeatmapGroup[] {
  const groups = new Map<string, HeatmapHolding[]>();
  for (const holding of holdings) {
    const group = groups.get(holding.domain) ?? [];
    group.push(holding);
    groups.set(holding.domain, group);
  }

  return [...groups.entries()]
    .map(([domain, groupHoldings]) => ({
      domain,
      portfolioWeight: groupHoldings.reduce((sum, holding) => sum + holding.portfolioWeight, 0),
      holdings: groupHoldings.sort((left, right) => right.portfolioWeight - left.portfolioWeight),
    }))
    .sort((left, right) => right.portfolioWeight - left.portfolioWeight);
}

export function layoutTreemap<T extends TreemapInput>(items: T[], width = 100, height = 100): TreemapRectangle<T>[] {
  const validItems = items.filter((item) => Number.isFinite(item.weight) && item.weight > 0);
  if (validItems.length === 0) return [];

  const totalWeight = validItems.reduce((sum, item) => sum + item.weight, 0);
  const scaled = validItems.map((item) => ({ item, area: item.weight / totalWeight * width * height }));
  type Bounds = { x: number; y: number; width: number; height: number };

  const placeRow = (row: typeof scaled, remaining: Bounds) => {
    const rowArea = row.reduce((sum, entry) => sum + entry.area, 0);
    const rectangles: TreemapRectangle<T>[] = [];
    if (remaining.width >= remaining.height) {
      const rowWidth = rowArea / remaining.height;
      let offsetY = remaining.y;
      for (const entry of row) {
        const itemHeight = entry.area / rowWidth;
        rectangles.push({ ...entry.item, x: remaining.x, y: offsetY, width: rowWidth, height: itemHeight });
        offsetY += itemHeight;
      }
      return {
        rectangles,
        remaining: { x: remaining.x + rowWidth, y: remaining.y, width: Math.max(0, remaining.width - rowWidth), height: remaining.height },
      };
    } else {
      const rowHeight = rowArea / remaining.width;
      let offsetX = remaining.x;
      for (const entry of row) {
        const itemWidth = entry.area / rowHeight;
        rectangles.push({ ...entry.item, x: offsetX, y: remaining.y, width: itemWidth, height: rowHeight });
        offsetX += itemWidth;
      }
      return {
        rectangles,
        remaining: { x: remaining.x, y: remaining.y + rowHeight, width: remaining.width, height: Math.max(0, remaining.height - rowHeight) },
      };
    }
  };

  const solve = (entries: typeof scaled, bounds: Bounds): { rectangles: TreemapRectangle<T>[]; score: number } => {
    if (entries.length === 0) return { rectangles: [], score: 1 };
    let best: { rectangles: TreemapRectangle<T>[]; score: number } | undefined;

    for (let rowLength = 1; rowLength <= entries.length; rowLength += 1) {
      const placed = placeRow(entries.slice(0, rowLength), bounds);
      const rest = solve(entries.slice(rowLength), placed.remaining);
      const score = Math.max(
        rest.score,
        ...placed.rectangles.map((rectangle) => {
          const aspect = Math.max(rectangle.width / rectangle.height, rectangle.height / rectangle.width);
          const targetPenalty = Math.max(0, 24 - Math.min(rectangle.width, rectangle.height)) * 100;
          return aspect + targetPenalty;
        }),
      );
      if (!best || score < best.score) {
        best = { rectangles: [...placed.rectangles, ...rest.rectangles], score };
      }
    }

    return best!;
  };

  return solve(scaled, { x: 0, y: 0, width, height }).rectangles;
}
