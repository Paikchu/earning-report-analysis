import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { getHoldingPlan, type HoldingPlanRecord } from "@/lib/holding-plan-store";
import { findSecurity, portfolioSnapshot, portfolioViewModel } from "@/lib/site-data";
import { normalizeTicker } from "@/lib/symbol-directory";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanEditor } from "./PlanEditor";

export const dynamic = "force-dynamic";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
const snapshotTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(portfolioSnapshot.generatedAt));

export default async function PositionPage({ params }: { params: Promise<{ ticker: string }> }) {
  const ticker = normalizeTicker((await params).ticker);
  const security = findSecurity(ticker);
  if (!security) notFound();
  const user = await requireChatGPTUser(`/positions/${encodeURIComponent(ticker)}`);
  const position = portfolioViewModel.positionGroups.find((group) => group.symbol === ticker);
  let plan: HoldingPlanRecord | null = null;
  let planUnavailable = false;
  try {
    plan = await getHoldingPlan(await getD1(), user.email, ticker);
  } catch {
    planUnavailable = true;
  }

  return (
    <main className="detail-shell">
      <Link className="back-link" href="/#ledger-title">← 返回投资账本</Link>

      <header className="detail-hero">
        <div>
          <p className="detail-eyebrow">{position ? "当前持仓" : "未持有 · 预先规划"}</p>
          <h1>{ticker}</h1>
          <p className="detail-company">{security.name}</p>
        </div>
        <div className="snapshot-note"><span>IBKR 快照</span><strong>{snapshotTime}</strong></div>
      </header>

      {position ? (
        <>
          <section className="position-summary" aria-label={`${ticker} 持仓摘要`}>
            <article><span>净市值</span><strong>{money(position.value)}</strong></article>
            <article><span>净权重</span><strong>{position.weight.toFixed(2)}%</strong></article>
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
                  {position.stock && <tr><td className="instrument-type" data-label="类型"><span className="asset-pill stock-pill">正股</span></td><td className="instrument-name" data-label="资产 / 合约"><strong>{position.stock.name}</strong></td><td data-label="数量">{number(position.stock.quantity)}</td><td data-label="现价">{money(position.stock.price)}</td><td data-label="平均成本">{money(position.stock.averageCost)}</td><td data-label="实际成本">{money(position.stock.actualCost)}</td><td data-label="持仓成本">{money(position.stock.cost)}</td><td data-label="市值">{money(position.stock.value)}</td><td data-label="权重">{position.stock.weight.toFixed(2)}%</td><td data-label="未实现盈亏" className={position.stock.unrealized < 0 ? "loss" : "gain"}>{money(position.stock.unrealized)}</td></tr>}
                  {position.options.map((option) => <tr key={option.contract}><td className="instrument-type" data-label="类型"><span className="asset-pill option-pill">期权</span></td><td className="instrument-name" data-label="资产 / 合约"><strong className="option-contract">{option.contract}</strong></td><td data-label="数量">{number(option.quantity)}</td><td data-label="现价">{money(option.price)}</td><td data-label="平均成本">{money(option.averageCost)}</td><td className="muted" data-label="实际成本">—</td><td data-label="持仓成本">{money(option.cost)}</td><td data-label="市值">{money(option.marketValue)}</td><td data-label="权重">{option.weight.toFixed(2)}%</td><td data-label="未实现盈亏" className={option.unrealized < 0 ? "loss" : "gain"}>{money(option.unrealized)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="no-position"><strong>暂无持仓数据</strong><span>这份计划不会写入 IBKR 账本；建立持仓后，快照数据会自动出现在这里。</span></section>
      )}

      <PlanEditor ticker={ticker} initialPlan={plan} unavailable={planUnavailable} />
    </main>
  );
}
