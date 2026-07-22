import { canonicalUnderlying, type PortfolioSnapshotV1 } from "./portfolio-snapshot.ts";

export type StockHoldingView = {
  symbol: string;
  name: string;
  averageCost: number;
  actualCost: number;
  quantity: number;
  weight: number;
  unrealized: number;
  realized: number;
  price: number;
  value: number;
  cost: number;
};

export type OptionContractView = {
  symbol: string;
  contract: string;
  quantity: number;
  averageCost: number;
  price: number;
  cost: number;
  marketValue: number;
  weight: number;
  unrealized: number;
};

export type PositionGroupView = {
  symbol: string;
  name: string;
  stock?: StockHoldingView;
  options: OptionContractView[];
  value: number;
  cost: number;
  unrealized: number;
  realized: number;
  netPnl: number;
  weight: number;
  grossValue: number;
};

export function buildPortfolioViewModel(snapshot: PortfolioSnapshotV1) {
  const snapshotYear = new Date(snapshot.generatedAt).getUTCFullYear();
  const realizedBySymbolAndType = snapshot.trades.reduce<Record<string, { stock: number; options: number }>>((totals, trade) => {
    if (new Date(trade.tradeTime).getUTCFullYear() !== snapshotYear) return totals;
    if (trade.securityType !== "STK" && trade.securityType !== "OPT") return totals;
    const symbol = canonicalUnderlying(trade.symbol);
    totals[symbol] ??= { stock: 0, options: 0 };
    if (trade.securityType === "STK") totals[symbol].stock += trade.realizedPnl;
    else totals[symbol].options += trade.realizedPnl;
    return totals;
  }, {});
  const companyNames = snapshot.trades.reduce<Record<string, string>>((names, trade) => {
    names[canonicalUnderlying(trade.symbol)] ??= trade.contractDescription;
    return names;
  }, {});
  const holdings: StockHoldingView[] = snapshot.positions
    .filter((position) => position.assetClass === "STK")
    .map((position) => {
      const realized = realizedBySymbolAndType[position.symbol]?.stock ?? 0;
      return {
        symbol: position.symbol,
        name: companyNames[position.symbol] ?? position.contractDescription,
        averageCost: position.averagePrice,
        actualCost: position.quantity === 0 ? 0 : (position.costBasis - realized) / position.quantity,
        quantity: position.quantity,
        weight: (position.marketValue / snapshot.account.netLiquidation) * 100,
        unrealized: position.unrealizedPnl,
        realized,
        price: position.marketPrice,
        value: position.marketValue,
        cost: position.costBasis,
      };
    })
    .sort((left, right) => right.value - left.value);
  const optionContracts: OptionContractView[] = snapshot.positions
    .filter((position) => position.assetClass === "OPT")
    .map((position) => ({
      symbol: position.symbol,
      contract: position.contractDescription,
      quantity: position.quantity,
      averageCost: position.averagePrice,
      price: position.marketPrice,
      cost: position.costBasis,
      marketValue: position.marketValue,
      weight: (position.marketValue / snapshot.account.netLiquidation) * 100,
      unrealized: position.unrealizedPnl,
    }));
  const positionGroups: PositionGroupView[] = [...new Set([...holdings.map((holding) => holding.symbol), ...optionContracts.map((option) => option.symbol)])]
    .map((symbol) => {
      const stock = holdings.find((holding) => holding.symbol === symbol);
      const options = optionContracts.filter((option) => option.symbol === symbol);
      const optionValue = options.reduce((sum, option) => sum + option.marketValue, 0);
      const optionCost = options.reduce((sum, option) => sum + option.cost, 0);
      const optionUnrealized = options.reduce((sum, option) => sum + option.unrealized, 0);
      const value = (stock?.value ?? 0) + optionValue;
      const cost = (stock?.cost ?? 0) + optionCost;
      const unrealized = (stock?.unrealized ?? 0) + optionUnrealized;
      const realizedBreakdown = realizedBySymbolAndType[symbol] ?? { stock: 0, options: 0 };
      const realized = realizedBreakdown.stock + realizedBreakdown.options;
      return {
        symbol,
        name: stock?.name ?? companyNames[symbol] ?? symbol,
        stock,
        options,
        value,
        cost,
        unrealized,
        realized,
        netPnl: unrealized + realized,
        weight: (value / snapshot.account.netLiquidation) * 100,
        grossValue: Math.abs(stock?.value ?? 0) + options.reduce((sum, option) => sum + Math.abs(option.marketValue), 0),
      };
    })
    .sort((left, right) => right.grossValue - left.grossValue);
  const stockMarketValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
  const optionMarketValue = optionContracts.reduce((sum, option) => sum + option.marketValue, 0);

  return {
    holdings,
    optionContracts,
    positionGroups,
    stockMarketValue,
    optionMarketValue,
    netPositionsValue: stockMarketValue + optionMarketValue,
  };
}

