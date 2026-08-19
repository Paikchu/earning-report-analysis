import Link from "next/link";

export function SiteHeader({ active }: { active: "portfolio" | "macro" }) {
  return (
    <header className="site-header">
      <Link className="site-brand" href="/" aria-label="MAX 投资记录首页">
        <strong>MAX</strong>
        <span>投资记录</span>
      </Link>
      <nav className="site-primary-nav" aria-label="主要页面">
        <Link aria-current={active === "portfolio" ? "page" : undefined} href="/">投资组合</Link>
        <Link aria-current={active === "macro" ? "page" : undefined} href="/macro">宏观</Link>
      </nav>
    </header>
  );
}
