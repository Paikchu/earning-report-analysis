import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OutlookParagraph } from "../app/stocks/[ticker]/OutlookParagraph";

test("compact outlook preserves the complete paragraph instead of slicing generated analysis", () => {
  const text = "盈利增长与再投资支出并存，需要持续跟踪现金回报。".repeat(20);
  const html = renderToStaticMarkup(<OutlookParagraph text={text} label="背景说明" className="stock-outlook__lede" />);
  assert.ok(html.includes(text));
  assert.match(html, /data-expanded="false"/);
  assert.match(html, /stock-outlook__excerpt/);
  assert.doesNotMatch(html, /完整业务综述|依据|evidenceRefs/);
});

test("each outlook paragraph has a unique disclosure target without an unnecessary initial button", () => {
  const html = renderToStaticMarkup(<>
    <OutlookParagraph text="简短背景。" label="背景说明" className="stock-outlook__lede" />
    <OutlookParagraph text="简短判断。" label="第 01 项判断" className="stock-outlook__clue-desc" />
  </>);
  const ids = [...html.matchAll(/<p[^>]+id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.doesNotMatch(html, /<button/);
});
