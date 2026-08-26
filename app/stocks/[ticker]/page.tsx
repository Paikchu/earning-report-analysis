import { notFound } from "next/navigation";
import { SiteHeader } from "@/app/site-header";
import { findSecurity } from "@/lib/site-data";
import { normalizeTrackedTicker } from "@/lib/sec-config";
import { SecFilingsSection } from "@/app/positions/[ticker]/SecFilingsSection";

export const dynamic = "force-dynamic";

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const ticker = normalizeTrackedTicker((await params).ticker);
  if (!ticker) notFound();
  return (
    <div className="sec-app-shell">
      <SiteHeader initialQuery={findSecurity(ticker)?.symbol ?? ticker} />
      <main className="sec-only-stock-page">
        <SecFilingsSection ticker={ticker} />
      </main>
    </div>
  );
}
