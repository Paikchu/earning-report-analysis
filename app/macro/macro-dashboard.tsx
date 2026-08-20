"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { MacroDashboardV1 } from "@/lib/macro-dashboard";
import { BOND_CHARTS, EQUITY_CHARTS, buildTradingViewConfig, tradingViewSymbolUrl, type TradingViewChart } from "@/lib/tradingview";

const directionLabels = { tailwind: "顺风", headwind: "逆风", mixed: "多空交织", unclear: "方向待确认" } as const;
const horizonLabels = { immediate: "0–5 个交易日", near_term: "1–12 周", medium_term: "1–4 个季度" } as const;
const confidenceLabels = { high: "高置信", medium: "中等置信", low: "低置信" } as const;
const channelLabels = { rates: "利率", inflation: "通胀", growth: "增长", liquidity: "流动性", usd: "美元", volatility: "波动率" } as const;

function formatShanghaiTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function TradingViewWidget({ symbol, label }: { symbol: string; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const sourceUrl = tradingViewSymbolUrl(symbol);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setFailed(false);
    container.replaceChildren();
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.textContent = JSON.stringify(buildTradingViewConfig(symbol));
    script.onerror = () => setFailed(true);
    container.append(widget, script);
    return () => container.replaceChildren();
  }, [symbol]);

  return (
    <div className="macro-widget-frame" aria-label={`${label} TradingView 走势图`}>
      <div className="tradingview-widget-container" ref={containerRef} />
      {failed && <p className="macro-widget-error">图表暂时无法载入。<a href={sourceUrl} rel="noopener noreferrer" target="_blank">在 TradingView 查看</a></p>}
      <a className="macro-widget-credit" href={sourceUrl} rel="noopener nofollow noreferrer" target="_blank">{label} 图表由 TradingView 提供</a>
    </div>
  );
}

function ChartPanel({ title, note, charts, initialSymbol }: { title: string; note: string; charts: TradingViewChart[]; initialSymbol: string }) {
  const initialChart = charts.find((chart) => chart.symbol === initialSymbol) ?? charts[0];
  const [activeChart, setActiveChart] = useState(initialChart);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % charts.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + charts.length) % charts.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = charts.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    setActiveChart(charts[nextIndex]);
    document.getElementById(`chart-tab-${charts[nextIndex].symbol.replace(":", "-")}`)?.focus();
  }

  return (
    <article className="macro-chart-panel">
      <div className="macro-chart-heading">
        <div><span>{note}</span><h2>{title}</h2></div>
        <strong>{activeChart.description}</strong>
      </div>
      <div className="macro-ticker-tabs" role="tablist" aria-label={`${title} ticker`}>
        {charts.map((chart, index) => (
          <button
            aria-selected={activeChart.symbol === chart.symbol}
            id={`chart-tab-${chart.symbol.replace(":", "-")}`}
            key={chart.symbol}
            onClick={() => setActiveChart(chart)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            role="tab"
            tabIndex={activeChart.symbol === chart.symbol ? 0 : -1}
            type="button"
          >
            <b>{chart.label}</b><small>{chart.symbol}</small>
          </button>
        ))}
      </div>
      <TradingViewWidget key={activeChart.symbol} label={activeChart.label} symbol={activeChart.symbol} />
    </article>
  );
}

function Freshness({ dashboard }: { dashboard: MacroDashboardV1 }) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const refresh = () => setStale(Date.now() - Date.parse(dashboard.generatedAt) > 36 * 60 * 60 * 1000);
    refresh();
    const timer = window.setInterval(refresh, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [dashboard.generatedAt]);

  const state = stale ? "更新延迟" : dashboard.coverageStatus === "partial" ? "部分覆盖" : "已更新";
  return <span className="macro-freshness" data-state={stale || dashboard.coverageStatus === "partial" ? "delayed" : "current"}>{state}</span>;
}

