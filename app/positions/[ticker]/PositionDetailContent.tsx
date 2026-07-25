"use client";

import type { HoldingPlanRecord } from "@/lib/holding-plan-store";
import { money, number, percent } from "@/lib/portfolio-format";
import type { PositionGroupView } from "@/lib/portfolio-view-model";
import type { MarketQuote } from "@/lib/yahoo-quotes";
import { useMarketQuotes, type QuoteLoadStatus } from "@/app/use-market-quotes";
import { PlanEditor } from "./PlanEditor";
import { SecFilingsSection } from "./SecFilingsSection";

export type PositionPlanStatus = "ready" | "loading" | "unavailable";

export function PositionDetailContent({
  ticker,
  companyName,
  position,
  snapshotTime,
  plan,
  planStatus = "ready",
  quote,
  quoteStatus,
  onPlanDirtyChange,
}: {
  ticker: string;
  companyName: string;
  position?: PositionGroupView;
  snapshotTime: string;
  plan: HoldingPlanRecord | null;
  planStatus?: PositionPlanStatus;
  quote?: MarketQuote;
  quoteStatus?: QuoteLoadStatus;
  onPlanDirtyChange?: (dirty: boolean) => void;
}) {
  const localQuoteState = useMarketQuotes(ticker, quoteStatus === undefined);
  const activeQuoteStatus = quoteStatus ?? localQuoteState.status;
  const activeQuote = quote ?? localQuoteState.quotes[ticker];
  const quoteTime = activeQuote
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(activeQuote.marketTime))
    : null;

  return (
    <>
      <header className="detail-hero">
        <div>
          <p className="detail-eyebrow">{position ? "当前持仓" : "未持有 · 预先规划"}</p>
          <h1 id="position-detail-title">{ticker}</h1>
          <p className="detail-company">{companyName}</p>
        </div>
        <div className="detail-market-panel">
          <div className="detail-quote" aria-live="polite">
            <span>Yahoo Finance · 股价</span>
            {activeQuote ? (
              <>
                <strong>{money(activeQuote.price)}</strong>
                <i className={activeQuote.changePercent < 0 ? "loss" : activeQuote.changePercent > 0 ? "gain" : "muted"}>
                  {percent(activeQuote.changePercent, true)}
                </i>
                <small>{quoteTime}</small>
              </>
            ) : (
              <strong className="quote-unavailable">{activeQuoteStatus === "loading" ? "行情读取中" : "行情暂不可用"}</strong>
            )}
          </div>
          <div className="snapshot-note"><span>IBKR 快照</span><strong>{snapshotTime}</strong></div>
        </div>
      </header>

      {position ? (
        <>
          <section className="position-summary" aria-label={`${ticker} 持仓摘要`}>
            <article><span>净市值</span><strong>{money(position.value)}</strong></article>
            <article><span>净权重</span><strong>{percent(position.weight)}</strong></article>
            <article><span>持仓成本</span><strong>{money(position.cost)}</strong></article>
            <article><span>未实现盈亏</span><strong className={position.unrealized < 0 ? "loss" : "gain"}>{money(position.unrealized)}</strong></article>
            <article><span>年内净盈亏</span><strong className={position.netPnl < 0 ? "loss" : "gain"}>{money(position.netPnl)}</strong></article>
          </section>

          <section className="instrument-section" aria-labelledby="instrument-title">
            <div className="detail-section-heading"><div><p className="section-kicker">Position structure</p><h2 id="instrument-title">持仓构成</h2></div></div>
            <div className="table-wrap">
              <table className="instrument-table" aria-label={`${ticker} 正股与期权明细`}>
                <thead><tr><th>类型</th><th>资产 / 合约</th><th>数量</th><th>现价</th><th>平均成本</th><th>实际成本</th><th>持仓成本</th><th>市值</th><th>权重</th><th>未实现盈亏</th></tr></thead>
                <tbody>
                  {position.stock && <tr><td className="instrument-type" data-label="类型"><span className="asset-pill stock-pill">正股</span></td><td className="instrument-name" data-label="资产 / 合约"><strong>{position.stock.name}</strong></td><td data-label="数量">{number(position.stock.quantity, 0, 4)}</td><td data-label="现价">{money(position.stock.price)}</td><td data-label="平均成本">{money(position.stock.averageCost)}</td><td data-label="实际成本">{money(position.stock.actualCost)}</td><td data-label="持仓成本">{money(position.stock.cost)}</td><td data-label="市值">{money(position.stock.value)}</td><td data-label="权重">{percent(position.stock.weight)}</td><td data-label="未实现盈亏" className={position.stock.unrealized < 0 ? "loss" : "gain"}>{money(position.stock.unrealized)}</td></tr>}
                  {position.options.map((option) => <tr key={option.contract}><td className="instrument-type" data-label="类型"><span className="asset-pill option-pill">期权</span></td><td className="instrument-name" data-label="资产 / 合约"><strong className="option-contract">{option.contract}</strong></td><td data-label="数量">{number(option.quantity, 0, 4)}</td><td data-label="现价">{money(option.price)}</td><td data-label="平均成本">{money(option.averageCost)}</td><td className="muted" data-label="实际成本">—</td><td data-label="持仓成本">{money(option.cost)}</td><td data-label="市值">{money(option.marketValue)}</td><td data-label="权重">{percent(option.weight)}</td><td data-label="未实现盈亏" className={option.unrealized < 0 ? "loss" : "gain"}>{money(option.unrealized)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="no-position"><strong>暂无持仓数据</strong><span>这份计划不会写入 IBKR 账本；建立持仓后，快照数据会自动出现在这里。</span></section>
      )}

      <SecFilingsSection ticker={ticker} />

      {planStatus === "loading" ? (
        <section className="plan-editor plan-loading" aria-labelledby="plan-loading-title">
          <div className="detail-section-heading">
            <div><p className="section-kicker">Investment thesis</p><h2 id="plan-loading-title">持仓计划</h2></div>
          </div>
          <p role="status">正在读取计划…</p>
        </section>
      ) : (
        <PlanEditor
          key={ticker}
          ticker={ticker}
          initialPlan={plan}
          unavailable={planStatus === "unavailable"}
          onDirtyChange={onPlanDirtyChange}
        />
      )}
    </>
  );
}
