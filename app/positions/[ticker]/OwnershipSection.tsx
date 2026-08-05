"use client";

import { useEffect, useState } from "react";

import type { OwnershipFeed } from "@/lib/ownership-service";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; feed: OwnershipFeed };

export function OwnershipSection({ ticker }: { ticker: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/ownership/${encodeURIComponent(ticker)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401 ? "登录状态已失效。" : "持仓结构读取失败。");
        const feed = await response.json() as OwnershipFeed;
        if (!controller.signal.aborted) setState({ status: "ready", feed });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setState({ status: "error", message: error instanceof Error ? error.message : "持仓结构读取失败。" });
        }
      }
    })();
    return () => controller.abort();
  }, [ticker]);

  return (
    <section className="ownership-section" id="ownership-structure" aria-labelledby="ownership-title">
      <div className="detail-section-heading">
        <h2 id="ownership-title">股权结构</h2>
        {state.status === "ready" && state.feed.fetchedAt && <span className="ownership-updated">本次扫描 {formatDateTime(state.feed.fetchedAt)}</span>}
      </div>

      {state.status === "loading" && <p className="ownership-state" role="status">正在检查最新披露…</p>}
      {state.status === "error" && <p className="ownership-state ownership-state-error" role="alert">{state.message}</p>}
      {state.status === "ready" && <OwnershipContent feed={state.feed} />}
    </section>
  );
}

function OwnershipContent({ feed }: { feed: OwnershipFeed }) {
  if (feed.status === "not_applicable") return <p className="ownership-state">该标的是 ETF，暂不提供个股持仓结构。</p>;
  if (feed.status === "pending" || feed.status === "unavailable") return <p className="ownership-state ownership-state-error">{feed.error ?? "暂时没有可用的持仓结构披露。"}</p>;

  const segments = [
    { key: "institutional", label: "机构披露持仓占比", value: feed.institutionalPct, className: "ownership-institutional" },
    { key: "insider", label: "内部人/大股东披露占比", value: feed.insiderMajorHolderPctEstimate, className: "ownership-insider" },
    { key: "retail", label: "散户及未分类估算占比", value: feed.retailUnclassifiedPct, className: "ownership-retail" },
  ];

  return (
    <>
      {feed.status === "stale" && <p className="ownership-stale">{feed.error}</p>}
      <div className="ownership-composition-bar" aria-label={`${feed.ticker} 持仓结构占比`} role="img">
        {segments.map((segment) => segment.value !== null && <span className={`ownership-bar-segment ${segment.className}`} key={segment.key} style={{ width: `${segment.value}%` }} />)}
      </div>
      <div className="ownership-metrics">
        {segments.map((segment) => (
          <article className={`ownership-metric ${segment.className}`} key={segment.key}>
            <span>{segment.label}</span>
            <strong>{formatPercent(segment.value)}</strong>
            {segment.key === "insider" && <small>估算</small>}
          </article>
        ))}
      </div>
      <p className="ownership-meta">
        数据截至 {formatDate(feed.dataAsOf)} · 季度末 + 45 天披露滞后（最晚约 {formatDate(feed.disclosureDueDate)}）
      </p>
      <p className="ownership-note">内部人/大股东为已披露持股估算；未能归入机构或已披露持有人的部分计入散户及未分类。</p>
    </>
  );
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(date);
}
