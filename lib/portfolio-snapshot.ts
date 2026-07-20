export type TradeQueryPeriod = "DAYS_7" | "DAYS_30" | "DAYS_60" | "DAYS_90" | "YEAR_TO_DATE";
export type TradeSyncStatus = "current" | "delayed";
export type AssetClass = "STK" | "OPT";
export type SecurityType = "STK" | "OPT" | "FX" | string;

export interface PortfolioAccount {
  currency: "USD";
  netLiquidation: number;
  cashBalance: number;
  netDeposits: number;
}

export interface PortfolioPosition {
  positionKey: string;
  symbol: string;
  contractDescription: string;
  assetClass: AssetClass;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
}

export interface PortfolioTrade {
  tradeId: string;
  tradeTime: string;
  symbol: string;
  contractDescription: string;
  securityType: SecurityType;
  side: string;
  size: number;
  price: number;
  commission: number;
  netAmount: number;
  realizedPnl: number;
  exchange: string;
  orderId: string;
}

export interface PortfolioSnapshotV1 {
  schemaVersion: 1;
  generatedAt: string;
  account: PortfolioAccount;
  positions: PortfolioPosition[];
  trades: PortfolioTrade[];
  tradeSync: {
    status: TradeSyncStatus;
    queryPeriod: TradeQueryPeriod;
    lastSuccessfulTradeAt: string | null;
    message: string | null;
  };
}

export interface SnapshotSyncInput {
  generatedAt: string;
  account: Pick<PortfolioAccount, "netLiquidation" | "cashBalance">;
  positions: PortfolioPosition[];
  tradeSync:
    | { status: "current"; queryPeriod: TradeQueryPeriod; trades: PortfolioTrade[]; message?: null }
    | { status: "delayed"; queryPeriod: TradeQueryPeriod; message: string };
}

export interface IbkrPosition {
  asset_class?: string;
  average_price?: number;
  contract_description?: string;
  contract_id?: number;
  currency?: string;
  market_price?: number;
  market_value?: number;
  position?: number;
  unrealized_pnl?: number;
}

