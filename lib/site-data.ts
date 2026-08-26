import symbolDirectoryData from "../data/us-securities.json" with { type: "json" };
import { normalizeTicker, searchSecurities, type SymbolDirectoryEntry } from "./symbol-directory.ts";

export const symbolDirectory = symbolDirectoryData as {
  generatedAt: string;
  sourceUpdatedAt: string | null;
  securities: SymbolDirectoryEntry[];
};

export const symbolSearchEntries = symbolDirectory.securities;

export function findSecurity(rawTicker: string): SymbolDirectoryEntry | null {
  const ticker = normalizeTicker(rawTicker);
  return symbolSearchEntries.find((security) => security.symbol === ticker) ?? null;
}

export function searchCompanyDirectory(rawQuery: string, limit = 8): SymbolDirectoryEntry[] {
  return searchSecurities(symbolSearchEntries, rawQuery, new Set(), limit).map(({ symbol, name, exchange, type }) => ({ symbol, name, exchange, type }));
}
