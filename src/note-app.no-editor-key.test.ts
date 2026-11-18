// SandboxEditor に fileId 由来の鍵を付けないことを守る。
//
// 新しいノートは最初の保存で fileId が付く。そこで鍵が変わるとエディタが作り直され、
// 保存した時点の本文から始まるので、保存の最中に打った文字や挿したブロックが消える。
// ノートの切り替えは外側の key={fm.editorKey} が NoteEditor ごと作り直すので、
// 内側に鍵は要らない。note-app.tsx は単体で描画できないので、ソースの字面で見る。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "note-app.tsx"), "utf-8");

describe("SandboxEditor の鍵", () => {
  it("開始タグに key を付けない（最初の保存で作り直さない）", () => {
    const start = source.indexOf("<SandboxEditor");
    expect(start).toBeGreaterThan(-1);
    // 属性の中の `=>` を `/>` と取り違えないよう、`/>` を探す
    const end = source.indexOf("/>", start);
    expect(end).toBeGreaterThan(start);
    const tag = source.slice(start, end);
    // コメントを除いた属性部分だけを見る
    const attrs = tag.replace(/\/\/[^\n]*/g, "");
    expect(attrs).not.toMatch(/\bkey=/);
  });

  it("fileId 由来の鍵がどこにも残っていない", () => {
    expect(source).not.toMatch(/key=\{fileId/);
  });
});