export interface IbkrTrade {
  commission?: number;
  company_name?: string;
  description?: string;
  exchange?: string;
  net_amount?: number;
  order_id?: number;
  price?: number;
  realized_pnl?: number;
  sec_type?: string;
  side?: string;
  size?: number;
  symbol?: string;
  trade_id?: string;
  trade_time?: string;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export function selectTradeQueryPeriod(lastSuccessfulTradeAt: string | null, now: string): TradeQueryPeriod {
  if (!lastSuccessfulTradeAt) return "YEAR_TO_DATE";

  const gapDays = Math.max(0, (Date.parse(now) - Date.parse(lastSuccessfulTradeAt)) / DAY_MS);
  if (!Number.isFinite(gapDays)) return "YEAR_TO_DATE";
  if (gapDays <= 7) return "DAYS_7";
  if (gapDays <= 30) return "DAYS_30";
  if (gapDays <= 60) return "DAYS_60";
  if (gapDays <= 90) return "DAYS_90";
  return "YEAR_TO_DATE";
}

export function canonicalUnderlying(symbol: string): string {
  return symbol.trim().toUpperCase().split(":").at(-1) ?? symbol.trim().toUpperCase();
}

export function normalizeIbkrPosition(position: IbkrPosition): PortfolioPosition {
  const assetClass = position.asset_class === "OPT" ? "OPT" : "STK";
  const description = position.contract_description?.trim() || "Unknown";
  const symbol = canonicalUnderlying(description.split(/\s+/)[0]);
  const quantity = position.position ?? 0;
  const averagePrice = position.average_price ?? 0;
  const multiplier = assetClass === "OPT" ? 100 : 1;

  return {
    positionKey: `${assetClass}:${position.contract_id ?? description}`,
    symbol,
    contractDescription: description,
    assetClass,
    quantity,
    averagePrice,
    marketPrice: position.market_price ?? 0,
    marketValue: position.market_value ?? 0,
    costBasis: averagePrice * quantity * multiplier,
    unrealizedPnl: position.unrealized_pnl ?? 0,
  };
}

export function normalizeIbkrTrade(trade: IbkrTrade): PortfolioTrade {
  if (!trade.trade_id || !trade.trade_time || !trade.symbol) {
    throw new Error("IBKR trade is missing its id, time, or symbol");
  }

  return {
    tradeId: trade.trade_id,
    tradeTime: new Date(trade.trade_time).toISOString(),
    symbol: canonicalUnderlying(trade.symbol),
    contractDescription: trade.company_name?.trim() || canonicalUnderlying(trade.symbol),
    securityType: trade.sec_type ?? "UNKNOWN",
    side: trade.side ?? "UNKNOWN",
    size: trade.size ?? 0,
    price: trade.price ?? 0,
    commission: trade.commission ?? 0,
    netAmount: trade.net_amount ?? 0,
    realizedPnl: trade.realized_pnl ?? 0,
    exchange: trade.exchange ?? "",
    orderId: trade.order_id === undefined ? "" : String(trade.order_id),
  };
}

export function mergeTrades(existing: PortfolioTrade[], incoming: PortfolioTrade[], year: number): PortfolioTrade[] {
  const byId = new Map(existing.map((item) => [item.tradeId, item]));
  for (const item of incoming) byId.set(item.tradeId, item);

  return [...byId.values()]
    .filter((item) => new Date(item.tradeTime).getUTCFullYear() === year)
    .sort((left, right) => right.tradeTime.localeCompare(left.tradeTime) || right.tradeId.localeCompare(left.tradeId));
}

export function realizedPnlByUnderlying(trades: PortfolioTrade[], year: number): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const item of trades) {
    if (new Date(item.tradeTime).getUTCFullYear() !== year) continue;
    if (item.securityType !== "STK" && item.securityType !== "OPT") continue;
    const symbol = canonicalUnderlying(item.symbol);
    totals[symbol] = (totals[symbol] ?? 0) + item.realizedPnl;
  }

  return Object.fromEntries(Object.entries(totals).map(([symbol, value]) => [symbol, Math.round(value * 100) / 100]));
}

export function buildPortfolioSnapshot(previous: PortfolioSnapshotV1, input: SnapshotSyncInput): PortfolioSnapshotV1 {
  if (!Number.isFinite(input.account.netLiquidation) || input.account.netLiquidation <= 0) {
    throw new Error("Net liquidation must be a positive number");
  }
  if (!Number.isFinite(input.account.cashBalance)) {
    throw new Error("Cash balance must be a finite number");
  }
  if (previous.positions.length > 0 && input.positions.length === 0) {
    throw new Error("Positions cannot become empty during an automated sync");
  }
  const positionsAreValid = input.positions.every((position) =>
    position.quantity !== 0 && [
      position.quantity,
      position.averagePrice,
      position.marketPrice,
      position.marketValue,
      position.costBasis,
      position.unrealizedPnl,
    ].every(Number.isFinite),
  );
  if (!positionsAreValid) {
    throw new Error("Position values must be finite and quantities must be non-zero");
  }

  const currentTradeSync = input.tradeSync.status === "current";
  const trades = currentTradeSync
    ? mergeTrades(previous.trades, input.tradeSync.trades, 2026)
    : previous.trades;
  const lastSuccessfulTradeAt = currentTradeSync
    ? trades[0]?.tradeTime ?? previous.tradeSync.lastSuccessfulTradeAt
    : previous.tradeSync.lastSuccessfulTradeAt;

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    account: {
      currency: "USD",
      netLiquidation: input.account.netLiquidation,
      cashBalance: input.account.cashBalance,
      netDeposits: 71_563.39,
    },
    positions: input.positions,
    trades,
    tradeSync: {
      status: input.tradeSync.status,
      queryPeriod: input.tradeSync.queryPeriod,
      lastSuccessfulTradeAt,
      message: input.tradeSync.status === "delayed" ? input.tradeSync.message : null,
    },
  };
}
