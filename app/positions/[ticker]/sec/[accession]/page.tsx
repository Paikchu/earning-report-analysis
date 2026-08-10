import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { D1SecRepository } from "@/lib/sec-d1";
import { getCachedSecFeed } from "@/lib/sec-service";
import { cleanSecAccession } from "@/lib/sec";
import { findSecurity } from "@/lib/site-data";
import { normalizeTicker } from "@/lib/symbol-directory";
import { notFound } from "next/navigation";
import { SecReportDocument } from "./SecReportDocument";

export const dynamic = "force-dynamic";

export default async function SecReportPage({ params }: { params: Promise<{ ticker: string; accession: string }> }) {
  const route = await params;
  const ticker = normalizeTicker(route.ticker);
  const accession = cleanSecAccession(route.accession);
  const security = findSecurity(ticker);
  if (!security || security.type !== "stock" || !accession) notFound();

  await requireChatGPTUser(`/positions/${encodeURIComponent(ticker)}/sec/${encodeURIComponent(accession)}`);
  const feed = await getCachedSecFeed(new D1SecRepository(await getD1()), ticker);
  const filing = feed.filings.find((filing) => filing.ticker === ticker && filing.accessionNumber === accession);
  if (!filing) notFound();

  return <SecReportDocument companyName={security.name} filing={filing} />;
}
