import type { Metadata } from "next";

import macroData from "@/data/macro-dashboard.json";
import snapshotData from "@/data/portfolio-snapshot.json";
import { prepareMacroDashboardForDisplay, type MacroDashboardV1 } from "@/lib/macro-dashboard";
import type { PortfolioSnapshotV1 } from "@/lib/portfolio-snapshot";
import { SiteHeader } from "../site-header";
import { MacroDashboard } from "./macro-dashboard";

export const metadata: Metadata = {
  title: "宏观 | MAX · 投资记录",
  description: "美国宏观事件、利率与大盘走势。",
  openGraph: { title: "宏观 | MAX · 投资记录", description: "美国宏观事件、利率与大盘走势。", images: [] },
  twitter: { title: "宏观 | MAX · 投资记录", description: "美国宏观事件、利率与大盘走势。", images: [] },
};

const dashboard = macroData as MacroDashboardV1;
const snapshot = snapshotData as PortfolioSnapshotV1;

export default function MacroPage() {
  const prepared = prepareMacroDashboardForDisplay(dashboard, snapshot);
  if (prepared.errors.length) throw new Error(`宏观数据校验失败：${prepared.errors.join(" ")}`);

  return (
    <>
      <a className="skip-link" href="#macro-content">跳到宏观内容</a>
      <main className="page-shell macro-shell" id="macro-content">
        <SiteHeader active="macro" />
        <MacroDashboard dashboard={prepared.dashboard} />
      </main>
    </>
  );
}
