export type SecurityType = "stock" | "etf" | "etn" | "fund" | "preferred" | "bond";

export type SymbolDirectoryEntry = {
  symbol: string;
  name: string;
  exchange: string;
  type: SecurityType;
};

export const SECURITY_TYPES: readonly SecurityType[] = ["stock", "etf", "etn", "fund", "preferred", "bond"];

/** 搜索框默认只返回普通股，ETF、封闭式基金、优先股、债券类证券需要显式声明。 */
export const DEFAULT_SEARCH_TYPES: readonly SecurityType[] = ["stock"];

const OTHER_EXCHANGES: Record<string, string> = {
  A: "NYSE American",
  N: "NYSE",
  P: "NYSE Arca",
  Z: "Cboe BZX",
  V: "IEX",
};

/** 交易所文件里用 $ 后缀表示同一发行人的优先股系列，例如 ABR$D。 */
const PREFERRED_SYMBOL = "$";
const PREFERRED_NAME = /\bpreferred\b|\bpreference (?:shares?|stock)\b/i;
const ETN_NAME = /\bETNs?\b|\bexchange[- ]traded notes?\b/i;
const DEBT_NAME = /\b(?:notes?|debentures?|bonds?)\b/i;
const DEBT_TERMS = /\bdue\b|\d(?:\.\d+)?\s?%/;
const STRUCTURED_DEBT_NAME = /\b(?:capital|trust) securities\b|\btrust certificates?\b|\bcapital trust\b|\bSTRATS\b|\bCorTS\b|asset[- ]backed/i;
const FUND_NAME = /\bclosed[- ]end fund\b|\bfunds?\b/i;
const INVESTMENT_COMPANY_FORM = /^(?:N-CSR|NPORT|N-CEN)/i;

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export function parseNasdaqListed(contents: string): SymbolDirectoryEntry[] {
  return rows(contents).flatMap((columns) => {
    const [symbol, name, , testIssue, , , etf] = columns;
    if (!symbol || !name || testIssue === "Y" || !isSupportedSecurity(name, etf)) return [];
    return [{ symbol: normalizeTicker(symbol), name: cleanName(name), exchange: "NASDAQ", type: classifySecurity(symbol, name, etf) }];
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
      type: classifySecurity(symbol, name, etf),
    }];
  });
}

export function mergeSymbolDirectories(...directories: SymbolDirectoryEntry[][]): SymbolDirectoryEntry[] {
  const bySymbol = new Map<string, SymbolDirectoryEntry>();
  for (const entry of directories.flat()) bySymbol.set(entry.symbol, entry);
  return [...bySymbol.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

/**
 * 交易所目录只提供 ETF 标记，其余非普通股证券要靠代码后缀和证券全称识别：
 * 优先股带 $ 后缀或写明 preferred，小额债券写明利率与到期年份，封闭式基金写明 fund。
 */
export function classifySecurity(symbol: string, name: string, etf: string): SecurityType {
  if (etf === "Y") return "etf";
  if (ETN_NAME.test(name)) return "etn";
  if (symbol.includes(PREFERRED_SYMBOL) || PREFERRED_NAME.test(name)) return "preferred";
  if (STRUCTURED_DEBT_NAME.test(name) || (DEBT_NAME.test(name) && DEBT_TERMS.test(name))) return "bond";
  if (FUND_NAME.test(name)) return "fund";
  return "stock";
}

/**
 * 名称里带 trust / fund / beneficial interest 的条目，光看名字分不清 REIT、BDC 与封闭式基金
 * （Arbor Realty Trust 是股票，BlackRock Income Trust 是基金），交给 EDGAR 报送表格定夺。
 */
export function needsRegistrantCheck(entry: SymbolDirectoryEntry): boolean {
  return (entry.type === "stock" || entry.type === "fund") && /\btrusts?\b|\bfunds?\b|beneficial interest/i.test(entry.name);
}

/**
 * 注册投资公司按 N-CSR / NPORT / N-CEN 报送，经营主体（含 REIT 与按 10-K 报送的 BDC）不报这些表格，
 * 这比证券全称更可靠：Ares Capital 名称写着 Closed End Fund 却报 10-K，属于股票。
 */
export function applyRegistrantForms(entry: SymbolDirectoryEntry, forms: readonly string[] | null): SymbolDirectoryEntry {
  if (!forms || !needsRegistrantCheck(entry)) return entry;
  const type = forms.some((form) => INVESTMENT_COMPANY_FORM.test(form)) ? "fund" : "stock";
  return type === entry.type ? entry : { ...entry, type };
}

export function parseSecurityTypes(value: string | null | undefined): readonly SecurityType[] {
  const requested = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is SecurityType => (SECURITY_TYPES as readonly string[]).includes(entry));
  return requested.length ? [...new Set(requested)] : DEFAULT_SEARCH_TYPES;
}

export function searchSecurities(
  entries: SymbolDirectoryEntry[],
  rawQuery: string,
  heldSymbols: Set<string>,
  limit = 10,
  types: readonly SecurityType[] = DEFAULT_SEARCH_TYPES,
): Array<SymbolDirectoryEntry & { isHeld: boolean }> {
  const query = normalizeTicker(rawQuery);
  if (!query) return [];
  const allowedTypes = new Set(types);
  return entries
    .filter((entry) => allowedTypes.has(entry.type))
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
