"use client";

import { useEffect, useState } from "react";

import type { SecFilingFeed, SecFilingWithSummary } from "@/lib/sec";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; feed: SecFilingFeed };

export function SecFilingsSection({ ticker }: { ticker: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [openAccession, setOpenAccession] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/sec/${encodeURIComponent(ticker)}/filings`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401 ? "登录状态已失效。" : "SEC 数据读取失败。");
        const feed = await response.json() as SecFilingFeed;
        setState({ status: "ready", feed });
        setOpenAccession(feed.filings[0]?.accessionNumber ?? null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setState({ status: "error", message: error instanceof Error ? error.message : "SEC 数据读取失败。" });
        }
      }
    })();
    return () => controller.abort();
  }, [ticker]);

  return (
    <section className="sec-filings-section" aria-labelledby="sec-filings-title">
      <div className="detail-section-heading">
        <div>
          <p className="section-kicker">Regulatory filings</p>
          <h2 id="sec-filings-title">SEC 文件与 AI 解读</h2>
        </div>
        {state.status === "ready" && state.feed.fetchedAt && (
          <span className="sec-updated">最近检查 {formatDateTime(state.feed.fetchedAt)}</span>
        )}
      </div>

      {state.status === "loading" && <p className="sec-state" role="status">正在读取 SEC 文件…</p>}
      {state.status === "error" && <p className="sec-state sec-state-error" role="alert">{state.message}</p>}
      {state.status === "ready" && (
        <>
          {state.feed.status === "not_applicable" && <p className="sec-state">该标的是 ETF，暂不提供公司型 10-K / 10-Q 解读。</p>}
          {state.feed.status === "unsupported" && <p className="sec-state">SEC 暂无该标的对应的 CIK，当前无法提供文件解读。</p>}
          {state.feed.status === "pending" && <p className="sec-state">后台正在准备 SEC 文件，完成后会自动显示在这里。</p>}
          {state.feed.status === "empty" && <p className="sec-state">最近没有 10-K、10-Q、8-K、20-F 或 6-K 文件。</p>}
          {state.feed.status === "stale" && <p className="sec-stale">{state.feed.error}</p>}
          {state.feed.filings.length > 0 && (
            <div className="sec-filing-list">
              {state.feed.filings.map((filing) => (
                <SecFilingCard
                  filing={filing}
                  isOpen={openAccession === filing.accessionNumber}
                  key={filing.accessionNumber}
                  onToggle={() => setOpenAccession((current) => current === filing.accessionNumber ? null : filing.accessionNumber)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SecFilingCard({
  filing,
  isOpen,
  onToggle,
}: {
  filing: SecFilingWithSummary;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const panelId = `sec-filing-${filing.accessionNumber.replace(/[^A-Za-z0-9]/g, "")}`;
  return (
    <article className="sec-filing-card">
      <button aria-controls={panelId} aria-expanded={isOpen} onClick={onToggle} type="button">
        <span className="sec-form-badge">{filing.form}</span>
        <span className="sec-filing-date"><strong>{formatDate(filing.filingDate)}</strong><small>申报日</small></span>
        <span className="sec-filing-description">
          <strong>{filing.description || formDescription(filing.form)}</strong>
          <small>{filing.reportDate ? `报告期 ${formatDate(filing.reportDate)}` : filing.items ? `事项 ${filing.items}` : "SEC filing"}</small>
        </span>
        <span className="sec-disclosure" aria-hidden="true">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && (
        <div className="sec-filing-body" id={panelId}>
          <FilingSummary filing={filing} />
          <a href={filing.indexUrl} rel="noopener noreferrer" target="_blank">查看 SEC EDGAR 原文 ↗</a>
        </div>
      )}
    </article>
  );
}

function FilingSummary({ filing }: { filing: SecFilingWithSummary }) {
  const summary = filing.summary;
  if (!summary) return <p className="sec-summary-pending">AI 解读正在后台生成。</p>;
  if (!summary.headline && !summary.bullets.length && !summary.analystView) {
    return <p className="sec-summary-error">AI 解读暂时不可用，后台将在 24 小时后重试。</p>;
  }
  return (
    <div className="sec-summary">
      {summary.headline && <p className="sec-summary-headline">{summary.headline}</p>}
      {summary.bullets.length > 0 && (
        <ul>
          {summary.bullets.map((bullet, index) => (
            <li data-importance={bullet.importance} key={`${bullet.label}-${index}`}>
              <i aria-hidden="true" />
              <span><strong>{bullet.label}</strong>{bullet.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {summary.analystView && <p className="sec-analyst-view"><span>投资含义</span>{summary.analystView}</p>}
      <small className="sec-ai-note">AI 基于 filing 原文生成 · {formatDateTime(summary.generatedAt)}</small>
    </div>
  );
}

function formDescription(form: string): string {
  if (form.startsWith("10-K") || form.startsWith("20-F")) return "年度报告";
  if (form.startsWith("10-Q")) return "季度报告";
  return "重大事项报告";
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(date);
}
