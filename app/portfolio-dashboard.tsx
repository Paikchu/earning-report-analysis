"use client";

import { useMemo, useState, type CSSProperties } from "react";

import {
  buildAllocation,
  holdingColor,
  sortPositionGroups,
  type PositionSortKey,
  type SortDirection,
} from "@/lib/portfolio-dashboard";
import { buildEarningsReminder, isUpcomingEarnings, type EarningsEvent } from "@/lib/earnings-calendar";
import { money, number, percent } from "@/lib/portfolio-format";
import { heatmapThemeColor, type HeatmapHolding } from "@/lib/portfolio-heatmap";
import type { PositionGroupView } from "@/lib/portfolio-view-model";
import { AddPlanDialog } from "./AddPlanDialog";
import { PortfolioHeatmap } from "./portfolio-heatmap";
import { PositionDetailDialog, type PositionDetailTarget } from "./PositionDetailDialog";
import { useMarketQuotes, type QuoteLoadStatus } from "./use-market-quotes";
import type { MarketQuoteMap } from "@/lib/yahoo-quotes";

function Pnl({ value }: { value: number }) {
  const className = value < 0 ? "loss" : value > 0 ? "gain" : "muted";
  return <span className={className}>{money(value, true)}</span>;
}

function PortfolioHeader({
  netLiquidation,
  totalPnl,
  totalPnlRate,
  netLiquidationWithoutOptionPnl,
  netDeposits,
  cashBalance,
  netPositionsValue,
  stockMarketValue,
  optionMarketValue,
  nextEarnings,
  nextEarningsReminder,
}: {
  netLiquidation: number;
  totalPnl: number;
  totalPnlRate: number;
  netLiquidationWithoutOptionPnl: number;
  netDeposits: number;
  cashBalance: number;
  netPositionsValue: number;
  stockMarketValue: number;
  optionMarketValue: number;
  nextEarnings?: EarningsEvent;
  nextEarningsReminder: ReturnType<typeof buildEarningsReminder> | null;
}) {
  return (
    <header className="portfolio-header" aria-labelledby="portfolio-title">
      <div className="hero">
        <div className="portfolio-heading">
          <h1 id="portfolio-title">投资组合</h1>
          <span className="summary-nav-label">当前净值</span>
          <strong className="summary-nav-value">{money(netLiquidation)}</strong>
          <span className={`pnl-pill ${totalPnl < 0 ? "loss" : totalPnl > 0 ? "gain" : "muted"}`}>
            {money(totalPnl, true)}（{percent(totalPnlRate, true)}）
          </span>
        </div>
        <div className="summary-support" aria-label="组合摘要">
          <article><span>剔除期权浮盈亏</span><strong>{money(netLiquidationWithoutOptionPnl)}</strong></article>
          <article><span>净入金</span><strong>{money(netDeposits)}</strong></article>
          <article><span>现金</span><strong>{money(cashBalance)}</strong></article>
        </div>
      </div>
      <section className="header-position-summary" aria-label="持仓摘要">
        <article><span>持仓净市值</span><strong>{money(netPositionsValue)}</strong></article>
        <article><span>正股</span><strong>{money(stockMarketValue)}</strong></article>
        <article><span>期权</span><strong>{money(optionMarketValue)}</strong></article>
        {nextEarnings && nextEarningsReminder && (
          <article className="header-next-earnings">
            <span>即将财报</span>
            <strong>{nextEarnings.symbol} {nextEarningsReminder.releaseDateLabel} · {nextEarningsReminder.sessionLabel}</strong>
            <i>北京{nextEarningsReminder.viewDateLabel}{nextEarningsReminder.viewTimeLabel}，{nextEarningsReminder.countdownLabel}</i>
          </article>
        )}
      </section>
    </header>
  );
}

function PositionReminder({ event, asOf }: { event?: EarningsEvent; asOf: string }) {
  if (!event) return null;

  const reminder = buildEarningsReminder(event, asOf);
  return (
    <span
      className="position-reminder"
      title={`美股 ${reminder.releaseDateLabel}${reminder.sessionLabel}发布；北京 ${reminder.viewDateLabel}${reminder.viewTimeLabel}查看`}
    >
      <strong>{reminder.releaseDateLabel} · {reminder.sessionLabel}</strong>
      <small>北京{reminder.viewDateLabel}{reminder.viewTimeLabel} · {reminder.countdownLabel}</small>
    </span>
  );
}

