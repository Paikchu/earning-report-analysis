"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";

import {
  buildAllocation,
  hasShortOption,
  holdingColor,
  sortPositionGroups,
  type PositionSortKey,
  type SortDirection,
} from "@/lib/portfolio-dashboard";
import {
  filterPortfolioHistory,
  type PortfolioHistoryPoint,
  type PortfolioHistoryRange,
} from "@/lib/portfolio-history";
import { money, percent } from "@/lib/portfolio-format";
import type { HeatmapHolding } from "@/lib/portfolio-heatmap";
import type { PositionGroupView } from "@/lib/portfolio-view-model";
import { AddPlanDialog } from "./AddPlanDialog";
import { PortfolioHeatmap } from "./portfolio-heatmap";

const shortDate = (date: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
}).format(new Date(`${date}T00:00:00.000Z`));

function Pnl({ value }: { value: number }) {
  const className = value < 0 ? "loss" : value > 0 ? "gain" : "muted";
  return <span className={className}>{money(value, true)}</span>;
}

function PortfolioChart({
  history,
  range,
  onRangeChange,
}: {
  history: PortfolioHistoryPoint[];
  range: PortfolioHistoryRange;
  onRangeChange: (range: PortfolioHistoryRange) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const points = useMemo(() => filterPortfolioHistory(history, range), [history, range]);
  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const width = 1_000;
    const height = 220;
    const top = 16;
    const bottom = 30;
    const values = points.flatMap((point) => [point.netLiquidation, point.netDeposits]);
    const valueMin = Math.min(...values);
    const valueMax = Math.max(...values);
    const padding = Math.max((valueMax - valueMin) * .12, 500);
    const min = valueMin - padding;
    const max = valueMax + padding;
    const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom);
    const positioned = points.map((point, index) => ({
      ...point,
      x: index / (points.length - 1) * width,
      navY: y(point.netLiquidation),
      depositY: y(point.netDeposits),
    }));
    return {
      width,
      height,
      points: positioned,
      navPath: positioned.map((point) => `${point.x},${point.navY}`).join(" "),
      depositPath: positioned.map((point) => `${point.x},${point.depositY}`).join(" "),
    };
  }, [points]);
  const hovered = chart && hoveredIndex !== null ? chart.points[hoveredIndex] : null;

  return (
    <section className="history-section" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <h2 id="history-title">净值走势</h2>
          <div className="chart-key">
            <span><i className="nav-key" />组合净值</span>
            <span><i className="deposit-key" />净入金</span>
          </div>
        </div>
        <div className="range-switch" aria-label="净值周期">
          {(["1M", "3M", "YTD", "ALL"] as const).map((item) => (
            <button
              className={range === item ? "is-active" : ""}
              key={item}
              onClick={() => onRangeChange(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="section-divider" aria-hidden="true" />
      {chart ? (
        <div className="portfolio-chart" onMouseLeave={() => setHoveredIndex(null)}>
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label={`${range} 组合净值与净入金走势`}>
            {[.25, .5, .75].map((ratio) => (
              <line className="chart-grid" x1="0" x2={chart.width} y1={ratio * 190} y2={ratio * 190} key={ratio} />
            ))}
            <polyline className="deposit-line" fill="none" points={chart.depositPath} strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
            <polyline className="nav-line" fill="none" points={chart.navPath} vectorEffect="non-scaling-stroke" />
            {chart.points.map((point, index) => (
              <circle
                className="chart-point"
                cx={point.x}
                cy={point.navY}
                key={point.date}
                onClick={() => setHoveredIndex(index)}
                onFocus={() => setHoveredIndex(index)}
                onMouseEnter={() => setHoveredIndex(index)}
                r="5"
                tabIndex={0}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="chart-dates"><span>{shortDate(points[0].date)}</span><span>{shortDate(points.at(-1)!.date)}</span></div>
          {hovered && (
            <div className="chart-tooltip" style={{ left: `${hovered.x / chart.width * 100}%`, top: `${hovered.navY / chart.height * 100}%` }}>
              <strong>{hovered.date}</strong>
              <span>净值 <b>{money(hovered.netLiquidation)}</b></span>
              <span>净入金 <b>{money(hovered.netDeposits)}</b></span>
              <span>差额 <b className={hovered.netLiquidation - hovered.netDeposits < 0 ? "loss" : "gain"}>{money(hovered.netLiquidation - hovered.netDeposits, true)}</b></span>
            </div>
          )}
        </div>
      ) : (
        <div className="history-empty">
          <strong>历史净值正在积累</strong>
          <span>完成第二次每日快照后开始绘制曲线。</span>
        </div>
      )}
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
              data-dimmed={Boolean(activeSymbol && segment.symbol !== activeSymbol)}
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
            data-dimmed={Boolean(activeSymbol && activeSymbol !== group.symbol)}
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

const columns: Array<{ key?: PositionSortKey; label: string }> = [
  { key: "symbol", label: "标的" },
  { label: "构成" },
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
}: {
  groups: PositionGroupView[];
  activeSymbol: string | null;
  onActiveSymbolChange: (symbol: string | null) => void;
}) {
  const [sortKey, setSortKey] = useState<PositionSortKey>("weight");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [breakdownSymbol, setBreakdownSymbol] = useState<string | null>(null);
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
            className={column.key === sortKey ? "is-sorted" : ""}
            key={column.label}
            onClick={() => updateSort(column.key!)}
            type="button"
          >
            {column.label}<i>{column.key === sortKey ? sortDirection === "desc" ? "↓" : "↑" : "↕"}</i>
          </button>
        ) : <span key={`${column.label}-${index}`}>{column.label}</span>)}
      </div>
      <div className="position-list">
        {sortedGroups.map((group) => {
          const shortOption = hasShortOption(group);
          const showBreakdown = breakdownSymbol === group.symbol;
          return (
            <div
              className="position-row"
              data-active={activeSymbol === group.symbol}
              data-dimmed={Boolean(activeSymbol && activeSymbol !== group.symbol)}
              key={group.symbol}
              onFocus={() => onActiveSymbolChange(group.symbol)}
              onMouseEnter={() => onActiveSymbolChange(group.symbol)}
              onMouseLeave={() => onActiveSymbolChange(null)}
              style={{ "--holding-color": holdingColor(group.symbol) } as CSSProperties}
            >
              <Link className="position-row-link" href={`/positions/${encodeURIComponent(group.symbol)}`} aria-label={`查看 ${group.symbol} 持仓详情`} />
              <span className="position-identity">
                <i className="holding-mark" aria-hidden="true" />
                <strong className="symbol">{group.symbol}</strong>
                <small className="company">{group.name}</small>
              </span>
              <span className="position-kinds" data-label="构成">
                {group.stock && <i className="asset-pill stock-pill">正股</i>}
                {group.options.length > 0 && <i className="asset-pill option-pill">{group.options.length} 期权</i>}
                {shortOption && (
                  <button
                    aria-label={`查看 ${group.symbol} 持仓拆分`}
                    className="breakdown-trigger"
                    onBlur={() => setBreakdownSymbol(null)}
                    onClick={() => setBreakdownSymbol((current) => current === group.symbol ? null : group.symbol)}
                    onFocus={() => setBreakdownSymbol(group.symbol)}
                    onMouseEnter={() => setBreakdownSymbol(group.symbol)}
                    type="button"
                  >
                    拆分
                  </button>
                )}
                {showBreakdown && (
                  <div className="position-breakdown" role="tooltip" onMouseLeave={() => setBreakdownSymbol(null)}>
                    <strong>{group.symbol} 市值构成</strong>
                    {group.stock && <span><b>正股</b><i>{money(group.stock.value)}</i></span>}
                    {group.options.map((option) => (
                      <span key={option.contract}><b>{option.contract}</b><i>{money(option.marketValue)}</i></span>
                    ))}
                    <span className="breakdown-total"><b>净市值</b><i>{money(group.value)}</i></span>
                  </div>
                )}
              </span>
              <span data-label="净市值">{money(group.value)}</span>
              <span data-label="净权重">{percent(group.weight)}</span>
              <span data-label="持仓成本">{money(group.cost)}</span>
              <span data-label="未实现盈亏"><Pnl value={group.unrealized} /></span>
              <span data-label="年内已实现"><Pnl value={group.realized} /></span>
              <span data-label="年内净盈亏"><Pnl value={group.netPnl} /></span>
              <span className="row-arrow" aria-hidden="true">→</span>
            </div>
          );
        })}
        {sortedGroups.length === 0 && <p className="empty-state">当前快照没有持仓。</p>}
      </div>
    </div>
  );
}

export function PortfolioDashboard({
  history,
  heatmapHoldings,
  positionGroups,
  stockMarketValue,
  optionMarketValue,
  netPositionsValue,
}: {
  history: PortfolioHistoryPoint[];
  heatmapHoldings: HeatmapHolding[];
  positionGroups: PositionGroupView[];
  stockMarketValue: number;
  optionMarketValue: number;
  netPositionsValue: number;
}) {
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [range, setRange] = useState<PortfolioHistoryRange>("ALL");

  return (
    <>
      <PortfolioChart history={history} range={range} onRangeChange={setRange} />
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
            <AddPlanDialog />
          </div>
          <div className="section-divider" aria-hidden="true" />
          <div className="ledger-content">
            <div className="ledger-meta">
              <span>持仓净市值 <strong>{money(netPositionsValue)}</strong></span>
              <span>正股 <strong>{money(stockMarketValue)}</strong></span>
              <span>期权 <strong>{money(optionMarketValue)}</strong></span>
            </div>
            <PositionLedger groups={positionGroups} activeSymbol={activeSymbol} onActiveSymbolChange={setActiveSymbol} />
          </div>
        </section>
      </section>
    </>
  );
}
