import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildPortfolioSnapshot,
  normalizeIbkrPosition,
  normalizeIbkrTrade,
  type IbkrPosition,
  type IbkrTrade,
  type PortfolioSnapshotV1,
  type TradeQueryPeriod,
} from "../lib/portfolio-snapshot.ts";

interface RawSyncInput {
  generatedAt?: string;
  summary: { net_liquidation?: number };
  balances: { balances?: Array<{ currency?: string; cash_balance?: number }> };
  positions: { positions?: IbkrPosition[] };
  trades?: { trades?: IbkrTrade[] };
  tradeStatus: "current" | "delayed";
  queryPeriod: TradeQueryPeriod;
  tradeMessage?: string;
}

const argument = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const previousPath = argument("--previous", "data/portfolio-snapshot.json")!;
const inputPath = argument("--input");
const outputPath = argument("--output", "data/portfolio-snapshot.json")!;
if (!inputPath) throw new Error("--input is required");

const [previous, raw] = await Promise.all([
  readFile(previousPath, "utf8").then((value) => JSON.parse(value) as PortfolioSnapshotV1),
  readFile(inputPath, "utf8").then((value) => JSON.parse(value) as RawSyncInput),
]);
const usdBalance = raw.balances.balances?.find((balance) => balance.currency === "USD");
const positions = (raw.positions.positions ?? [])
  .filter((position) => position.asset_class === "STK" || position.asset_class === "OPT")
  .map(normalizeIbkrPosition);
const tradeSync = raw.tradeStatus === "current"
  ? { status: "current" as const, queryPeriod: raw.queryPeriod, trades: (raw.trades?.trades ?? []).map(normalizeIbkrTrade) }
  : { status: "delayed" as const, queryPeriod: raw.queryPeriod, message: raw.tradeMessage ?? "IBKR trades unavailable" };
const snapshot = buildPortfolioSnapshot(previous, {
  generatedAt: raw.generatedAt ?? new Date().toISOString(),
  account: {
    netLiquidation: raw.summary.net_liquidation ?? Number.NaN,
    cashBalance: usdBalance?.cash_balance ?? Number.NaN,
  },
  positions,
  tradeSync,
});

const temporaryPath = join(dirname(outputPath), `.portfolio-snapshot-${process.pid}.tmp`);
await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
await rename(temporaryPath, outputPath);
