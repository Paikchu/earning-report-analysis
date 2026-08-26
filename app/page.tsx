import { SiteHeader } from "./site-header";

export default function HomePage() {
  return (
    <div className="sec-app-shell">
      <SiteHeader />
      <main className="sec-home">
        <div className="sec-home-copy">
          <p className="sec-home-kicker">SEC / AI</p>
          <h1>把财报读成<br />可追溯的判断。</h1>
          <p>输入股票代码，查看历史 SEC 原始申报、结构化指标与完整 AI 研报。</p>
        </div>
        <div className="sec-home-index">
          <span>01</span><strong>历史文件</strong><small>按申报日持续累积</small>
          <span>02</span><strong>原文证据</strong><small>每项结论回到 EDGAR</small>
          <span>03</span><strong>AI 解析</strong><small>仅展示已生成报告</small>
        </div>
      </main>
    </div>
  );
}
