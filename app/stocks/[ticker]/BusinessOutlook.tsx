"use client";

import { useEffect, useState } from "react";

import { SEC_SUMMARY_VERSION } from "@/lib/sec";
import type { PublicSecFiling } from "@/lib/sec-public-api";

type OutlookClue = { title: string; desc: string; source: string; flag: boolean };

type Outlook = {
  headline: string;
  lede: string;
  clues: OutlookClue[];
  expandHref: string;
  expandExternal: boolean;
};

type OutlookStatus = "loading" | "ready" | "empty" | "error";

const IMPORTANCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Approximates the mockup's cross-filing "business outlook" synthesis from a
 * single filing's existing AI summary/analysis, since no such cross-filing
 * pipeline exists yet. Real content, just a narrower lens than the mockup.
 */
export function BusinessOutlook({ ticker }: { ticker: string }) {
  const [status, setStatus] = useState<OutlookStatus>("loading");
  const [outlook, setOutlook] = useState<Outlook | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setStatus("loading");
      setOutlook(null);
      const response = await fetch(
        `/api/v1/companies/${encodeURIComponent(ticker)}/filings?limit=6`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("SEC 数据读取失败。");
      const page = await response.json() as { filings?: PublicSecFiling[] };
      const built = buildOutlook(page.filings ?? []);
      if (!built) {
        setStatus("empty");
        return;
      }
      setOutlook(built);
      setStatus("ready");
    })().catch(() => {
      if (controller.signal.aborted) return;
      setStatus("error");
    });
    return () => controller.abort();
  }, [ticker]);

  return (
    <section className="stock-outlook" aria-labelledby="stock-outlook-heading">
      <span className="stock-outlook__eyebrow" id="stock-outlook-heading">业务前瞻 · AI 综述</span>
      {status === "loading" && <p className="stock-outlook__state" role="status">正在读取最新申报…</p>}
      {status === "error" && <p className="stock-outlook__state" role="alert">AI 综述暂时不可用，请稍后重试。</p>}
      {status === "empty" && <p className="stock-outlook__state">该公司暂无可综述的 AI 解读。</p>}
      {status === "ready" && outlook && (
        <>
          <p className="stock-outlook__headline">{outlook.headline}</p>
          {outlook.lede && <p className="stock-outlook__lede">{outlook.lede}</p>}
          <ul className="stock-outlook__clues">
            {outlook.clues.map((clue, index) => (
              <li className="stock-outlook__clue" data-flag={clue.flag ? "true" : "false"} key={`${clue.title}-${index}`}>
                <span className="stock-outlook__clue-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <div className="stock-outlook__clue-title">{clue.title}</div>
                  <p className="stock-outlook__clue-desc">{clue.desc}</p>
                  <div className="stock-outlook__clue-source">源 · {clue.source}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="stock-outlook__footer">
            <a
              className="stock-outlook__expand"
              href={outlook.expandHref}
              {...(outlook.expandExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              展开完整业务综述
            </a>
          </div>
        </>
      )}
    </section>
  );
}

function buildOutlook(filings: PublicSecFiling[]): Outlook | null {
  for (const filing of filings) {
    const source = `${filing.form} ${formatDate(filing.filingDate)}`;

    if (filing.summary?.bullets?.length) {
      const bullets = [...filing.summary.bullets]
        .sort((a, b) => (IMPORTANCE_RANK[a.importance] ?? 2) - (IMPORTANCE_RANK[b.importance] ?? 2))
        .slice(0, 4);
      const { href, external } = expandTargetFor(filing);
      return {
        headline: filing.summary.headline || filing.analysis?.headline || bullets[0]!.label,
        lede: filing.summary.analystView,
        clues: bullets.map((bullet) => ({
          title: bullet.label,
          desc: bullet.detail,
          source,
          flag: bullet.importance === "high",
        })),
        expandHref: href,
        expandExternal: external,
      };
    }

    if (filing.analysis) {
      const analysis = filing.analysis;
      const candidates = [
        ...analysis.changes.risks.map((claim) => ({ topicKey: claim.topicKey, statement: claim.statement, materialityScore: claim.materialityScore, flag: true })),
        ...analysis.changes.guidance.map((claim) => ({ topicKey: claim.topicKey, statement: claim.statement, materialityScore: claim.materialityScore, flag: false })),
        ...analysis.changes.qoq.map((delta) => ({ topicKey: delta.topicKey, statement: delta.currentStatement ?? delta.priorStatement ?? "", materialityScore: delta.materialityScore, flag: false })),
        ...analysis.changes.yoy.map((delta) => ({ topicKey: delta.topicKey, statement: delta.currentStatement ?? delta.priorStatement ?? "", materialityScore: delta.materialityScore, flag: false })),
      ]
        .filter((candidate) => candidate.statement)
        .sort((a, b) => b.materialityScore - a.materialityScore);

      const seenTopics = new Set<string>();
      const picked: typeof candidates = [];
      for (const candidate of candidates) {
        if (seenTopics.has(candidate.topicKey)) continue;
        seenTopics.add(candidate.topicKey);
        picked.push(candidate);
        if (picked.length >= 4) break;
      }
      if (picked.length === 0) continue;

      const { href, external } = expandTargetFor(filing);
      return {
        headline: analysis.headline,
        lede: "",
        clues: picked.map((candidate) => ({
          title: truncateTitle(candidate.statement),
          desc: candidate.statement,
          source,
          flag: candidate.flag,
        })),
        expandHref: href,
        expandExternal: external,
      };
    }
  }
  return null;
}

function expandTargetFor(filing: PublicSecFiling): { href: string; external: boolean } {
  const isPeriodic = /^(10-K|10-Q|20-F)(\/A)?$/.test(filing.form);
  if (isPeriodic && filing.summary?.report && filing.summary.version === SEC_SUMMARY_VERSION) {
    return { href: `/stocks/${encodeURIComponent(filing.ticker)}/sec/${encodeURIComponent(filing.accessionNumber)}`, external: false };
  }
  return { href: filing.edgarUrl, external: true };
}

function truncateTitle(statement: string): string {
  const clauseEnd = statement.search(/[，。；;,.]/);
  const cut = clauseEnd > 4 && clauseEnd < 24 ? clauseEnd : Math.min(statement.length, 20);
  return statement.slice(0, cut).trim();
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", timeZone: "UTC" }).format(date)
    : value;
}
