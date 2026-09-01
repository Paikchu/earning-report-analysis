"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { SEC_SUMMARY_VERSION, type SecEventCategory } from "@/lib/sec";
import { formatSecMetricLabel, formatSecMetricValue } from "@/lib/sec-metric-format";
import type { PublicSecFiling } from "@/lib/sec-public-api";

const expandEase = [0.22, 1, 0.36, 1] as const;

/** Distance from the bottom of the rail that starts the next page. */
const TIMELINE_PREFETCH_PX = 180;
/** Guard so an under-filled first screen cannot page through the whole history. */
const TIMELINE_AUTOFILL_LIMIT = 6;

type Page = { filings: PublicSecFiling[]; nextCursor: string | null; checkedAt: string | null; total?: number };

export function SecFilingsSection({ ticker, title = "SEC 文件与 AI 解读" }: { ticker: string; title?: string }) {
  const [filings, setFilings] = useState<PublicSecFiling[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [openAccessions, setOpenAccessions] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const filingsRef = useRef<PublicSecFiling[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autofillRounds = useRef(0);

  const load = useCallback(async (cursor: string | null, append: boolean) => {
    if (append) setLoadingMore(true);
    else setStatus("loading");
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=20` : "?limit=20";
      const response = await fetch(`/api/v1/companies/${encodeURIComponent(ticker)}/filings${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("SEC 数据读取失败。");
      const page = await response.json() as Page;
      const merged = append ? [...filingsRef.current, ...page.filings] : page.filings;
      filingsRef.current = merged;
      setFilings(merged);
      setNextCursor(page.nextCursor);
      setTotal(Math.max(page.total ?? 0, merged.length));
      if (!append) {
        autofillRounds.current = 0;
        setOpenAccessions(new Set(defaultOpenAccessions(merged)));
      }
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

  useEffect(() => {
    const restoreDefaultSummary = () => {
      if (filingsRef.current.length === 0) return;
      setOpenAccessions(new Set(defaultOpenAccessions(filingsRef.current)));
    };
    window.addEventListener("pageshow", restoreDefaultSummary);
    return () => window.removeEventListener("pageshow", restoreDefaultSummary);
  }, []);

  const toggleAccession = useCallback((accession: string) => {
    setOpenAccessions((current) => {
      const next = new Set(current);
      if (next.has(accession)) next.delete(accession);
      else next.add(accession);
      return next;
    });
  }, []);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    void load(nextCursor, true);
  }, [load, loadingMore, nextCursor]);

  const handleTimelineScroll = useCallback(() => {
    const rail = scrollRef.current;
    if (!rail || !nextCursor || loadingMore) return;
    if (rail.scrollHeight - rail.scrollTop - rail.clientHeight > TIMELINE_PREFETCH_PX) return;
    autofillRounds.current = 0;
    void load(nextCursor, true);
  }, [load, loadingMore, nextCursor]);

  // A tall viewport can leave the rail shorter than its own column, which would
  // hide the fact that more filings exist. Top it up until it can scroll.
  useEffect(() => {
    const rail = scrollRef.current;
    if (!rail || !nextCursor || loadingMore || status !== "ready") return;
    if (rail.scrollHeight > rail.clientHeight + 8) return;
    if (autofillRounds.current >= TIMELINE_AUTOFILL_LIMIT) return;
    autofillRounds.current += 1;
    void load(nextCursor, true);
  }, [filings, load, loadingMore, nextCursor, status]);

  return (
    <section className="sec-filings-section" id="sec-filings" aria-labelledby="sec-filings-title">
      <div className="detail-section-heading">
        <h2 id="sec-filings-title">{title}</h2>
      </div>
      {status === "loading" && <p className="sec-state" role="status">正在读取 SEC 文件…</p>}
      {status === "error" && <p className="sec-state sec-state-error" role="alert">SEC 数据读取失败。</p>}
      {status === "ready" && filings.length === 0 && <p className="sec-state">暂未收录该股票的 SEC 报告。</p>}
      {status === "ready" && filings.length > 0 && (
        <>
          <div className="sec-filing-scroll" ref={scrollRef} onScroll={handleTimelineScroll}>
            <div className="sec-filing-list">
              {filings.map((filing, index) => (
                <SecFilingCard
                  filing={filing}
                  isLatestPeriodic={isPeriodicFiling(filing.form) && !filings.slice(0, index).some((candidate) => isPeriodicFiling(candidate.form))}
                  isOpen={openAccessions.has(filing.accessionNumber)}
                  key={filing.accessionNumber}
                  onToggle={() => toggleAccession(filing.accessionNumber)}
                />
              ))}
            </div>
            <p className="sec-filing-rail-status" role="status">
              {loadingMore
                ? "正在载入更早申报…"
                : total > filings.length
                  ? `已显示 ${filings.length} / ${total} 份`
                  : `已显示全部 ${filings.length} 份申报`}
            </p>
          </div>
          <div className="sec-filing-footer">
            {nextCursor && (
              <button className="sec-load-more" type="button" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "正在读取…" : "加载更早申报"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SecFilingCard({ filing, isLatestPeriodic, isOpen, onToggle }: { filing: PublicSecFiling; isLatestPeriodic: boolean; isOpen: boolean; onToggle: () => void }) {
  const reduceMotion = useReducedMotion();
  const panelId = `sec-filing-${filing.accessionNumber.replace(/[^A-Za-z0-9]/g, "")}`;
  const duration = reduceMotion ? 0.01 : 0.38;
  const headline = filing.summary?.headline || filing.analysis?.headline || "";
  return (
    <article className={isOpen ? "sec-filing-card is-open" : "sec-filing-card"}>
      <button aria-controls={panelId} aria-expanded={isOpen} onClick={onToggle} type="button">
        <span className="sec-filing-date">
          <strong>{formatMonthDay(filing.filingDate)}</strong>
          <small>{formatYear(filing.filingDate)}</small>
        </span>
        <span className="sec-filing-entry">
          <span className="sec-filing-meta">
            <span className="sec-form-badge" data-form={filing.form}>{filing.form}</span>
            <small>{formDescription(filing.form)}{filing.reportDate ? ` · 报告期 ${formatMonthDay(filing.reportDate)}` : ""}</small>
            <span className="sec-disclosure" aria-hidden="true"><i /><i /></span>
          </span>
          <strong className="sec-filing-headline" data-pending={headline ? undefined : "true"}>
            {headline || "AI 解读生成中"}
          </strong>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            animate={{ height: "auto" }}
            className="sec-filing-panel"
            exit={{ height: 0 }}
            id={panelId}
            initial={{ height: 0 }}
            transition={{ duration, ease: expandEase }}
          >
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="sec-filing-body"
              exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
              initial={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.28, ease: expandEase }}
            >
              <FilingSummary filing={filing} isLatestPeriodic={isLatestPeriodic} />
              <a href={filing.edgarUrl} rel="noopener noreferrer" target="_blank">查看 SEC EDGAR 原文 ↗</a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function FilingSummary({ filing, isLatestPeriodic }: { filing: PublicSecFiling; isLatestPeriodic: boolean }) {
  if (isLatestPeriodic && filing.summary?.version === SEC_SUMMARY_VERSION && filing.summary.report) {
    return <div className="sec-summary sec-full-report-ready"><Link href={`/stocks/${encodeURIComponent(filing.ticker)}/sec/${encodeURIComponent(filing.accessionNumber)}`}>阅读完整报告 →</Link><small className="sec-ai-note">基于 SEC 原始申报 · {formatDateTime(filing.summary.generatedAt)}</small></div>;
  }
  if (filing.analysis) return <StructuredAnalysis filing={filing} />;
  const summary = filing.summary;
  if (!summary) return <p className="sec-summary-pending">AI 解读正在后台生成。</p>;
  if (!summary.headline && !summary.bullets.length && !summary.analystView) return <p className="sec-summary-error">AI 解读暂时不可用。</p>;
  const categoryLabel = summary.eventCategory ? EVENT_CATEGORY_LABELS[summary.eventCategory] : null;
  const reportLabel = summary.eventCategory === "earnings_update" || summary.eventCategory === "guidance" ? "业绩要点" : "事件详情";
  return (
    <div className="sec-summary">
      {categoryLabel && <span className="sec-event-category" data-category={summary.eventCategory}>{categoryLabel}</span>}
      {summary.bullets.length > 0 && (
        <ul>
          {summary.bullets.map((bullet, index) => (
            <li data-importance={bullet.importance} key={`${bullet.label}-${index}`}><i aria-hidden="true" /><span><strong>{bullet.label}</strong>{bullet.detail}</span></li>
          ))}
        </ul>
      )}
      {summary.report && <p className="sec-event-report"><span>{reportLabel}</span>{summary.report}</p>}
      {summary.analystView && <p className="sec-analyst-view"><span>投资含义</span>{summary.analystView}</p>}
      <small className="sec-ai-note">AI 基于 filing 原文生成 · {formatDateTime(summary.generatedAt)}</small>
    </div>
  );
}

const EVENT_CATEGORY_LABELS: Record<SecEventCategory, string> = {
  "earnings_update": "业绩更新",
  "guidance": "业绩指引",
  "m&a": "并购重组",
  "executive": "管理层变动",
  "legal": "法律事项",
  "other": "其他事项",
};

function StructuredAnalysis({ filing }: { filing: PublicSecFiling }) {
  const report = filing.analysis!;
  const changes = [...report.changes.qoq.map((change) => ({ ...change, label: "环比" })), ...report.changes.yoy.map((change) => ({ ...change, label: "同比" }))].filter((change) => change.changeType !== "not_mentioned").slice(0, 8);
  return (
    <div className="sec-summary sec-analysis">
      {report.keyMetrics.length > 0 && (
        <dl className="sec-analysis-metrics" aria-label="关键财务数据">
          {report.keyMetrics.slice(0, 6).map((metric) => (
            <div className="sec-analysis-metric" key={metric.metricKey}>
              <dt>{formatSecMetricLabel(metric.metricKey)}</dt>
              <dd>
                <strong>{formatSecMetricValue(metric.metricKey, metric.currentValue)}</strong>
                {metric.yoy && <small>同比 {metric.yoy}</small>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {changes.length > 0 && <ul className="sec-analysis-changes">{changes.map((change, index) => <li key={`${change.label}-${change.topicKey}-${index}`}><i aria-hidden="true" /><span><strong>{change.label} · {change.topicKey}</strong>{change.currentStatement ?? change.priorStatement ?? ""}</span></li>)}</ul>}
      {report.dataQuality.warnings.length > 0 && (
        <details className="sec-analysis-quality">
          <summary>数据口径与修正说明（{report.dataQuality.warnings.length}）</summary>
          {report.dataQuality.warnings.map((warning) => <p className="sec-analysis-warning" key={warning}>{warning}</p>)}
        </details>
      )}
      <small className="sec-ai-note">结构化财报解读 · {formatDateTime(filing.summary?.generatedAt ?? new Date().toISOString())}</small>
    </div>
  );
}

function isPeriodicFiling(form: string): boolean { return /^(10-K|10-Q|20-F)(\/A)?$/.test(form); }
function formDescription(form: string): string { return form.startsWith("10-K") || form.startsWith("20-F") ? "年度报告" : form.startsWith("10-Q") ? "季度报告" : "重大事项报告"; }
/** Only the two most recent filings start expanded; the rest of the rail stays collapsed. */
const TIMELINE_DEFAULT_OPEN = 2;
function defaultOpenAccessions(filings: PublicSecFiling[]): string[] {
  return filings.slice(0, TIMELINE_DEFAULT_OPEN).map((filing) => filing.accessionNumber);
}
function formatMonthDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : value;
}
function formatYear(value: string): string {
  const match = /^(\d{4})/.exec(value);
  return match ? match[1]! : "";
}
function formatDateTime(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(date) : value; }
