"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  calculatePopoverPosition,
  groupHeatmapHoldings,
  layoutTreemap,
  type HeatmapHolding,
} from "@/lib/portfolio-heatmap";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (value: number) => currencyFormatter.format(value);
const signedPercent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;

type HeatStyle = CSSProperties & { "--heat-strength": string };
type PopoverState = { symbol: string; left: number; top: number };

function heatStyle(rate: number): HeatStyle {
  return { "--heat-strength": `${Math.min(Math.abs(rate), 25) / 25 * 62}%` };
}

export function PortfolioHeatmap({ holdings }: { holdings: HeatmapHolding[] }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const activeTileRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [plotSize, setPlotSize] = useState({ width: 360, height: 470 });
  const groups = useMemo(() => groupHeatmapHoldings(holdings), [holdings]);
  const groupRectangles = useMemo(() => layoutTreemap(groups.map((group) => ({
    id: group.domain,
    weight: group.portfolioWeight,
  })), plotSize.width, plotSize.height), [groups, plotSize]);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const selected = holdings.find((holding) => holding.symbol === popover?.symbol);
  const totalWeight = holdings.reduce((sum, holding) => sum + holding.portfolioWeight, 0);

  const positionPopover = useCallback((symbol: string, tile: HTMLButtonElement) => {
    const plot = plotRef.current;
    if (!plot) return;
    const plotBounds = plot.getBoundingClientRect();
    const tileBounds = tile.getBoundingClientRect();
    const position = calculatePopoverPosition(plotBounds, tileBounds);
    activeTileRef.current = tile;
    setPopover({ symbol, ...position });
  }, []);

  const cancelPopoverClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const schedulePopoverClose = useCallback(() => {
    cancelPopoverClose();
    closeTimerRef.current = setTimeout(() => setPopover(null), 80);
  }, [cancelPopoverClose]);

  const showPopover = (holding: HeatmapHolding, tile: HTMLButtonElement) => {
    cancelPopoverClose();
    positionPopover(holding.symbol, tile);
  };

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setPlotSize((current) => current.width === width && current.height === height ? current : { width, height });
      }
    });
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (popover?.symbol && activeTileRef.current) positionPopover(popover.symbol, activeTileRef.current);
  }, [plotSize, popover?.symbol, positionPopover]);

  useEffect(() => () => cancelPopoverClose(), [cancelPopoverClose]);

  if (holdings.length === 0) return null;

  return (
    <section className="heatmap-section" aria-labelledby="heatmap-title">
      <div className="section-divider heatmap-divider" aria-hidden="true" />
      <div className="heatmap-heading">
        <h3 id="heatmap-title">持仓主题热力图</h3>
        <strong>{totalWeight.toFixed(2)}%</strong>
      </div>
      <p className="heatmap-note">含期权负债，正股权重可超过 100%</p>
      <div className="heatmap-key" aria-label="未实现盈亏率图例">
        <span><i className="key-loss" aria-hidden="true" />亏损</span>
        <span><i className="key-neutral" aria-hidden="true" />持平</span>
        <span><i className="key-gain" aria-hidden="true" />盈利</span>
      </div>
      <div className="heatmap-plot" aria-label="持仓主题热力图" ref={plotRef}>
        {groupRectangles.map((groupRect) => {
          const group = groups.find((item) => item.domain === groupRect.id);
          if (!group) return null;
          const holdingRectangles = layoutTreemap(group.holdings.map((holding) => ({
            id: holding.symbol,
            weight: holding.portfolioWeight,
          })), groupRect.width, groupRect.height);
          const compactDomain = groupRect.width < 78 || groupRect.height < 64;

          return (
            <section
              className={`heatmap-domain${compactDomain ? " heatmap-domain-compact" : ""}`}
              key={group.domain}
              aria-label={`${group.domain}，组合权重 ${group.portfolioWeight.toFixed(2)}%`}
              style={{
                left: `${groupRect.x / plotSize.width * 100}%`,
                top: `${groupRect.y / plotSize.height * 100}%`,
                width: `${groupRect.width / plotSize.width * 100}%`,
                height: `${groupRect.height / plotSize.height * 100}%`,
              }}
            >
              <div className="heatmap-domain-heading">
                <span>{group.domain}</span>
                <b>{group.portfolioWeight.toFixed(2)}%</b>
              </div>
              <div className="heatmap-domain-tiles">
                {holdingRectangles.map((holdingRect) => {
                  const holding = group.holdings.find((item) => item.symbol === holdingRect.id);
                  if (!holding) return null;
                  const direction = holding.unrealizedRate < -0.01 ? "loss" : holding.unrealizedRate > 0.01 ? "gain" : "neutral";
                  const compact = holdingRect.width * holdingRect.height < 1_800;

                  return (
                    <button
                      type="button"
                      className={`heatmap-tile${compact ? " heatmap-tile-compact" : ""}`}
                      data-direction={direction}
                      aria-pressed={holding.symbol === selected?.symbol}
                      aria-describedby={holding.symbol === selected?.symbol ? "heatmap-popover" : undefined}
                      aria-label={`${holding.symbol}，${holding.domain}，组合权重 ${holding.portfolioWeight.toFixed(2)}%，未实现盈亏率 ${signedPercent(holding.unrealizedRate)}`}
                      key={holding.symbol}
                      onBlur={schedulePopoverClose}
                      onClick={(event) => showPopover(holding, event.currentTarget)}
                      onFocus={(event) => showPopover(holding, event.currentTarget)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setPopover(null);
                          event.currentTarget.blur();
                        }
                      }}
                      onMouseEnter={(event) => showPopover(holding, event.currentTarget)}
                      onMouseLeave={schedulePopoverClose}
                      style={{
                        ...heatStyle(holding.unrealizedRate),
                        left: `${holdingRect.x / groupRect.width * 100}%`,
                        top: `${holdingRect.y / groupRect.height * 100}%`,
                        width: `${holdingRect.width / groupRect.width * 100}%`,
                        height: `${holdingRect.height / groupRect.height * 100}%`,
                      }}
                    >
                      <strong>{holding.symbol}</strong>
                      <span>{holding.portfolioWeight.toFixed(2)}%</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {selected && popover && (
          <div
            className="heatmap-popover"
            id="heatmap-popover"
            role="tooltip"
            aria-live="polite"
            onMouseEnter={cancelPopoverClose}
            onMouseLeave={schedulePopoverClose}
            style={{ left: popover.left, top: popover.top }}
          >
            <div className="heatmap-popover-heading">
              <span><strong>{selected.symbol}</strong>{selected.company}</span>
              <b>{selected.domain}</b>
            </div>
            <dl>
              <div><dt>市值</dt><dd>{money(selected.marketValue)}</dd></div>
              <div><dt>组合权重</dt><dd>{selected.portfolioWeight.toFixed(2)}%</dd></div>
              <div><dt>持仓成本</dt><dd>{money(selected.costBasis)}</dd></div>
              <div><dt>未实现盈亏率</dt><dd className={selected.unrealizedRate < 0 ? "loss" : selected.unrealizedRate > 0 ? "gain" : "muted"}>{signedPercent(selected.unrealizedRate)}</dd></div>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
