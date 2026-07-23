import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import type { PortfolioSnapshotV1 } from "../lib/portfolio-snapshot.ts";
import type { PortfolioHistoryPoint } from "../lib/portfolio-history.ts";

const execFileAsync = promisify(execFile);

test("the snapshot CLI normalizes IBKR responses and updates the versioned file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portfolio-snapshot-"));
  const previousPath = join(directory, "previous.json");
  const inputPath = join(directory, "input.json");
  const outputPath = join(directory, "output.json");
  const historyPath = join(directory, "history.json");
  const historyOutputPath = join(directory, "history-output.json");
  const previous: PortfolioSnapshotV1 = {
    schemaVersion: 1,
    generatedAt: "2026-07-19T00:00:00.000Z",
    account: { currency: "USD", netLiquidation: 67_000, cashBalance: 1_000, netDeposits: 71_563.39 },
    positions: [{ positionKey: "STK:NOK", symbol: "NOK", contractDescription: "NOK", assetClass: "STK", quantity: 200, averagePrice: 14.7, marketPrice: 10, marketValue: 2_000, costBasis: 2_940, unrealizedPnl: -940 }],
    trades: [{ tradeId: "trade-1", tradeTime: "2026-07-13T20:30:00.000Z", symbol: "NOK", contractDescription: "NOKIA", securityType: "OPT", side: "BUY", size: 1, price: 0.12, commission: 0.65, netAmount: 12, realizedPnl: 80, exchange: "SMART", orderId: "1" }],
    tradeSync: { status: "current", queryPeriod: "DAYS_7", lastSuccessfulTradeAt: "2026-07-13T20:30:00.000Z", message: null },
  };
  const input = {
    generatedAt: "2026-07-20T00:00:00.000Z",
    summary: { net_liquidation: 68_000 },
    balances: { balances: [{ currency: "USD", cash_balance: 1_500 }] },
    positions: { positions: [{ asset_class: "STK", contract_id: 661513, contract_description: "NOK", position: 200, average_price: 14.7, market_price: 10.2, market_value: 2_040, unrealized_pnl: -900 }] },
    trades: { trades: [{ trade_id: "trade-1", trade_time: "2026-07-13T20:30:00Z", symbol: "NOK", company_name: "NOKIA", sec_type: "OPT", side: "BUY", size: 1, price: 0.12, commission: 0.65, net_amount: 12, realized_pnl: 83.91, exchange: "SMART", order_id: 1 }] },
    tradeStatus: "current",
    queryPeriod: "DAYS_7",
  };

  await Promise.all([
    writeFile(previousPath, JSON.stringify(previous)),
    writeFile(inputPath, JSON.stringify(input)),
    writeFile(historyPath, JSON.stringify([{
      date: "2026-07-19",
      generatedAt: previous.generatedAt,
      netLiquidation: previous.account.netLiquidation,
      netDeposits: previous.account.netDeposits,
    }] satisfies PortfolioHistoryPoint[])),
  ]);
  await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    "scripts/update-portfolio-snapshot.ts",
    "--previous", previousPath,
    "--input", inputPath,
    "--output", outputPath,
    "--history", historyPath,
    "--history-output", historyOutputPath,
  ], { cwd: new URL("../", import.meta.url) });

  const result = JSON.parse(await readFile(outputPath, "utf8")) as PortfolioSnapshotV1;
  const history = JSON.parse(await readFile(historyOutputPath, "utf8")) as PortfolioHistoryPoint[];
  assert.equal(result.account.netLiquidation, 68_000);
  assert.equal(result.account.cashBalance, 1_500);
  assert.equal(result.positions[0].positionKey, "STK:661513");
  assert.equal(result.trades[0].realizedPnl, 83.91);
  assert.deepEqual(history.map((point) => point.date), ["2026-07-19", "2026-07-20"]);
  assert.equal(history.at(-1)?.netLiquidation, 68_000);
});

test("the snapshot CLI rejects a current trade status without a trades response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portfolio-snapshot-missing-trades-"));
  const previousPath = join(directory, "previous.json");
  const inputPath = join(directory, "input.json");
  const outputPath = join(directory, "output.json");
  const previous = JSON.parse(await readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8"));
  const input = {
    generatedAt: "2026-07-20T00:00:00.000Z",
    summary: { net_liquidation: 68_000 },
    balances: { balances: [{ currency: "USD", cash_balance: 1_500 }] },
    positions: { positions: [{ asset_class: "STK", contract_id: 661513, contract_description: "NOK", position: 200, average_price: 14.7, market_price: 10.2, market_value: 2_040, unrealized_pnl: -900 }] },
    tradeStatus: "current",
    queryPeriod: "DAYS_7",
  };
  await Promise.all([writeFile(previousPath, JSON.stringify(previous)), writeFile(inputPath, JSON.stringify(input))]);

  await assert.rejects(
    execFileAsync(process.execPath, ["--experimental-strip-types", "scripts/update-portfolio-snapshot.ts", "--previous", previousPath, "--input", inputPath, "--output", outputPath], { cwd: new URL("../", import.meta.url) }),
    /trades response is required/i,
  );
});
