import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  applyRegistrantForms,
  mergeSymbolDirectories,
  needsRegistrantCheck,
  normalizeTicker,
  parseNasdaqListed,
  parseOtherListed,
  type SymbolDirectoryEntry,
} from "../lib/symbol-directory.ts";

const NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";
const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions";
const USER_AGENT = "MAX-Investment-Record/1.0";
/** SEC 要求每秒不超过 10 次请求。 */
const SEC_REQUEST_INTERVAL_MS = 120;

const argument = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const nasdaqSource = argument("--nasdaq");
const otherSource = argument("--other");
const outputPath = argument("--output", "data/us-securities.json")!;
const skipRegistrantCheck = process.argv.includes("--skip-registrant-check");

const [nasdaqContents, otherContents] = await Promise.all([
  load(nasdaqSource, NASDAQ_URL),
  load(otherSource, OTHER_URL),
]);
const generatedAt = new Date().toISOString();
const sourceUpdatedAt = directoryTimestamp(nasdaqContents) ?? directoryTimestamp(otherContents);
const parsed = mergeSymbolDirectories(parseNasdaqListed(nasdaqContents), parseOtherListed(otherContents));
if (parsed.length === 0) throw new Error("Symbol directory is empty");
const securities = skipRegistrantCheck ? parsed : await resolveAmbiguousTypes(parsed);

const temporaryPath = join(dirname(outputPath), `.us-securities-${process.pid}.tmp`);
await writeFile(temporaryPath, `${JSON.stringify({ generatedAt, sourceUpdatedAt, securities })}\n`);
await rename(temporaryPath, outputPath);
report(securities);

async function load(filePath: string | undefined, remoteUrl: string): Promise<string> {
  if (filePath) return readFile(filePath, "utf8");
  return (await request(remoteUrl)).text();
}

async function request(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Request failed: ${url} ${response.status}`);
  return response;
}

/**
 * 名称含 trust/fund 的条目用 EDGAR 报送记录复核：BDC 与 REIT 归为 stock，封闭式基金归为 fund。
 * SEC 的 ticker 清单并不完整，查不到的条目保留按名称推断的结果，避免误伤在营公司。
 */
async function resolveAmbiguousTypes(entries: SymbolDirectoryEntry[]): Promise<SymbolDirectoryEntry[]> {
  const ambiguous = entries.filter(needsRegistrantCheck);
  const cikByTicker = await loadSecTickerMap();
  if (!cikByTicker) {
    console.warn(`Skipped registrant check for ${ambiguous.length} entries: SEC ticker map unavailable`);
    return entries;
  }

  const formsBySymbol = new Map<string, string[]>();
  let unresolved = 0;
  for (const entry of ambiguous) {
    const cik = cikByTicker.get(entry.symbol) ?? cikByTicker.get(entry.symbol.replace(".", "-"));
    const forms = cik ? await fetchRecentForms(cik) : null;
    if (forms) formsBySymbol.set(entry.symbol, forms);
    else unresolved += 1;
  }
  console.log(`Registrant check: ${ambiguous.length} ambiguous entries, ${unresolved} unresolved`);
  return entries.map((entry) => applyRegistrantForms(entry, formsBySymbol.get(entry.symbol) ?? null));
}

async function loadSecTickerMap(): Promise<Map<string, string> | null> {
  try {
    const payload = await (await request(SEC_TICKERS_URL)).json() as Record<string, { cik_str?: number; ticker?: string }>;
    const map = new Map<string, string>();
    for (const row of Object.values(payload)) {
      if (!row?.ticker || !Number.isFinite(row.cik_str)) continue;
      map.set(normalizeTicker(row.ticker), String(row.cik_str).padStart(10, "0"));
    }
    return map.size ? map : null;
  } catch (error) {
    console.warn(`SEC ticker map request failed: ${(error as Error).message}`);
    return null;
  }
}

async function fetchRecentForms(cik: string): Promise<string[] | null> {
  await new Promise((resolve) => setTimeout(resolve, SEC_REQUEST_INTERVAL_MS));
  try {
    const payload = await (await request(`${SEC_SUBMISSIONS_URL}/CIK${cik}.json`)).json() as { filings?: { recent?: { form?: unknown } } };
    const forms = payload.filings?.recent?.form;
    return Array.isArray(forms) ? forms.map(String) : null;
  } catch {
    return null;
  }
}

function report(securities: SymbolDirectoryEntry[]): void {
  const counts = new Map<string, number>();
  for (const security of securities) counts.set(security.type, (counts.get(security.type) ?? 0) + 1);
  const summary = [...counts].sort((left, right) => right[1] - left[1]).map(([type, count]) => `${type}=${count}`);
  console.log(`Wrote ${securities.length} securities to ${outputPath} (${summary.join(" ")})`);
}

function directoryTimestamp(contents: string): string | null {
  return contents.match(/^File Creation Time:\s*([^|\r\n]+)/m)?.[1]?.trim() ?? null;
}
