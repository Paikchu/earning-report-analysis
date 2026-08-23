"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

type SiteHeaderView = "portfolio" | "ledger" | "review" | "macro";

export function SiteHeader({
  active,
  onViewChange,
}: {
  active: SiteHeaderView;
  onViewChange?: (view: "portfolio" | "review") => void;
}) {
  function handleViewClick(event: MouseEvent<HTMLAnchorElement>, view: "portfolio" | "review") {
    if (!onViewChange) return;
    event.preventDefault();
    onViewChange(view);
  }

  return (
    <header className="site-header">
      <Link className="site-brand" href="/" aria-label="MAX 投资记录首页">
        <strong>MAX</strong>
        <span>投资记录</span>
      </Link>
      <nav className="site-primary-nav" aria-label="主要页面">
        <Link aria-current={active === "portfolio" ? "page" : undefined} href="/" onClick={(event) => handleViewClick(event, "portfolio")}>Portfolio</Link>
        <Link aria-current={active === "ledger" ? "page" : undefined} href="/ledger">投资账本</Link>
        <Link aria-current={active === "review" ? "page" : undefined} href="/?view=review" onClick={(event) => handleViewClick(event, "review")}>每日复盘</Link>
        <Link aria-current={active === "macro" ? "page" : undefined} href="/macro">今日宏观经济</Link>
      </nav>
    </header>
  );
}
