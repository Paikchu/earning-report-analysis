"use client";

import Link from "next/link";
import { useRef, type MouseEvent } from "react";

type SiteHeaderView = "portfolio" | "ledger" | "review" | "macro" | "market-close";

export function SiteHeader({
  active,
  onViewChange,
  onOpenSettings,
}: {
  active: SiteHeaderView;
  onViewChange?: (view: "portfolio" | "review") => void;
  onOpenSettings?: () => void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  function handleViewClick(event: MouseEvent<HTMLAnchorElement>, view: "portfolio" | "review") {
    if (!onViewChange) return;
    event.preventDefault();
    onViewChange(view);
  }

  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false;
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
        <Link aria-current={active === "market-close" ? "page" : undefined} href="/market-close">昨日收盘总结</Link>
      </nav>
      <details className="profile-menu" ref={menuRef}>
        <summary className="profile-trigger" aria-label="打开账户菜单"><span className="profile-avatar" aria-hidden="true" /></summary>
        <div className="profile-popover">
          {onOpenSettings ? (
            <button className="profile-menu-item" type="button" onClick={() => { closeMenu(); onOpenSettings(); }}>设置</button>
          ) : (
            <Link className="profile-menu-item" href="/?settings=1" onClick={closeMenu}>设置</Link>
          )}
        </div>
      </details>
    </header>
  );
}
