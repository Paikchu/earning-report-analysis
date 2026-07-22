import snapshotData from "@/data/portfolio-snapshot.json";
import { canonicalUnderlying, type PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";

const snapshot = snapshotData as PortfolioSnapshotV1;
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
  names[trade.symbol] ??= trade.contractDescription;
  return names;
}, {});
const holdings = snapshot.positions
  .filter((position) => position.assetClass === "STK")
  .map((position) => ({
    symbol: position.symbol,
    name: companyNames[position.symbol] ?? position.contractDescription,
    averageCost: position.averagePrice,
    quantity: position.quantity,
    weight: (position.marketValue / snapshot.account.netLiquidation) * 100,
    unrealized: position.unrealizedPnl,
    realized: realizedBySymbolAndType[position.symbol]?.stock ?? 0,
    price: position.marketPrice,
    value: position.marketValue,
    cost: position.costBasis,
  }))
  .sort((left, right) => right.value - left.value);
const optionContracts = snapshot.positions
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
const positionGroups = [...new Set([...holdings.map((holding) => holding.symbol), ...optionContracts.map((option) => option.symbol)])]
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
const allocation = positionGroups.filter((group) => group.weight > 0).slice(0, 4).map((group) => [group.symbol, group.weight] as const);
const totalPnl = snapshot.account.netLiquidation - snapshot.account.netDeposits;
const stockMarketValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
const optionMarketValue = optionContracts.reduce((sum, option) => sum + option.marketValue, 0);
const netPositionsValue = stockMarketValue + optionMarketValue;
const topFourWeight = allocation.reduce((sum, [, weight]) => sum + weight, 0);
const topTwoWeight = positionGroups.filter((group) => group.weight > 0).slice(0, 2).reduce((sum, group) => sum + group.weight, 0);
const allocationStops = allocation
  .map(([, weight]) => weight)
  .reduce<number[]>((stops, weight) => [...stops, (stops.at(-1) ?? 0) + weight], []);
const donutBackground = `conic-gradient(var(--ink) 0 ${allocationStops[0] ?? 0}%, #718196 ${allocationStops[0] ?? 0}% ${allocationStops[1] ?? 0}%, var(--vermilion) ${allocationStops[1] ?? 0}% ${allocationStops[2] ?? 0}%, #b47d64 ${allocationStops[2] ?? 0}% ${allocationStops[3] ?? 0}%, var(--paper-deep) ${allocationStops[3] ?? 0}% 100%)`;
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (value: number, sign = false) => {
  const prefix = value < 0 ? "−" : sign && value > 0 ? "+" : "";
  return `${prefix}${currencyFormatter.format(Math.abs(value))}`;
};

const formatNumber = (value: number, minimumFractionDigits = 0, maximumFractionDigits = 6) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits, maximumFractionDigits }).format(value);

const actualHoldingCost = (holding: (typeof holdings)[number]) =>
  (holding.cost - holding.realized) / holding.quantity;

