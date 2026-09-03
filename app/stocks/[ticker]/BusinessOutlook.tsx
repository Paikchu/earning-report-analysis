"use client";

import { useCallback, useEffect, useState } from "react";

import type { PublicCompanyAnalysisResponse } from "@/lib/company-analysis/contracts";

type RequestStatus = "loading" | "ready" | "empty" | "error";

export function BusinessOutlook({ ticker }: { ticker: string }) {
  const [status, setStatus] = useState<RequestStatus>("loading");
  const [analysis, setAnalysis] = useState<PublicCompanyAnalysisResponse | null>(null);

  const loadOverview = useCallback(async () => {
    setStatus("loading");
    try {
      const value = await requestOverview(ticker);
      setAnalysis(value);
      setStatus(value.overview ? "ready" : "empty");
    } catch {
      setAnalysis(null);
      setStatus("error");
    }
  }, [ticker]);

  useEffect(() => {
    const controller = new AbortController();
    void requestOverview(ticker, controller.signal).then((value) => {
      setAnalysis(value);
      setStatus(value.overview ? "ready" : "empty");
    }).catch(() => {
      if (controller.signal.aborted) return;
      setAnalysis(null);
      setStatus("error");
    });
    return () => controller.abort();
  }, [ticker]);

  if (status !== "ready" || !analysis?.overview) {
    return (
      <section className="stock-outlook stock-outlook--state" aria-labelledby="stock-outlook-heading">
        <span className="stock-outlook__eyebrow" id="stock-outlook-heading">业务前瞻 · AI 综述</span>
        {status === "loading" && <p className="stock-outlook__state" role="status">正在读取最新业务判断…</p>}
        {status === "empty" && <p className="stock-outlook__state">完整业务分析将在最新周期报告与 Yahoo 数据对齐后生成。</p>}
        {status === "error" && (
          <div className="stock-outlook__state-row" role="alert">
            <p className="stock-outlook__state">AI 业务综述暂时不可用。</p>
            <button type="button" onClick={() => void loadOverview()}>重新读取</button>
          </div>
        )}
      </section>
    );
  }

  const { overview } = analysis;
  return (
    <section className="stock-outlook" aria-labelledby="stock-outlook-heading" data-analysis-status={analysis.status}>
      <div className="stock-outlook__meta">
        <span className="stock-outlook__eyebrow" id="stock-outlook-heading">{overview.label}</span>
        <span>{analysis.period?.label}</span>
      </div>
      <h2 className="stock-outlook__headline">{overview.headline}</h2>
      <p className="stock-outlook__lede">{overview.introduction}</p>
      {analysis.status === "updating" && <p className="stock-outlook__updating">新一期数据正在校验，当前展示上一版已通过的结论。</p>}

      <ol className="stock-outlook__clues" aria-label="本次最重要的四项判断">
        {overview.highlights.map((highlight) => (
          <li className="stock-outlook__clue" key={highlight.ordinal}>
            <span className="stock-outlook__clue-index" aria-hidden="true">{highlight.ordinal}</span>
            <div>
              <h3 className="stock-outlook__clue-title">{highlight.title}</h3>
              <p className="stock-outlook__clue-desc">{highlight.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function requestOverview(ticker: string, signal?: AbortSignal): Promise<PublicCompanyAnalysisResponse> {
  const response = await fetch(`/api/v1/companies/${encodeURIComponent(ticker)}/analysis`, { signal });
  if (!response.ok) throw new Error("公司分析读取失败。");
  return response.json() as Promise<PublicCompanyAnalysisResponse>;
}
