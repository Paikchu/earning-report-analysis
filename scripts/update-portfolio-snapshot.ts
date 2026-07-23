import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  upsertPortfolioHistory,
  type PortfolioHistoryPoint,
} from "../lib/portfolio-history.ts";
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
const historyPath = argument("--history", "data/portfolio-history.json")!;
const historyOutputPath = argument("--history-output", historyPath)!;
if (!inputPath) throw new Error("--input is required");

const [previous, raw, previousHistory] = await Promise.all([
  readFile(previousPath, "utf8").then((value) => JSON.parse(value) as PortfolioSnapshotV1),
  readFile(inputPath, "utf8").then((value) => JSON.parse(value) as RawSyncInput),
  readFile(historyPath, "utf8")
    .then((value) => JSON.parse(value) as PortfolioHistoryPoint[])
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }),
]);
const usdBalance = raw.balances.balances?.find((balance) => balance.currency === "USD");
const positions = (raw.positions.positions ?? [])
  .filter((position) => position.asset_class === "STK" || position.asset_class === "OPT")
  .map(normalizeIbkrPosition);
if (raw.tradeStatus === "current" && !Array.isArray(raw.trades?.trades)) {
  throw new Error("A trades response is required when tradeStatus is current");
}
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
const history = upsertPortfolioHistory(previousHistory, {
  generatedAt: snapshot.generatedAt,
  netLiquidation: snapshot.account.netLiquidation,
  netDeposits: snapshot.account.netDeposits,
});

const temporaryPath = join(dirname(outputPath), `.portfolio-snapshot-${process.pid}.tmp`);
const temporaryHistoryPath = join(dirname(historyOutputPath), `.portfolio-history-${process.pid}.tmp`);
await Promise.all([
  writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`),
  writeFile(temporaryHistoryPath, `${JSON.stringify(history, null, 2)}\n`),
]);
await Promise.all([
  rename(temporaryPath, outputPath),
  rename(temporaryHistoryPath, historyOutputPath),
]);