function Pnl({ value, currency = true }: { value: number; currency?: boolean }) {
  const className = value < 0 ? "loss" : value > 0 ? "gain" : "muted";
  const prefix = value < 0 ? "−" : value > 0 ? "+" : "";
  const content = currency ? money(value, true) : `${prefix}${formatNumber(Math.abs(value), 2, 6)}`;
  return <span className={className}>{content}</span>;
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <main className="page-shell" id="main-content">
        <section className="hero" aria-labelledby="portfolio-title">
              <div className="portfolio-heading">
                <h1 id="portfolio-title">投资组合</h1>
                <span>{positionGroups.length} 个 Ticker · {holdings.length} 个正股 · {optionContracts.length} 份期权</span>
              </div>
              <div className="portfolio-summary" aria-label="组合摘要">
                <article className="summary-item summary-nav"><span>当前净值</span><strong>{money(snapshot.account.netLiquidation)}</strong></article>
                <article className="summary-item"><span>净入金</span><strong>{money(snapshot.account.netDeposits)}</strong></article>
                <article className="summary-item"><span>总盈亏</span><strong className={totalPnl < 0 ? "loss" : "gain"}>{money(totalPnl, true)}</strong></article>
                <article className="summary-item"><span>现金</span><strong>{money(snapshot.account.cashBalance)}</strong></article>
              </div>
        </section>

        <section className="lower-grid">
              <aside className="allocation-panel">
                <h2>仓位构成</h2>
                <div className="allocation-wrap">
                  <div className="donut" style={{ background: donutBackground }} role="img" aria-label={`前四大持仓占组合 ${topFourWeight.toFixed(2)}%`}><span>{topFourWeight.toFixed(1)}%<small>前四大持仓</small></span></div>
                  <div className="legend">
                    {allocation.map(([symbol, weight], index) => (
                      <div className={`legend-row legend-${index + 1}`} key={symbol}>
                        <span><i aria-hidden="true" />{symbol}</span><b>{weight.toFixed(2)}%</b>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="concentration-note"><strong>{topTwoWeight.toFixed(2)}%</strong><span>{positionGroups[0]?.symbol} 与 {positionGroups[1]?.symbol} 合计净权重</span></div>
              </aside>

              <section className="ledger-panel" aria-labelledby="ledger-title">
                <div className="ledger-heading">
                  <h2 id="ledger-title">投资账本</h2>
                </div>

                  <div className="ledger-content">
                    <div className="ledger-meta">
                      <span>持仓净市值 <strong>{money(netPositionsValue)}</strong></span>
                      <span>正股 <strong>{money(stockMarketValue)}</strong></span>
                      <span>期权 <strong>{money(optionMarketValue)}</strong></span>
                      <span>{positionGroups.length} 个 Ticker</span>
                    </div>
                    <div className="position-scroll" aria-label="按 Ticker 分类的持仓">
                      <div className="position-columns" aria-hidden="true">
                        <span>标的</span><span>构成</span><span>净市值</span><span>净权重</span><span>持仓成本</span><span>未实现盈亏</span><span>年内已实现</span><span>年内净盈亏</span><span />
                      </div>
                      <div className="position-list">
                        {positionGroups.map((group) => (
                          <details className="position-row" key={group.symbol}>
                            <summary>
                              <span className="position-identity"><strong className="symbol">{group.symbol}</strong><small className="company">{group.name}</small></span>
                              <span className="position-kinds" data-label="构成">
                                {group.stock && <i className="asset-pill stock-pill">正股</i>}
                                {group.options.length > 0 && <i className="asset-pill option-pill">{group.options.length} 期权</i>}
                              </span>
                              <span data-label="净市值">{money(group.value)}</span>
                              <span data-label="净权重">{formatNumber(group.weight, 2, 2)}%</span>
                              <span data-label="持仓成本">{money(group.cost)}</span>
                              <span data-label="未实现盈亏"><Pnl value={group.unrealized} /></span>
                              <span data-label="年内已实现"><Pnl value={group.realized} /></span>
                              <span data-label="年内净盈亏"><Pnl value={group.netPnl} /></span>
                              <span className="disclosure-mark" aria-hidden="true" />
                            </summary>
                            <div className="position-detail table-wrap" aria-label={`${group.symbol} 持仓明细`}>
                              <table className="instrument-table" aria-label={`${group.symbol} 正股与期权明细`}>
                                <thead><tr><th>类型</th><th>资产 / 合约</th><th>数量</th><th>现价</th><th>平均成本</th><th>实际成本</th><th>持仓成本</th><th>市值</th><th>权重</th><th>未实现盈亏</th></tr></thead>
                                <tbody>
                                  {group.stock && <tr><td className="instrument-type" data-label="类型"><span className="asset-pill stock-pill">正股</span></td><td className="instrument-name" data-label="资产 / 合约"><strong>{group.stock.name}</strong></td><td data-label="数量">{formatNumber(group.stock.quantity, 0, 4)}</td><td data-label="现价">{money(group.stock.price)}</td><td data-label="平均成本">{money(group.stock.averageCost)}</td><td data-label="实际成本">{money(actualHoldingCost(group.stock))}</td><td data-label="持仓成本">{money(group.stock.cost)}</td><td data-label="市值">{money(group.stock.value)}</td><td data-label="权重">{formatNumber(group.stock.weight, 2, 2)}%</td><td data-label="未实现盈亏"><Pnl value={group.stock.unrealized} /></td></tr>}
                                  {group.options.map((option) => <tr key={option.contract}><td className="instrument-type" data-label="类型"><span className="asset-pill option-pill">期权</span></td><td className="instrument-name" data-label="资产 / 合约"><strong className="option-contract">{option.contract}</strong></td><td data-label="数量">{formatNumber(option.quantity, 0, 4)}</td><td data-label="现价">{money(option.price)}</td><td data-label="平均成本">{money(option.averageCost)}</td><td className="muted" data-label="实际成本">—</td><td data-label="持仓成本">{money(option.cost)}</td><td data-label="市值">{money(option.marketValue)}</td><td data-label="权重">{formatNumber(option.weight, 2, 2)}%</td><td data-label="未实现盈亏"><Pnl value={option.unrealized} /></td></tr>)}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        ))}
                        {positionGroups.length === 0 && <p className="empty-state">当前快照没有持仓。</p>}
                      </div>
                    </div>
                  </div>
          </section>
        </section>
      </main>
    </>
  );
}
