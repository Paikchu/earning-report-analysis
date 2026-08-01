import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("autosaves holding reasons and plan levels after edits settle", async () => {
  const editor = await readFile(new URL("../app/positions/[ticker]/PlanEditor.tsx", import.meta.url), "utf8");

  assert.match(editor, /useEffect/);
  assert.match(editor, /setTimeout\([^,]+, 700\)/);
  assert.match(editor, /自动保存中/);
  assert.match(editor, /已自动保存/);
  assert.match(editor, /onDirtyChange\?\.\(false\)/);
});
