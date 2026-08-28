/**
 * Verification harness for the 8-K exhibit plan (docs/sec-8k-exhibit-plan.md).
 *
 * Proves three things against live SEC data using the project's real parsers:
 *   1. streaming `<accession>.txt` yields the authoritative EX-99.x documents
 *   2. `htmlToSecDocument` + `buildFilingBlocks` turn them into usable blocks
 *   3. exhibit-first block ranking beats the current `blocks.slice(0, 12)`
 *
 * Run: node --experimental-strip-types scripts/verify-8k-exhibits.ts
 */
import { buildFilingBlocks, type FilingBlock } from "../lib/sec-analysis.ts";
import { htmlToSecDocument } from "../lib/sec.ts";

const USER_AGENT = "Max Research max@example.com";

/** SEC document types worth keeping. EX-101.* is XBRL taxonomy, not a real exhibit. */
const KEEP = /^(8-K|6-K|8-K\/A|6-K\/A|EX-(?!101)\S+)$/i;
const DROP = /^(GRAPHIC|XML|JSON|ZIP|EX-101\S*)$/i;

const BOILERPLATE =
  /(check the appropriate box|emerging growth|commission file|i\.r\.s\. employer|state or other jurisdiction|principal executive office|registrant.s telephone|pursuant to section|shall not be deemed|written communication|soliciting material|pre-commencement|indicate by check mark|title of each class|trading symbol|name of each exchange)/i;

type SourceDoc = { type: string; filename: string; text: string };
type TaggedBlock = FilingBlock & { isBody: boolean; exhibitType: string };

/**
 * Streams the full-submission text and keeps only filing bodies and real exhibits.
 * GRAPHIC / XBRL payloads are discarded without being buffered, so peak memory stays
 * proportional to the largest single kept document rather than the whole download.
 */
async function streamSecDocuments(cik: string, accessionNumber: string): Promise<SourceDoc[]> {
  const accessionPath = accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${accessionNumber}.txt`;
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok || !response.body) throw new Error(`SEC full submission HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const kept: SourceDoc[] = [];
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("</DOCUMENT>");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary + 11);
      buffer = buffer.slice(boundary + 11);
      const open = chunk.indexOf("<DOCUMENT>");
      const body = open === -1 ? chunk : chunk.slice(open + 10);
      const type = (body.match(/<TYPE>([^\n<]*)/) ?? [])[1]?.trim() ?? "";
      const filename = (body.match(/<FILENAME>([^\n<]*)/) ?? [])[1]?.trim() ?? "";
      const text = (body.match(/<TEXT>([\s\S]*)$/) ?? [])[1] ?? "";
      if (KEEP.test(type) && !DROP.test(type)) kept.push({ type, filename, text });
      boundary = buffer.indexOf("</DOCUMENT>");
    }
  }
  return kept;
}

function blocksFor(doc: SourceDoc, accessionNumber: string): TaggedBlock[] {
  const isBody = /^(8-K|6-K)/i.test(doc.type);
  return buildFilingBlocks(htmlToSecDocument(doc.text).text, accessionNumber).map((block) => ({
    ...block,
    isBody,
    exhibitType: isBody ? doc.type : doc.type,
  }));
}

/** Exhibit-first, boilerplate-free, then ranked by numeric signal. */
function selectEventBlocks(blocks: TaggedBlock[], limit: number): TaggedBlock[] {
  return blocks
    .filter((block) => !BOILERPLATE.test(block.body.slice(0, 600)))
    .sort((left, right) =>
      Number(left.isBody) - Number(right.isBody) ||
      Number(right.elementType === "table_like") - Number(left.elementType === "table_like") ||
      right.numericDensity - left.numericDensity)
    .slice(0, limit);
}

const TARGETS = [
  { tag: "TSLA", cik: "1318605", accession: "0001628280-26-049213" },
  { tag: "NVDA", cik: "1045810", accession: "0001045810-26-000073" },
  { tag: "ORCL", cik: "1341439", accession: "0001193125-26-265848" },
  { tag: "AAPL", cik: "320193", accession: "0000320193-26-000018" },
];

for (const { tag, cik, accession } of TARGETS) {
  console.log(`\n${"=".repeat(72)}\n${tag}  ${accession}\n${"=".repeat(72)}`);
  const docs = await streamSecDocuments(cik, accession);

  let bodyChars = 0;
  let bodyBlocks = 0;
  let exhibitChars = 0;
  let exhibitBlocks = 0;

  for (const doc of docs) {
    const parsed = htmlToSecDocument(doc.text);
    const blocks = buildFilingBlocks(parsed.text, accession);
    const numeric = blocks.filter((block) => block.numericDensity >= 15).length;
    const tables = blocks.filter((block) => block.elementType === "table_like").length;
    if (/^(8-K|6-K)/i.test(doc.type)) {
      bodyChars += parsed.text.length;
      bodyBlocks += blocks.length;
    } else {
      exhibitChars += parsed.text.length;
      exhibitBlocks += blocks.length;
    }
    console.log(
      `  ${doc.type.padEnd(9)} ${doc.filename.padEnd(32)} html=${(doc.text.length / 1024).toFixed(0).padStart(5)}KB` +
        ` -> text=${(parsed.text.length / 1024).toFixed(1).padStart(6)}KB  blocks=${String(blocks.length).padStart(3)}` +
        `  numeric=${String(numeric).padStart(3)}  table_like=${String(tables).padStart(3)}`,
    );
  }

  console.log(`  ${"-".repeat(68)}`);
  console.log(`  BODY only (what the pipeline sees today): ${(bodyChars / 1024).toFixed(1).padStart(7)} KB / ${String(bodyBlocks).padStart(3)} blocks`);
  console.log(`  EXHIBITS (currently dropped)            : ${(exhibitChars / 1024).toFixed(1).padStart(7)} KB / ${String(exhibitBlocks).padStart(3)} blocks`);
  console.log(`  GAIN                                    : ${(exhibitChars / Math.max(bodyChars, 1)).toFixed(1)}x more text`);

  const all = docs.flatMap((doc) => blocksFor(doc, accession));
  const naive = all.slice(0, 12);
  const ranked = selectEventBlocks(all, 12);
  const stats = (blocks: TaggedBlock[]) => {
    const fromExhibit = blocks.filter((block) => !block.isBody).length;
    const boiler = blocks.filter((block) => BOILERPLATE.test(block.body.slice(0, 600))).length;
    const density = blocks.reduce((sum, block) => sum + block.numericDensity, 0) / Math.max(blocks.length, 1);
    return `${fromExhibit}/${blocks.length} from exhibits, ${boiler}/${blocks.length} boilerplate, avg density ${density.toFixed(0)}`;
  };
  console.log(`\n  block selection — CURRENT slice(0,12) : ${stats(naive)}`);
  console.log(`  block selection — EXHIBIT-FIRST      : ${stats(ranked)}`);
  console.log(`  ranked picks: ${ranked.slice(0, 6).map((block) => block.heading.slice(0, 30).trim()).join(" | ")}`);
}
