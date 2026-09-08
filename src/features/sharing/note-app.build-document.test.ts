// buildDocument が「出どころの記録」を保存のたびに落としていないかの回帰ガード。
//
// buildDocument はエディタの state からスクラッチで doc を組み直すので、そこに
// 書かれていないトップレベルのフィールドは保存のたびに黙って消える。実際に
// forkedFrom / templateFrom / sourceDocument* / partOfPlanNoteId が消えており、
// 「派生版」「テンプレート由来」の逆引き、文書ノートの判定、計画ノートとの
// 結び付きが、ノートを一度編集した時点で失われていた。
//
// note-app.tsx は巨大で jsdom で丸ごと描けないため、既存の回帰ガード
// （no-remote-hero.test.ts 等）と同じくソースを読んで形を固定する。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../../note-app.tsx"), "utf8");

/** buildDocument の本体（doc を組み立ててリビジョンを記録し終えるまで）を切り出す */
function buildDocumentBody(): string {
  const start = source.indexOf("const buildDocument = useCallback");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("prevPageRef.current = structuredClone", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("buildDocument が保存で落としてはいけないもの", () => {
  const body = buildDocumentBody();

  // sharedRef は例外。handleSave / handleShare で再注入する作りになっている
  it.each([
    ["forkedFrom", "共有ライブラリからの派生元（逆引きの「派生版」・変更の提案）"],
    ["templateFrom", "どのテンプレートから作ったか"],
    ["partOfPlanNoteId", "計画ノートとの結び付き"],
    ["sourceTextFileId", "取り込み元のテキスト"],
    ["sourceDocumentFileId", "取り込み元の文書（文書ノートの判定に使う）"],
    ["sourceDocumentName", "取り込み元の文書名"],
  ])("%s を initialDoc から引き継ぐ（%s）", (field) => {
    expect(body).toContain(`${field}: initialDoc?.${field},`);
  });

  it("sharedRef だけは buildDocument では組まない（保存・共有の経路で再注入する）", () => {
    expect(body).not.toContain("sharedRef:");
    expect(source).toContain("sharedRef: sharedRefState");
  });
});
