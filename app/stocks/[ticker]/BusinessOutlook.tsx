"use client";

import { useEffect, useState } from "react";

import type { PublicCompanyAnalysisResponse } from "@/lib/company-analysis/contracts";
import { companyAnalysisNotice, shouldPollCompanyAnalysis } from "@/lib/company-analysis/display-state";

type RequestStatus = "loading" | "ready" | "empty" | "error";

export function BusinessOutlook({ ticker }: { ticker: string }) {
  return <BusinessOutlookContent key={ticker} ticker={ticker} />;
}

function BusinessOutlookContent({ ticker }: { ticker: string }) {
  const [status, setStatus] = useState<RequestStatus>("loading");
  const [analysis, setAnalysis] = useState<PublicCompanyAnalysisResponse | null>(null);

  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    async function loadOverview() {
      try {
        const value = await requestOverview(ticker, controller.signal);
        if (controller.signal.aborted) return;
        setAnalysis(value);
        setStatus(value.overview ? "ready" : "empty");
        // Read-only bounded polling, never generation from a page view.
        if (shouldPollCompanyAnalysis(value.latestRun) && polls++ < 20) {
          timer = setTimeout(() => void loadOverview(), 60_000);
        }
      } catch {
        if (controller.signal.aborted) return;
        // Retain an already displayed publication when a background read fails.
        setStatus((previous) => previous === "ready" ? previous : "error");
      }
    }
    void loadOverview();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [ticker, refresh]);

  if (status !== "ready" || !analysis?.overview) {
    return (
      <section className="stock-outlook stock-outlook--state" aria-labelledby="stock-outlook-heading">
        <span className="stock-outlook__eyebrow" id="stock-outlook-heading">业务前瞻 · AI 综述</span>
        {status === "loading" && <p className="stock-outlook__state" role="status">正在读取最新业务判断…</p>}
        {status === "empty" && (
          <div className="stock-outlook__state-row" role="status">
            <p className="stock-outlook__state">{companyAnalysisNotice(analysis?.latestRun)}</p>
            <button type="button" onClick={() => setRefresh((value) => value + 1)}>重新读取</button>
          </div>
        )}
        {status === "error" && (
          <div className="stock-outlook__state-row" role="alert">
            <p className="stock-outlook__state">AI 业务综述暂时不可用。</p>
            <button type="button" onClick={() => setRefresh((value) => value + 1)}>重新读取</button>
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
      {companyAnalysisNotice(analysis.latestRun, true) && <p className="stock-outlook__updating" role="status">{companyAnalysisNotice(analysis.latestRun, true)}</p>}

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