export function MacroDashboard({ dashboard }: { dashboard: MacroDashboardV1 }) {
  const sources = new Map(dashboard.sources.map((source) => [source.id, source]));

  return (
    <>
      <section className="macro-hero" aria-labelledby="macro-title">
        <div className="macro-hero-label"><span>US MACRO</span><Freshness dashboard={dashboard} /></div>
        <h1 id="macro-title">{dashboard.headline}</h1>
        <p>{dashboard.summary}</p>
        <div className="macro-asof">
          <time dateTime={dashboard.generatedAt}>上海时间 {formatShanghaiTime(dashboard.generatedAt)}</time>
          <span>事件窗口：过去 24 小时 / 未来 7 天</span>
          {dashboard.coverageNote && <span>{dashboard.coverageNote}</span>}
        </div>
      </section>

      <section className="macro-impact-section" aria-labelledby="macro-impact-title">
        <div className="macro-section-heading"><span>EVENT → PORTFOLIO</span><h2 id="macro-impact-title">今日宏观影响</h2></div>
        {dashboard.impacts.length > 0 ? (
          <div className="macro-impact-grid">
            {dashboard.impacts.map((impact) => (
              <article className="macro-impact-card" data-direction={impact.direction} key={impact.eventId}>
                <div className="macro-impact-title"><span>{directionLabels[impact.direction]}</span><h3>{impact.title}</h3></div>
                <div className="macro-impact-body">
                  <div><b>已确认事实</b><p>{impact.fact}</p></div>
                  <div><b>传导路径</b><p>{impact.transmission}</p></div>
                  <div className="macro-implication"><b>组合含义</b><p>{impact.implication}</p></div>
                </div>
                <div className="macro-impact-meta">
                  <span>{impact.channels.map((channel) => channelLabels[channel]).join(" / ")}</span>
                  <span>{horizonLabels[impact.horizon]}</span>
                  <span>{confidenceLabels[impact.confidence]}</span>
                </div>
                <div className="macro-impact-footer">
                  <strong>{impact.tickers.join(" · ")}</strong>
                  <span>{impact.sourceIds.map((id) => sources.get(id)).filter(Boolean).map((source) => <a href={source!.url} key={source!.id} rel="noopener noreferrer" target="_blank">来源</a>)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="macro-empty">过去 24 小时没有纳入范围的高、中影响事件。</p>}
      </section>

      <section className="macro-chart-grid" aria-label="市场与利率走势">
        <ChartPanel charts={EQUITY_CHARTS} initialSymbol="AMEX:SPY" note="EQUITY" title="美国大盘" />
        <ChartPanel charts={BOND_CHARTS} initialSymbol="NASDAQ:IEF" note="RATES PROXY" title="美债期限 ETF" />
      </section>

      <section className="macro-events" aria-labelledby="macro-events-title">
        <div className="macro-section-heading"><span>NEXT 7 DAYS · ASIA/SHANGHAI</span><h2 id="macro-events-title">未来七天经济事件</h2></div>
        <div className="macro-event-list">
          {dashboard.upcomingEvents.map((event) => (
            <article key={event.id}>
              <time dateTime={event.scheduledAt}>{formatShanghaiTime(event.scheduledAt)}</time>
              <span className="macro-importance" data-level={event.importance}>{event.importance === "high" ? "高" : "中"}</span>
              <div><strong>{event.title}</strong><small>美国 · 待发布</small></div>
              <span className="macro-event-sources">{event.sourceIds.map((id) => sources.get(id)).filter(Boolean).map((source) => <a href={source!.url} key={source!.id} rel="noopener noreferrer" target="_blank">日程来源</a>)}</span>
            </article>
          ))}
        </div>
      </section>

      <footer className="macro-sources">
        <div><span>SOURCE LEDGER</span><h2>来源与口径</h2></div>
        <p>事件事实来自美国官方发布。组合影响为基于当前持仓的传导判断，不是交易指令。TradingView 行情可能因交易所权限而延迟。</p>
        <ol>{dashboard.sources.map((source) => <li key={source.id}><a href={source.url} rel="noopener noreferrer" target="_blank">{source.title}</a></li>)}</ol>
      </footer>
    </>
  );
}