function AllocationRing({
  groups,
  activeSymbol,
  onActiveSymbolChange,
}: {
  groups: PositionGroupView[];
  activeSymbol: string | null;
  onActiveSymbolChange: (symbol: string | null) => void;
}) {
  const [showOther, setShowOther] = useState(false);
  const allocation = useMemo(() => buildAllocation(groups), [groups]);
  const otherActive = Boolean(activeSymbol && allocation.other.some((group) => group.symbol === activeSymbol));
  const segments = useMemo(() => {
    let offset = 0;
    return [
      ...allocation.leading.map((group) => ({ symbol: group.symbol, weight: group.weight, color: holdingColor(group.symbol) })),
      { symbol: "OTHER", weight: allocation.otherWeight, color: "#c8c0b3" },
    ].map((segment) => {
      const result = { ...segment, offset };
      offset += segment.weight;
      return result;
    });
  }, [allocation]);

  return (
    <div className="allocation-wrap">
      <div className="allocation-ring">
        <svg className="allocation-ring-svg" viewBox="0 0 100 100" role="img" aria-label={`前四大持仓净权重 ${allocation.leadingWeight.toFixed(2)}%`}>
          <circle className="ring-track" cx="50" cy="50" r="42" pathLength="100" />
          {segments.map((segment) => (
            <circle
              className="ring-segment"
              cx="50"
              cy="50"
              data-active={segment.symbol === activeSymbol || (segment.symbol === "OTHER" && otherActive)}
              key={segment.symbol}
              onFocus={() => segment.symbol !== "OTHER" && onActiveSymbolChange(segment.symbol)}
              onMouseEnter={() => {
                if (segment.symbol === "OTHER") setShowOther(true);
                else onActiveSymbolChange(segment.symbol);
              }}
              onMouseLeave={() => {
                if (segment.symbol === "OTHER") setShowOther(false);
                else onActiveSymbolChange(null);
              }}
              pathLength="100"
              r="42"
              stroke={segment.color}
              strokeDasharray={`${segment.weight} ${100 - segment.weight}`}
              strokeDashoffset={-segment.offset}
              tabIndex={0}
              transform="rotate(-90 50 50)"
            />
          ))}
        </svg>
        <span className="ring-center">{allocation.leadingWeight.toFixed(1)}%<small>前四大持仓</small></span>
      </div>
      <div className="legend">
        {allocation.leading.map((group) => (
          <button
            className="legend-row"
            data-active={activeSymbol === group.symbol}
            key={group.symbol}
            onFocus={() => onActiveSymbolChange(group.symbol)}
            onMouseEnter={() => onActiveSymbolChange(group.symbol)}
            onMouseLeave={() => onActiveSymbolChange(null)}
            style={{ "--holding-color": holdingColor(group.symbol) } as CSSProperties}
            type="button"
          >
            <span><i aria-hidden="true" />{group.symbol}</span><b>{group.weight.toFixed(2)}%</b>
          </button>
        ))}
        <button
          className="legend-row legend-other"
          data-active={otherActive}
          onBlur={() => setShowOther(false)}
          onClick={() => setShowOther((current) => !current)}
          onFocus={() => setShowOther(true)}
          onMouseEnter={() => setShowOther(true)}
          onMouseLeave={() => setShowOther(false)}
          type="button"
        >
          <span><i aria-hidden="true" />其他</span><b>{allocation.otherWeight.toFixed(2)}%</b>
        </button>
        {showOther && (
          <div className="other-popover" role="tooltip">
            <strong>其他持仓与空头调整</strong>
            {allocation.other.map((group) => (
              <span key={group.symbol}><b>{group.symbol}</b><i>{group.weight > 0 ? "+" : "−"}{Math.abs(group.weight).toFixed(2)}%</i></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const columns: Array<{ className?: string; key?: PositionSortKey; label: string }> = [
  { key: "symbol", label: "标的" },
  { label: "股价" },
  { label: "实际成本" },
  { label: "当日涨跌" },
  { key: "value", label: "净市值" },
  { key: "weight", label: "净权重" },
  { key: "cost", label: "持仓成本" },
  { key: "unrealized", label: "未实现盈亏" },
  { key: "realized", label: "年内已实现" },
  { key: "netPnl", label: "年内净盈亏" },
  { label: "" },
];

function PositionLedger({
  groups,
  activeSymbol,
  onActiveSymbolChange,
  onOpenPosition,
  quotes,
  quoteStatus,
  earningsBySymbol,
  earningsUpdatedAt,
}: {
  groups: PositionGroupView[];
  activeSymbol: string | null;
  onActiveSymbolChange: (symbol: string | null) => void;
  onOpenPosition: (group: PositionGroupView) => void;
  quotes: MarketQuoteMap;
  quoteStatus: QuoteLoadStatus;
  earningsBySymbol: Map<string, EarningsEvent>;
  earningsUpdatedAt: string;
}) {
  const [sortKey, setSortKey] = useState<PositionSortKey>("weight");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const sortedGroups = useMemo(() => sortPositionGroups(groups, sortKey, sortDirection), [groups, sortDirection, sortKey]);

  const updateSort = (key: PositionSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => current === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "symbol" ? "asc" : "desc");
  };

  return (
    <div className="position-scroll" aria-label="按 Ticker 分类的持仓">
      <div className="mobile-sort">
        <label>
          <span>排序</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as PositionSortKey)}>
            {columns.filter((column) => column.key).map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
        </label>
        <button onClick={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")} type="button">
          {sortDirection === "desc" ? "降序 ↓" : "升序 ↑"}
        </button>
      </div>
      <div className="position-columns">
        {columns.map((column, index) => column.key ? (
          <button
            aria-label={`按${column.label}${column.key === sortKey && sortDirection === "desc" ? "升序" : "降序"}排列`}
            className={[column.className, column.key === sortKey ? "is-sorted" : ""].filter(Boolean).join(" ")}
            key={column.label}
            onClick={() => updateSort(column.key!)}
            type="button"
          >
            {column.label}<i>{column.key === sortKey ? sortDirection === "desc" ? "↓" : "↑" : "↕"}</i>
          </button>
        ) : <span className={column.className} key={`${column.label}-${index}`}>{column.label}</span>)}
      </div>
      <div className="position-list">
        {sortedGroups.map((group) => (
          <div
            className="position-group"
            key={group.symbol}
            style={{ "--holding-color": heatmapThemeColor(group.symbol) } as CSSProperties}
          >
            <button
              aria-label={`查看 ${group.symbol} 持仓详情`}
              className="position-row position-row-button"
              data-active={activeSymbol === group.symbol}
              onFocus={() => onActiveSymbolChange(group.symbol)}
              onMouseEnter={() => onActiveSymbolChange(group.symbol)}
              onMouseLeave={() => onActiveSymbolChange(null)}
              onClick={() => onOpenPosition(group)}
              type="button"
            >
              <span className="position-identity">
                <i className="holding-mark" aria-hidden="true" />
                <strong className="symbol">{group.symbol}</strong>
                <PositionReminder event={earningsBySymbol.get(group.symbol)} asOf={earningsUpdatedAt} />
              </span>
              <span data-label="股价">
                {quotes[group.symbol] ? money(quotes[group.symbol].price) : <i className="quote-muted">{quoteStatus === "loading" ? "读取中" : "—"}</i>}
              </span>
              <span data-label="实际成本">
                {group.stock ? money(group.stock.actualCost) : <i className="quote-muted">—</i>}
              </span>
              <span data-label="当日涨跌">
                {quotes[group.symbol]
                  ? (
                    <span
                      className="daily-change-value"
                      data-direction={quotes[group.symbol].changePercent < 0 ? "loss" : quotes[group.symbol].changePercent > 0 ? "gain" : "neutral"}
                    >
                      {percent(quotes[group.symbol].changePercent, true)}
                    </span>
                  )
                  : <i className="quote-muted">{quoteStatus === "loading" ? "读取中" : "—"}</i>}
              </span>
              <span data-label="净市值">{money(group.value)}</span>
              <span data-label="净权重">{percent(group.weight)}</span>
              <span data-label="持仓成本">{money(group.cost)}</span>
              <span data-label="未实现盈亏"><Pnl value={group.unrealized} /></span>
              <span data-label="年内已实现"><Pnl value={group.realized} /></span>
              <span data-label="年内净盈亏"><Pnl value={group.netPnl} /></span>
              <span className="row-arrow" aria-hidden="true">→</span>
            </button>
            {group.options.length > 0 && (
              <div className="position-submenu" aria-label={`${group.symbol} 期权持仓`}>
                {group.options.map((option) => (
                  <div className="position-submenu-row" key={option.contract}>
                    <span className="submenu-type">期权</span>
                    <strong>{option.contract}</strong>
                    <span className="submenu-quantity">{number(option.quantity, 0, 4)} 张</span>
                    <i className="submenu-value">{money(option.marketValue)}</i>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {sortedGroups.length === 0 && <p className="empty-state">当前快照没有持仓。</p>}
      </div>
    </div>
  );
}

export function PortfolioDashboard({
  heatmapHoldings,
  positionGroups,
  stockMarketValue,
  optionMarketValue,
  netPositionsValue,
  snapshotTime,
  earningsEvents,
  netLiquidation,
  totalPnl,
  totalPnlRate,
  netLiquidationWithoutOptionPnl,
  netDeposits,
  cashBalance,
}: {
  heatmapHoldings: HeatmapHolding[];
  positionGroups: PositionGroupView[];
  stockMarketValue: number;
  optionMarketValue: number;
  netPositionsValue: number;
  snapshotTime: string;
  earningsEvents: EarningsEvent[];
  netLiquidation: number;
  totalPnl: number;
  totalPnlRate: number;
  netLiquidationWithoutOptionPnl: number;
  netDeposits: number;
  cashBalance: number;
}) {
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<PositionDetailTarget | null>(null);
  const quoteSymbols = useMemo(() => positionGroups.map((group) => group.symbol).join(","), [positionGroups]);
  const quoteState = useMarketQuotes(quoteSymbols);
  const [earningsAsOf] = useState(() => new Date().toISOString());
  const positionSymbols = useMemo(() => new Set(positionGroups.map((group) => group.symbol)), [positionGroups]);
  const earningsBySymbol = useMemo(() => {
    const events = new Map<string, EarningsEvent>();
    for (const event of earningsEvents) {
      if (
        positionSymbols.has(event.symbol) &&
        isUpcomingEarnings(event, earningsAsOf) &&
        !events.has(event.symbol)
      ) events.set(event.symbol, event);
    }
    return events;
  }, [earningsAsOf, earningsEvents, positionSymbols]);
  const nextEarnings = earningsEvents.find((event) => (
    positionSymbols.has(event.symbol) && isUpcomingEarnings(event, earningsAsOf)
  ));
  const nextEarningsReminder = nextEarnings ? buildEarningsReminder(nextEarnings, earningsAsOf) : null;

  return (
    <>
      <PortfolioHeader
        netLiquidation={netLiquidation}
        totalPnl={totalPnl}
        totalPnlRate={totalPnlRate}
        netLiquidationWithoutOptionPnl={netLiquidationWithoutOptionPnl}
        netDeposits={netDeposits}
        cashBalance={cashBalance}
        netPositionsValue={netPositionsValue}
        stockMarketValue={stockMarketValue}
        optionMarketValue={optionMarketValue}
        nextEarnings={nextEarnings}
        nextEarningsReminder={nextEarningsReminder}
      />
      <section className="lower-grid">
        <aside className="allocation-panel">
          <h2>仓位构成</h2>
          <div className="section-divider" aria-hidden="true" />
          <AllocationRing groups={positionGroups} activeSymbol={activeSymbol} onActiveSymbolChange={setActiveSymbol} />
          <PortfolioHeatmap holdings={heatmapHoldings} activeSymbol={activeSymbol} onActiveSymbolChange={setActiveSymbol} />
        </aside>

        <section className="ledger-panel" aria-labelledby="ledger-title">
          <div className="ledger-heading">
            <h2 id="ledger-title">投资账本</h2>
            <AddPlanDialog onSelect={(result) => {
              const position = positionGroups.find((group) => group.symbol === result.symbol);
              setSelectedPosition({ symbol: result.symbol, name: result.name, position });
            }} />
          </div>
          <div className="section-divider" aria-hidden="true" />
          <div className="ledger-content">
            <PositionLedger
              groups={positionGroups}
              activeSymbol={activeSymbol}
              onActiveSymbolChange={setActiveSymbol}
              onOpenPosition={(group) => setSelectedPosition({ symbol: group.symbol, name: group.name, position: group })}
              quotes={quoteState.quotes}
              quoteStatus={quoteState.status}
              earningsBySymbol={earningsBySymbol}
              earningsUpdatedAt={earningsAsOf}
            />
          </div>
        </section>
      </section>
      {selectedPosition && (
        <PositionDetailDialog
          onClose={() => setSelectedPosition(null)}
          quote={quoteState.quotes[selectedPosition.symbol]}
          quoteStatus={selectedPosition.position ? quoteState.status : undefined}
          snapshotTime={snapshotTime}
          target={selectedPosition}
        />
      )}
    </>
  );
}
