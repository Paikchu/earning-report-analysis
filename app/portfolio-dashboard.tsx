"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";

import {
  allocationColor,
  buildAllocation,
  buildSectorAllocation,
  sortPositionGroups,
  type PositionSortKey,
  type SortDirection,
} from "@/lib/portfolio-dashboard";
import { buildEarningsReminder, isUpcomingEarnings, type EarningsEvent } from "@/lib/earnings-calendar";
import type { DailyPortfolioReviewV1 } from "@/lib/daily-portfolio-review";
import { money, number, percent } from "@/lib/portfolio-format";
import { heatmapThemeColor, type HeatmapHolding } from "@/lib/portfolio-heatmap";
import type { PositionGroupView } from "@/lib/portfolio-view-model";
import { AddPlanDialog } from "./AddPlanDialog";
import { PortfolioHeatmap } from "./portfolio-heatmap";
import { SiteHeader } from "./site-header";
import { useMarketQuotes, type QuoteLoadStatus } from "./use-market-quotes";
import type { MarketQuoteMap } from "@/lib/yahoo-quotes";

type DashboardView = "portfolio" | "review";

function Pnl({ value }: { value: number }) {
  const className = value < 0 ? "loss" : value > 0 ? "gain" : "muted";
  return <span className={className}>{money(value, true)}</span>;
}

