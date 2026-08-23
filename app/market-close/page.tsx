import type { Metadata } from "next";
import Link from "next/link";

import archiveData from "@/data/market-close-briefs.json";
import { validateMarketCloseBriefArchive, type MarketCloseBriefArchiveV1, type MarketCloseBriefV1, type MarketQuote } from "@/lib/market-close-brief";
import { SiteHeader } from "../site-header";

export const metadata: Metadata = {
  title: "昨日收盘总结 | MAX · 投资记录",
  description: "美股收盘数据、板块结构、主要事件与下一交易日关注。",
  openGraph: { title: "昨日收盘总结 | MAX · 投资记录", description: "美股收盘数据、板块结构、主要事件与下一交易日关注。", images: [] },
  twitter: { title: "昨日收盘总结 | MAX · 投资记录", description: "美股收盘数据、板块结构、主要事件与下一交易日关注。", images: [] },
};

const archive = archiveData as MarketCloseBriefArchiveV1;
const archiveErrors = validateMarketCloseBriefArchive(archive);
if (archiveErrors.length) throw new Error(`收盘复盘数据校验失败：${archiveErrors.join(" ")}`);

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChange(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function quoteTone(value: number) {
  return value > 0 ? "gain" : value < 0 ? "loss" : "muted";
}

function QuoteTable({ title, quotes }: { title: string; quotes: MarketQuote[] }) {
  return (
    <section className="market-close-table-panel" aria-label={title}>
      <h2>{title}</h2>
      <div className="market-close-table-wrap">
        <table>
          <thead><tr><th>标的</th><th>收盘</th><th>涨跌</th><th>幅度</th></tr></thead>
          <tbody>
            {quotes.map((quote) => (
              <tr key={quote.symbol}>
                <th><b>{quote.symbol}</b><span>{quote.name}</span></th>
                <td>{formatNumber(quote.close)}</td>
                <td className={quoteTone(quote.change)}>{formatChange(quote.change)}</td>
                <td className={quoteTone(quote.percent)}>{formatPercent(quote.percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourceLinks({ brief, ids }: { brief: MarketCloseBriefV1; ids: string[] }) {
  const sources = new Map(brief.sources.map((source) => [source.id, source]));
  return (
    <div className="market-close-inline-sources" aria-label="本节来源">
      {[...new Set(ids)].map((id) => {
        const source = sources.get(id);
        return source ? <a href={source.url} key={id} rel="noopener noreferrer" target="_blank">{source.title}</a> : null;
      })}
    </div>
  );
}

function BriefDocument({ brief }: { brief: MarketCloseBriefV1 }) {
  return (
    <>
      <header className="market-close-hero">
        <div className="market-close-kicker"><span>US CLOSE</span><time dateTime={brief.sessionDate}>{brief.sessionDate} · 美东交易日</time></div>
        <h1>{brief.headline}</h1>
        <p>{brief.summary}</p>
        <div className="market-close-trust">
          <span>收盘数据已自洽校验</span>
          <span>{brief.methodology.previousSessionDate ? "已完成跨日衔接" : "历史序列首份文件"}</span>
          <span>事实核查已完成</span>
        </div>
      </header>

      <div className="market-close-core-grid">
        <QuoteTable title="主要指数" quotes={brief.indices} />
        <QuoteTable title="指数 ETF" quotes={brief.etfs} />
      </div>

      <section className="market-close-sector-section" aria-labelledby="sector-title">
        <div className="market-close-section-heading"><span>11 SECTORS</span><h2 id="sector-title">板块全景</h2></div>
        <div className="market-close-sector-grid">
          {[...brief.sectors].sort((a, b) => b.percent - a.percent).map((sector) => (
            <article key={sector.symbol} data-tone={quoteTone(sector.percent)}>
              <div><b>{sector.symbol}</b><span>{sector.name}</span></div>
              <strong className={quoteTone(sector.percent)}>{formatPercent(sector.percent)}</strong>
            </article>
          ))}
        </div>
      </section>

      <div className="market-close-reading-grid">
        <article className="market-close-story">
          {brief.sections.map((section, index) => (
            <section key={section.id}>
              <div className="market-close-story-number">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                <SourceLinks brief={brief} ids={section.sourceIds} />
              </div>
            </section>
          ))}
        </article>

        <aside className="market-close-sidebar">
          <section>
            <div className="market-close-section-heading"><span>MOVERS</span><h2>关键异动</h2></div>
            <div className="market-close-movers">
              {brief.movers.map((mover) => (
                <article key={mover.symbol}>
                  <div><b>{mover.symbol}</b><strong className={quoteTone(mover.percent)}>{formatPercent(mover.percent)}</strong></div>
                  <p>{mover.catalyst}</p>
                </article>
              ))}
            </div>
          </section>
          <section>
            <div className="market-close-section-heading"><span>NEXT SESSION</span><h2>下个交易日关注</h2></div>
            <ol className="market-close-watch">
              {brief.watchItems.map((item) => <li key={item.title}><b>{item.title}</b><p>{item.detail}</p></li>)}
            </ol>
          </section>
        </aside>
      </div>

      <footer className="market-close-footer">
        <section>
          <div className="market-close-section-heading"><span>SOURCES</span><h2>数据来源</h2></div>
          <ol>
            {brief.sources.map((source) => <li key={source.id}><a href={source.url} rel="noopener noreferrer" target="_blank">{source.title}</a></li>)}
          </ol>
        </section>
        <section>
          <div className="market-close-section-heading"><span>METHODOLOGY</span><h2>口径说明</h2></div>
          <p>行情时间戳为 {new Date(brief.methodology.marketDataTimestamp).toLocaleString("zh-CN", { timeZone: "America/New_York", hour12: false })}（美东）。除特别标注外，均为常规交易时段收盘数据。</p>
          {brief.methodology.intradayFields.length > 0 && <p>{brief.methodology.intradayFields.join("、")}为报道时点数据，不作为收盘定格值。</p>}
          <p>{brief.disclaimer}</p>
        </section>
      </footer>
    </>
  );
}

export default async function MarketClosePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const brief = archive.items.find((item) => item.sessionDate === date) ?? archive.items[0];

  return (
    <>
      <a className="skip-link" href="#market-close-content">跳到收盘总结</a>
      <main className="page-shell market-close-shell" id="market-close-content">
        <SiteHeader active="market-close" />
        <div className="market-close-toolbar">
          <div><span>昨日收盘总结</span><small>每个完整交易日一份</small></div>
          <nav aria-label="历史收盘总结">
            {archive.items.map((item) => (
              <Link aria-current={item.sessionDate === brief.sessionDate ? "page" : undefined} href={`/market-close?date=${item.sessionDate}`} key={item.sessionDate}>{item.sessionDate}</Link>
            ))}
          </nav>
        </div>
        <BriefDocument brief={brief} />
      </main>
    </>
  );
}
