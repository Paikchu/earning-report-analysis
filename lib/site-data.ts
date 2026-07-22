import portfolioSnapshotData from "@/data/portfolio-snapshot.json";
import symbolDirectoryData from "@/data/us-securities.json";
import { buildPortfolioViewModel } from "@/lib/portfolio-view-model";
import type { PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";
import { normalizeTicker, type SymbolDirectoryEntry } from "@/lib/symbol-directory";

export const portfolioSnapshot = portfolioSnapshotData as PortfolioSnapshotV1;
export const portfolioViewModel = buildPortfolioViewModel(portfolioSnapshot);
export const symbolDirectory = symbolDirectoryData as { generatedAt: string; sourceUpdatedAt: string | null; securities: SymbolDirectoryEntry[] };
const directorySymbols = new Set(symbolDirectory.securities.map((security) => security.symbol));
export const symbolSearchEntries = [
  ...symbolDirectory.securities,
  ...portfolioViewModel.positionGroups
    .filter((group) => !directorySymbols.has(group.symbol))
    .map((group): SymbolDirectoryEntry => ({ symbol: group.symbol, name: group.name, exchange: "IBKR", type: "stock" })),
];

export function findSecurity(rawTicker: string): SymbolDirectoryEntry | null {
  const ticker = normalizeTicker(rawTicker);
  const held = portfolioViewModel.positionGroups.find((group) => group.symbol === ticker);
  const listed = symbolDirectory.securities.find((security) => security.symbol === ticker);
  if (held) return listed ? { ...listed, name: held.name } : { symbol: ticker, name: held.name, exchange: "IBKR", type: "stock" };
  return listed ?? null;
}
