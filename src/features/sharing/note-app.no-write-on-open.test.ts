// no-write-on-open: メインエディタが「変わっていなければ書き込まない」を守っているかの
// 回帰ガード。
//
// note-app.tsx は巨大で jsdom で丸ごと描けないため、既存の回帰ガード
// （note-app.build-document.test.ts 等）と同じくソースを読んで形を固定する。
//
// 守るべき不変条件（決定済みの直し方。docs/ARCHITECTURE.md §3.4 "Unsaved edits" 参照）:
//   A. handleSave / flushPending は、保存先へ書き込む直前に buildSavedForm で
//      「これから書く形」と lastSavedFormRef（最後に保存先にあった形）を比べ、
//      同じなら実際の書き込み（saveDoc / onSave）を呼ばない
//   B. ラベル・リンク・テーブル注釈・配置・OCR のストアの参照が変わっただけの effect は、
//      markDirty の前に同じ比較を行う（開いただけで「未保存」を出さない）
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../../note-app.tsx"), "utf8");

function bodyBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("no-write-on-open: メインエディタ", () => {
  it("lastSavedFormRef を initialDoc から buildSavedForm で作る（最初は開いたときの形）", () => {
    expect(source).toContain("const lastSavedFormRef = useRef<string | null>(");
    expect(source).toContain("initialDoc ? buildSavedForm(initialDoc) : null,");
  });

  it("handleSave: 保存の直前に buildSavedForm で比べ、同じなら saveDoc を呼ばない", () => {
    const body = bodyBetween("const handleSave = useCallback", "const flushPending = useCallback");
    const compareAt = body.indexOf("buildSavedForm(doc)");
    const saveAt = body.indexOf("saveDoc(doc)");
    expect(compareAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(-1);
    // 比較 → 早期 return → saveDoc、の順であること（比較が保存より後ろにあると、
    // 書いてから比べる = 書き込みを止められていない）
    expect(compareAt).toBeLessThan(saveAt);
    expect(body).toContain("if (form === lastSavedFormRef.current) return true;");
  });

  it("handleSave: 書き込みに成功したら lastSavedFormRef を進める", () => {
    const body = bodyBetween("const handleSave = useCallback", "const flushPending = useCallback");
    const saveAt = body.indexOf("if (!(await saveDoc(doc))) return false;");
    const updateAt = body.indexOf("lastSavedFormRef.current = form;");
    expect(saveAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(saveAt);
  });

  it("flushPending: 開いたまま・アンマウント時の書き出しでも、同じなら onSave を呼ばない", () => {
    const body = bodyBetween("const flushPending = useCallback", "// ── オートセーブ ──");
    const compareAt = body.indexOf("buildSavedForm(doc)");
    const onSaveAt = body.indexOf("onSave(target, doc, { unmounting: true })");
    expect(compareAt).toBeGreaterThan(-1);
    expect(onSaveAt).toBeGreaterThan(-1);
    expect(compareAt).toBeLessThan(onSaveAt);
    expect(body).toContain("if (form === lastSavedFormRef.current) return doc;");
  });

  it("ストアの参照が変わっただけの effect は、markDirty の前に buildSavedForm で比べる", () => {
    const body = bodyBetween(
      "// ラベル・リンク・テーブル注釈・配置変更時に自動保存トリガー",
      "// AI チャットパネル用ハンドラー",
    );
    const compareAt = body.indexOf("buildSavedForm(comparableDoc)");
    const markDirtyAt = body.indexOf("markDirty();");
    expect(compareAt).toBeGreaterThan(-1);
    expect(markDirtyAt).toBeGreaterThan(compareAt);
  });

  it("saved-form の比較に使う doc は sharedRef を含む（共有情報も比較対象）", () => {
    const handleSaveBody = bodyBetween("const handleSave = useCallback", "const flushPending = useCallback");
    expect(handleSaveBody).toContain("sharedRefState\n      ? { ...baseDoc, sharedRef: sharedRefState }");
    const effectBody = bodyBetween(
      "// ラベル・リンク・テーブル注釈・配置変更時に自動保存トリガー",
      "// AI チャットパネル用ハンドラー",
    );
    expect(effectBody).toContain("sharedRefState\n        ? { ...captured, sharedRef: sharedRefState }");
  });
});