function PortfolioOverview({
  netLiquidation,
  totalPnl,
  totalPnlRate,
  netLiquidationWithoutOptionPnl,
  portfolioLeverage,
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
  portfolioLeverage: number;
  netDeposits: number;
  cashBalance: number;
  netPositionsValue: number;
  stockMarketValue: number;
  optionMarketValue: number;
  nextEarnings?: EarningsEvent;
  nextEarningsReminder: ReturnType<typeof buildEarningsReminder> | null;
}) {
  return (
    <section className="portfolio-overview" aria-labelledby="portfolio-title">
      <div className="hero">
        <div className="portfolio-heading">
          <h1 id="portfolio-title">投资组合</h1>
          <span className="summary-nav-label">当前净值</span>
          <strong className="summary-nav-value">{money(netLiquidation)}</strong>
          <span className="summary-pnl-label">累计盈亏</span>
          <strong className={`summary-pnl ${totalPnl < 0 ? "loss" : totalPnl > 0 ? "gain" : "muted"}`}>
            {money(totalPnl, true)} <i>{percent(totalPnlRate, true)}</i>
          </strong>
        </div>
        <div className="summary-support" aria-label="组合摘要">
          <article><span>持仓净市值</span><strong>{money(netPositionsValue)}</strong></article>
          <article><span>现金</span><strong>{money(cashBalance)}</strong></article>
          <article><span>杠杆率</span><strong>{number(portfolioLeverage, 2, 2)}x</strong></article>
          <article><span>净入金</span><strong>{money(netDeposits)}</strong></article>
        </div>
      </div>
      <section className="header-position-summary" aria-label="持仓摘要">
        <article><span>正股</span><strong>{money(stockMarketValue)}</strong></article>
        <article><span>期权</span><strong>{money(optionMarketValue)}</strong></article>
        <article><span>剔除期权浮盈亏</span><strong>{money(netLiquidationWithoutOptionPnl)}</strong></article>
        {nextEarnings && nextEarningsReminder && (
          <article className="header-next-earnings">
            <span>即将财报</span>
            <strong>{nextEarnings.symbol} {nextEarningsReminder.releaseDateLabel} · {nextEarningsReminder.sessionLabel}</strong>
            <i>北京{nextEarningsReminder.viewDateLabel}{nextEarningsReminder.viewTimeLabel}，{nextEarningsReminder.countdownLabel}</i>
          </article>
        )}
      </section>
    </section>
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

function DailyPortfolioReview({ review }: { review: DailyPortfolioReviewV1 }) {
  const reviewTime = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(review.generatedAt));

  return (
    <section className="daily-review" aria-labelledby="daily-review-title">
      <div className="daily-review-heading">
        <div>
          <span>每日投资复盘</span>
          <h2 id="daily-review-title">{review.headline}</h2>
        </div>
        <time dateTime={review.generatedAt}>{reviewTime}</time>
      </div>
      <p className="daily-review-summary">{review.summary}</p>
      <div className="daily-review-grid">
        <div>
          <h3>关键驱动</h3>
          <ol className="review-driver-list">
            {review.drivers.map((driver) => (
              <li key={driver.title}>
                <strong>{driver.title}</strong>
                <p>{driver.detail}</p>
                <span>{driver.implication}</span>
                {driver.tickers.length > 0 && <small>{driver.tickers.join(" · ")}</small>}
              </li>
            ))}
          </ol>
        </div>
        <aside>
          <h3>观察清单</h3>
          <ul className="review-watch-list">
            {review.watchItems.map((item) => <li key={item.label}><strong>{item.label}</strong><span>{item.detail}</span></li>)}
          </ul>
          <details className="review-sources">
            <summary>来源 {review.sources.length}</summary>
            <ul>{review.sources.map((source) => <li key={source.url}><a href={source.url} rel="noreferrer" target="_blank">{source.title}</a></li>)}</ul>
          </details>
        </aside>
      </div>
    </section>
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
      ...allocation.leading.map((group, index) => ({ symbol: group.symbol, weight: group.weight, color: allocationColor(index) })),
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
        {allocation.leading.map((group, index) => (
          <button
            className="legend-row"
            data-active={activeSymbol === group.symbol}
            key={group.symbol}
            onFocus={() => onActiveSymbolChange(group.symbol)}
            onMouseEnter={() => onActiveSymbolChange(group.symbol)}
            onMouseLeave={() => onActiveSymbolChange(null)}
            style={{ "--holding-color": allocationColor(index) } as CSSProperties}
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

function SectorAllocationRing({ groups }: { groups: PositionGroupView[] }) {
  const allocation = useMemo(() => buildSectorAllocation(groups), [groups]);
  const segments = useMemo(() => {
    const total = allocation.classifiedWeight + allocation.unallocatedWeight;
    const scale = total > 100 ? 100 / total : 1;
    const rawSegments = [
      ...allocation.sectors.map((sector) => ({ label: sector.domain, weight: sector.weight, color: sector.color })),
      ...(allocation.unallocatedWeight > 0 ? [{ label: "现金与对冲", weight: allocation.unallocatedWeight, color: "#c8c0b3" }] : []),
    ];
    let offset = 0;
    return rawSegments.map((segment) => {
      const result = { ...segment, weight: segment.weight * scale, offset };
      offset += result.weight;
      return result;
    });
  }, [allocation]);

  return (
    <div className="allocation-wrap sector-allocation-wrap">
      <div className="allocation-ring">
        <svg className="allocation-ring-svg" viewBox="0 0 100 100" role="img" aria-label={`板块占比，已归类板块 ${allocation.classifiedWeight.toFixed(2)}%`}>
          <circle className="ring-track" cx="50" cy="50" r="42" pathLength="100" />
          {segments.map((segment) => (
            <circle
              className="ring-segment sector-ring-segment"
              cx="50"
              cy="50"
              key={segment.label}
              pathLength="100"
              r="42"
              stroke={segment.color}
              strokeDasharray={`${segment.weight} ${100 - segment.weight}`}
              strokeDashoffset={-segment.offset}
              transform="rotate(-90 50 50)"
            />
          ))}
        </svg>
        <span className="ring-center">{allocation.classifiedWeight.toFixed(1)}%<small>已归类板块</small></span>
      </div>
      <div className="legend sector-legend" aria-label="板块占比图例">
        {allocation.sectors.map((sector) => (
          <div className="legend-row sector-legend-row" key={sector.domain}>
            <span><i aria-hidden="true" style={{ "--holding-color": sector.color } as CSSProperties} />{sector.domain}</span><b>{sector.weight.toFixed(2)}%</b>
          </div>
        ))}
        {allocation.unallocatedWeight > 0 && (
          <div className="legend-row sector-legend-row legend-other">
            <span><i aria-hidden="true" />现金与对冲</span><b>{allocation.unallocatedWeight.toFixed(2)}%</b>
          </div>
        )}
      </div>
    </div>
  );
}

function AllocationPanel({
  groups,
  activeSymbol,
  onActiveSymbolChange,
}: {
  groups: PositionGroupView[];
  activeSymbol: string | null;
  onActiveSymbolChange: (symbol: string | null) => void;
}) {
  return (
    <div className="allocation-comparison">
      <section className="allocation-mode-panel" aria-labelledby="holding-allocation-title">
        <h3 id="holding-allocation-title">个股</h3>
        <AllocationRing groups={groups} activeSymbol={activeSymbol} onActiveSymbolChange={onActiveSymbolChange} />
      </section>
      <section className="allocation-mode-panel" aria-labelledby="sector-allocation-title">
        <h3 id="sector-allocation-title">板块</h3>
        <SectorAllocationRing groups={groups} />
      </section>
    </div>
  );
}

const columns = ["标的", "行情", "仓位", "成本", "未实现", "年内"];

const sortOptions: Array<{ key: PositionSortKey; label: string }> = [
  { key: "symbol", label: "标的" },
  { key: "value", label: "净市值" },
  { key: "weight", label: "净权重" },
  { key: "cost", label: "持仓成本" },
  { key: "unrealized", label: "未实现盈亏" },
  { key: "realized", label: "年内已实现" },
  { key: "netPnl", label: "年内净盈亏" },
];

function PositionLedger({
  groups,
  activeSymbol,
  onActiveSymbolChange,
  quotes,
  quoteStatus,
  earningsBySymbol,
  earningsUpdatedAt,
}: {
  groups: PositionGroupView[];
  activeSymbol: string | null;
  onActiveSymbolChange: (symbol: string | null) => void;
  quotes: MarketQuoteMap;
  quoteStatus: QuoteLoadStatus;
  earningsBySymbol: Map<string, EarningsEvent>;
  earningsUpdatedAt: string;
}) {
  const [sortKey, setSortKey] = useState<PositionSortKey>("weight");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const sortedGroups = useMemo(() => sortPositionGroups(groups, sortKey, sortDirection), [groups, sortDirection, sortKey]);

  return (
    <div className="position-scroll" aria-label="按 Ticker 分类的持仓">
      <div className="ledger-sort" aria-label="账本排序">
        <label>
          <span>排序</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as PositionSortKey)}>
            {sortOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
        <button onClick={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")} type="button">
          {sortDirection === "desc" ? "降序 ↓" : "升序 ↑"}
        </button>
      </div>
      <div className="position-columns">
        {columns.map((column) => <span key={column}>{column}</span>)}
      </div>
      <div className="position-list">
        {sortedGroups.map((group) => (
          <div
            className="position-group"
            key={group.symbol}
            style={{ "--holding-color": heatmapThemeColor(group.symbol) } as CSSProperties}
          >
            <Link
              className="position-row"
              data-active={activeSymbol === group.symbol}
              href={`/positions/${encodeURIComponent(group.symbol)}`}
              onFocus={() => onActiveSymbolChange(group.symbol)}
              onMouseEnter={() => onActiveSymbolChange(group.symbol)}
              onMouseLeave={() => onActiveSymbolChange(null)}
            >
              <span className="position-identity">
                <i className="holding-mark" aria-hidden="true" />
                <strong className="symbol">{group.symbol}</strong>
                <PositionReminder event={earningsBySymbol.get(group.symbol)} asOf={earningsUpdatedAt} />
              </span>
              <span className="position-market-cell" data-label="行情">
                <strong>{quotes[group.symbol] ? money(quotes[group.symbol].price) : <i className="quote-muted">{quoteStatus === "loading" ? "读取中" : "—"}</i>}</strong>
                {quotes[group.symbol]
                  ? (
                    <small
                      className="daily-change-value"
                      data-direction={quotes[group.symbol].changePercent < 0 ? "loss" : quotes[group.symbol].changePercent > 0 ? "gain" : "neutral"}
                    >
                      {percent(quotes[group.symbol].changePercent, true)}
                    </small>
                  )
                  : <small className="quote-muted">当日 —</small>}
              </span>
              <span className="position-value-cell" data-label="仓位"><strong>{money(group.value)}</strong><small>{percent(group.weight)}</small></span>
              <span className="position-cost-cell" data-label="成本"><strong>{group.stock ? money(group.stock.actualCost) : <i className="quote-muted">—</i>}</strong><small>持仓 {money(group.cost)}</small></span>
              <span className="position-unrealized-cell" data-label="未实现"><Pnl value={group.unrealized} /></span>
              <span className="position-year-cell" data-label="年内"><strong><Pnl value={group.netPnl} /></strong><small>已实现 <Pnl value={group.realized} /></small></span>
              <span className="sr-only">，查看持仓详情</span>
            </Link>
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

export function PortfolioLedgerPage({
  positionGroups,
  earningsEvents,
}: {
  positionGroups: PositionGroupView[];
  earningsEvents: EarningsEvent[];
}) {
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
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

  return (
    <>
      <SiteHeader active="ledger" />
      <section className="ledger-panel ledger-page" aria-labelledby="ledger-title">
        <div className="ledger-heading">
          <h1 id="ledger-title">投资账本</h1>
          <AddPlanDialog />
        </div>
        <div className="section-divider" aria-hidden="true" />
        <div className="ledger-content">
          <PositionLedger
            groups={positionGroups}
            activeSymbol={activeSymbol}
            onActiveSymbolChange={setActiveSymbol}
            quotes={quoteState.quotes}
            quoteStatus={quoteState.status}
            earningsBySymbol={earningsBySymbol}
            earningsUpdatedAt={earningsAsOf}
          />
        </div>
      </section>
    </>
  );
}

export function PortfolioDashboard({
  dailyReview,
  heatmapHoldings,
  positionGroups,
  stockMarketValue,
  optionMarketValue,
  netPositionsValue,
  earningsEvents,
  netLiquidation,
  totalPnl,
  totalPnlRate,
  netLiquidationWithoutOptionPnl,
  portfolioLeverage,
  netDeposits,
  cashBalance,
}: {
  dailyReview: DailyPortfolioReviewV1;
  heatmapHoldings: HeatmapHolding[];
  positionGroups: PositionGroupView[];
  stockMarketValue: number;
  optionMarketValue: number;
  netPositionsValue: number;
  earningsEvents: EarningsEvent[];
  netLiquidation: number;
  totalPnl: number;
  totalPnlRate: number;
  netLiquidationWithoutOptionPnl: number;
  portfolioLeverage: number;
  netDeposits: number;
  cashBalance: number;
}) {
  const [activeView, setActiveView] = useState<DashboardView>("portfolio");
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [earningsAsOf] = useState(() => new Date().toISOString());
  const positionSymbols = useMemo(() => new Set(positionGroups.map((group) => group.symbol)), [positionGroups]);
  const nextEarnings = earningsEvents.find((event) => (
    positionSymbols.has(event.symbol) && isUpcomingEarnings(event, earningsAsOf)
  ));
  const nextEarningsReminder = nextEarnings ? buildEarningsReminder(nextEarnings, earningsAsOf) : null;

  useEffect(() => {
    const syncViewFromUrl = () => {
      setActiveView(new URLSearchParams(window.location.search).get("view") === "review" ? "review" : "portfolio");
    };
    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, []);

  function switchView(view: DashboardView) {
    setActiveView(view);
    window.history.replaceState(null, "", view === "review" ? "/?view=review" : "/");
  }

  return (
    <>
      <SiteHeader active={activeView} onViewChange={switchView} />

      <div hidden={activeView !== "portfolio"} id="portfolio-panel" role="region">
        <PortfolioOverview
          netLiquidation={netLiquidation}
          totalPnl={totalPnl}
          totalPnlRate={totalPnlRate}
          netLiquidationWithoutOptionPnl={netLiquidationWithoutOptionPnl}
          portfolioLeverage={portfolioLeverage}
          netDeposits={netDeposits}
          cashBalance={cashBalance}
          netPositionsValue={netPositionsValue}
          stockMarketValue={stockMarketValue}
          optionMarketValue={optionMarketValue}
          nextEarnings={nextEarnings}
          nextEarningsReminder={nextEarningsReminder}
        />
        <section className="lower-grid portfolio-analysis">
          <aside className="allocation-panel">
            <h2>仓位构成</h2>
            <div className="section-divider" aria-hidden="true" />
            <AllocationPanel groups={positionGroups} activeSymbol={activeSymbol} onActiveSymbolChange={setActiveSymbol} />
          </aside>
          <PortfolioHeatmap holdings={heatmapHoldings} activeSymbol={activeSymbol} onActiveSymbolChange={setActiveSymbol} />
        </section>
      </div>

      <div hidden={activeView !== "review"} id="review-panel" role="region">
        <DailyPortfolioReview review={dailyReview} />
      </div>
    </>
  );
}
