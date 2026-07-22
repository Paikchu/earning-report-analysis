export type SymbolDirectoryEntry = {
  symbol: string;
  name: string;
  exchange: string;
  type: "stock" | "etf";
};

const OTHER_EXCHANGES: Record<string, string> = {
  A: "NYSE American",
  N: "NYSE",
  P: "NYSE Arca",
  Z: "Cboe BZX",
  V: "IEX",
};

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export function parseNasdaqListed(contents: string): SymbolDirectoryEntry[] {
  return rows(contents).flatMap((columns) => {
    const [symbol, name, , testIssue, , , etf] = columns;
    if (!symbol || !name || testIssue === "Y" || !isSupportedSecurity(name, etf)) return [];
    return [{ symbol: normalizeTicker(symbol), name: cleanName(name), exchange: "NASDAQ", type: etf === "Y" ? "etf" as const : "stock" as const }];
  });
}

export function parseOtherListed(contents: string): SymbolDirectoryEntry[] {
  return rows(contents).flatMap((columns) => {
    const [symbol, name, exchange, , etf, , testIssue] = columns;
    if (!symbol || !name || testIssue === "Y" || !isSupportedSecurity(name, etf)) return [];
    return [{
      symbol: normalizeTicker(symbol),
      name: cleanName(name),
      exchange: OTHER_EXCHANGES[exchange] ?? exchange,
      type: etf === "Y" ? "etf" as const : "stock" as const,
    }];
  });
}

export function mergeSymbolDirectories(...directories: SymbolDirectoryEntry[][]): SymbolDirectoryEntry[] {
  const bySymbol = new Map<string, SymbolDirectoryEntry>();
  for (const entry of directories.flat()) bySymbol.set(entry.symbol, entry);
  return [...bySymbol.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function searchSecurities(
  entries: SymbolDirectoryEntry[],
  rawQuery: string,
  heldSymbols: Set<string>,
  limit = 10,
): Array<SymbolDirectoryEntry & { isHeld: boolean }> {
  const query = normalizeTicker(rawQuery);
  if (!query) return [];
  return entries
    .map((entry) => ({ entry, rank: matchRank(entry, query), isHeld: heldSymbols.has(entry.symbol) }))
    .filter((result) => result.rank < 9)
    .sort((left, right) => Number(right.isHeld) - Number(left.isHeld) || left.rank - right.rank || left.entry.symbol.localeCompare(right.entry.symbol))
    .slice(0, limit)
    .map(({ entry, isHeld }) => ({ ...entry, isHeld }));
}

function rows(contents: string): string[][] {
  return contents
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line && !line.startsWith("File Creation Time:"))
    .map((line) => line.split("|"));
}

function cleanName(value: string): string {
  return value.replace(/\s+-\s+(Common Stock|Ordinary Shares)$/i, "").trim();
}

function isSupportedSecurity(name: string, etf: string): boolean {
  if (etf === "Y") return true;
  return !/\b(warrants?|rights?|units?)\b/i.test(name);
}

function matchRank(entry: SymbolDirectoryEntry, query: string): number {
  const name = entry.name.toUpperCase();
  if (entry.symbol === query) return 0;
  if (entry.symbol.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  if (name.includes(query)) return 3;
  return 9;
}
