"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { SEC_SUMMARY_VERSION } from "@/lib/sec";
import type { PublicSecFiling } from "@/lib/sec-public-api";

type Page = { filings: PublicSecFiling[]; nextCursor: string | null; checkedAt: string | null };

export function SecFilingsSection({ ticker }: { ticker: string }) {
  const [filings, setFilings] = useState<PublicSecFiling[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [openAccession, setOpenAccession] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor: string | null, append: boolean) => {
    if (append) setLoadingMore(true);
    else setStatus("loading");
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=20` : "?limit=20";
      const response = await fetch(`/api/v1/companies/${encodeURIComponent(ticker)}/filings${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("SEC 数据读取失败。");
      const page = await response.json() as Page;
      setFilings((current) => append ? [...current, ...page.filings] : page.filings);
      setNextCursor(page.nextCursor);
      setCheckedAt(page.checkedAt);
      if (!append) setOpenAccession(page.filings[0]?.accessionNumber ?? null);
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }, [ticker]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(null, false); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section className="sec-filings-section" id="sec-filings" aria-labelledby="sec-filings-title">
      <div className="detail-section-heading">
        <h2 id="sec-filings-title">SEC 文件与 AI 解读</h2>
        {checkedAt && <span className="sec-updated">最近检查 {formatDateTime(checkedAt)}</span>}
      </div>
      {status === "loading" && <p className="sec-state" role="status">正在读取 SEC 文件…</p>}
      {status === "error" && <p className="sec-state sec-state-error" role="alert">SEC 数据读取失败。</p>}
      {status === "ready" && filings.length === 0 && <p className="sec-state">暂未收录该股票的 SEC 报告。</p>}
      {status === "ready" && filings.length > 0 && (
        <>
          <div className="sec-filing-list">
            {filings.map((filing, index) => (
              <SecFilingCard
                filing={filing}
                isLatestPeriodic={isPeriodicFiling(filing.form) && !filings.slice(0, index).some((candidate) => isPeriodicFiling(candidate.form))}
                isOpen={openAccession === filing.accessionNumber}
                key={filing.accessionNumber}
                onToggle={() => setOpenAccession((current) => current === filing.accessionNumber ? null : filing.accessionNumber)}
              />
            ))}
          </div>
          {nextCursor && <button className="sec-load-more" type="button" disabled={loadingMore} onClick={() => void load(nextCursor, true)}>{loadingMore ? "正在读取…" : "加载更早申报"}</button>}
        </>
      )}
    </section>
  );
}

function SecFilingCard({ filing, isLatestPeriodic, isOpen, onToggle }: { filing: PublicSecFiling; isLatestPeriodic: boolean; isOpen: boolean; onToggle: () => void }) {
  const panelId = `sec-filing-${filing.accessionNumber.replace(/[^A-Za-z0-9]/g, "")}`;
  return (
    <article className="sec-filing-card">
      <button aria-controls={panelId} aria-expanded={isOpen} onClick={onToggle} type="button">
        <span className="sec-form-badge">{filing.form}</span>
        <span className="sec-filing-date"><strong>{formatDate(filing.filingDate)}</strong><small>申报日</small></span>
        <span className="sec-filing-description"><strong>{filing.description || formDescription(filing.form)}</strong><small>{filing.reportDate ? `报告期 ${formatDate(filing.reportDate)}` : "SEC filing"}</small></span>
        <span className="sec-disclosure" aria-hidden="true">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && <div className="sec-filing-body" id={panelId}><FilingSummary filing={filing} isLatestPeriodic={isLatestPeriodic} /><a href={filing.edgarUrl} rel="noopener noreferrer" target="_blank">查看 SEC EDGAR 原文 ↗</a></div>}
    </article>
  );
}

function FilingSummary({ filing, isLatestPeriodic }: { filing: PublicSecFiling; isLatestPeriodic: boolean }) {
  if (isLatestPeriodic && filing.summary?.version === SEC_SUMMARY_VERSION && filing.summary.report) {
    return <div className="sec-summary sec-full-report-ready"><p className="sec-summary-headline">{filing.summary.headline || filing.analysis?.headline}</p><Link href={`/stocks/${encodeURIComponent(filing.ticker)}/sec/${encodeURIComponent(filing.accessionNumber)}`}>阅读完整报告 →</Link><small className="sec-ai-note">基于 SEC 原始申报 · {formatDateTime(filing.summary.generatedAt)}</small></div>;
  }
  if (filing.analysis) return <StructuredAnalysis filing={filing} />;
  const summary = filing.summary;
  if (!summary) return <p className="sec-summary-pending">AI 解读正在后台生成。</p>;
  if (!summary.headline && !summary.bullets.length && !summary.analystView) return <p className="sec-summary-error">AI 解读暂时不可用。</p>;
  return <div className="sec-summary">{summary.headline && <p className="sec-summary-headline">{summary.headline}</p>}{summary.bullets.length > 0 && <ul>{summary.bullets.map((bullet, index) => <li data-importance={bullet.importance} key={`${bullet.label}-${index}`}><i aria-hidden="true" /><span><strong>{bullet.label}</strong>{bullet.detail}</span></li>)}</ul>}{summary.analystView && <p className="sec-analyst-view"><span>投资含义</span>{summary.analystView}</p>}<small className="sec-ai-note">AI 基于 filing 原文生成 · {formatDateTime(summary.generatedAt)}</small></div>;
}

function StructuredAnalysis({ filing }: { filing: PublicSecFiling }) {
  const report = filing.analysis!;
  const changes = [...report.changes.qoq.map((change) => ({ ...change, label: "环比" })), ...report.changes.yoy.map((change) => ({ ...change, label: "同比" }))].filter((change) => change.changeType !== "not_mentioned").slice(0, 8);
  return (
    <div className="sec-summary sec-analysis">
      {report.headline && <p className="sec-summary-headline">{report.headline}</p>}
      {report.keyMetrics.length > 0 && <div className="sec-analysis-metrics" aria-label="关键财务数据">{report.keyMetrics.slice(0, 6).map((metric) => <div className="sec-analysis-metric" key={metric.metricKey}><span>{metric.metricKey}</span><strong>{metric.currentValue}</strong><small>{metric.qoq ? `环比 ${metric.qoq}` : "环比暂无可比数据"}{metric.yoy ? ` · 同比 ${metric.yoy}` : " · 同比暂无可比数据"}</small></div>)}</div>}
      {changes.length > 0 && <ul className="sec-analysis-changes">{changes.map((change, index) => <li key={`${change.label}-${change.topicKey}-${index}`}><i aria-hidden="true" /><span><strong>{change.label} · {change.topicKey}</strong>{change.currentStatement ?? change.priorStatement ?? ""}</span></li>)}</ul>}
      {report.dataQuality.warnings.map((warning) => <p className="sec-analysis-warning" key={warning}>{warning}</p>)}
      <small className="sec-ai-note">结构化财报解读 · {formatDateTime(filing.summary?.generatedAt ?? new Date().toISOString())}</small>
    </div>
  );
}

function isPeriodicFiling(form: string): boolean { return /^(10-K|10-Q|20-F)(\/A)?$/.test(form); }
function formDescription(form: string): string { return form.startsWith("10-K") || form.startsWith("20-F") ? "年度报告" : form.startsWith("10-Q") ? "季度报告" : "重大事项报告"; }
function formatDate(value: string): string { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date) : value; }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(date) : value; }
