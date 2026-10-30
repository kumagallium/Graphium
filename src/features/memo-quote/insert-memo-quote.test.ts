// @vitest-environment jsdom
//
// insertMemoQuote / registerMemoQuote / reflectMemoQuote のテスト（実物の BlockNoteEditor で確かめる）。
//
// 対象の不変条件:
// - BlockNote 0.56 の quote ブロックは text の "\n" を改行として保つ（保存→読み込みの往復も）。
//   これが「本文の改行を残す」根拠
// - メモは常に quote 1 ブロック（出典なしも）。after の後ろ、省略なら文書の末尾に入り、新ブロックの id を返す
// - replaceIfEmpty は空／`/memo` だけの行を取り除く（取り除く前に onRemoveBlock）。中身のある行は残す
// - 空のメモ・挿入先が引けないときは何もしない（null）
// - 紐づけはストアに書く。「本文に反映」は中身を今のメモで置き換え、紐づけを更新する

import { describe, it, expect, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import {
  insertMemoQuote,
  isEmptyOrMemoSlashBlock,
  reflectMemoQuote,
  registerMemoQuote,
} from "./insert-memo-quote";
import type { CaptureEntry } from "../mobile-capture/capture-store";

const para = (id: string, text: string) => ({ id, type: "paragraph", content: text });
const makeEditor = (blocks: any[]) => BlockNoteEditor.create({ initialContent: blocks } as any) as any;
const memo = (text: string, id = "cap_1"): CaptureEntry => ({ id, text, createdAt: "2026-10-30T10:00:00.000Z" });
const plain = (block: any) => (block.content as any[]).map((c) => c.text).join("");

describe("quote ブロックと改行（BlockNote 0.56）", () => {
  it("text の \\n は取り出しでも \\n のまま、JSON の往復でも保たれる", () => {
    const editor = makeEditor([
      { type: "quote", content: [{ type: "text", text: "一行目\n二行目", styles: {} }] },
    ]);
    expect(plain(editor.document[0])).toBe("一行目\n二行目");
    const reloaded = makeEditor(JSON.parse(JSON.stringify(editor.document)));
    expect(plain(reloaded.document[0])).toBe("一行目\n二行目");
  });
});

describe("isEmptyOrMemoSlashBlock", () => {
  it("空・`/memo` だけは true、文字のある行・複数の inline は false", () => {
    expect(isEmptyOrMemoSlashBlock({ content: [] })).toBe(true);
    expect(isEmptyOrMemoSlashBlock({ content: [{ text: "  " }] })).toBe(true);
    expect(isEmptyOrMemoSlashBlock({ content: [{ text: "/memo" }] })).toBe(true);
    expect(isEmptyOrMemoSlashBlock({ content: [{ text: "メモ" }] })).toBe(false);
    expect(isEmptyOrMemoSlashBlock({ content: [{ text: "a" }, { text: "b" }] })).toBe(false);
    expect(isEmptyOrMemoSlashBlock({ content: "x" })).toBe(false);
    expect(isEmptyOrMemoSlashBlock(null)).toBe(false);
  });
});

describe("insertMemoQuote", () => {
  it("省略すると文書の末尾に quote を 1 個入れ、新ブロックの id を返す。出典なしのメモも quote", () => {
    const editor = makeEditor([para("a", "A"), para("b", "B")]);
    const id = insertMemoQuote(editor, memo("粒界に析出物"));
    expect(id).toBeTruthy();
    expect(editor.document).toHaveLength(3);
    const last = editor.document[2];
    expect(last.id).toBe(id);
    expect(last.type).toBe("quote");
    expect(plain(last)).toBe("粒界に析出物");
  });

  it("after の後ろに入れる。本文の改行と出典を保つ", () => {
    const editor = makeEditor([para("a", "A"), para("b", "B")]);
    const id = insertMemoQuote(editor, memo("行1\n行2\n\n— paper.pdf · p.3"), { after: "a" });
    expect(editor.document.map((b: any) => b.id)).toEqual(["a", id, "b"]);
    expect(plain(editor.getBlock(id))).toBe("行1\n行2\n— paper.pdf · p.3");
  });

  it("replaceIfEmpty: `/memo` だけの行は取り除き（先に onRemoveBlock）、中身のある行は残す", () => {
    const editor = makeEditor([para("a", "A"), para("slash", "/memo")]);
    const onRemoveBlock = vi.fn();
    const id = insertMemoQuote(editor, memo("メモ"), { after: "slash", replaceIfEmpty: "slash", onRemoveBlock });
    expect(onRemoveBlock).toHaveBeenCalledWith("slash");
    expect(editor.document.map((b: any) => b.id)).toEqual(["a", id]);

    const editor2 = makeEditor([para("a", "A"), para("text", "書きかけの文")]);
    const id2 = insertMemoQuote(editor2, memo("メモ"), { after: "text", replaceIfEmpty: "text" });
    expect(editor2.document.map((b: any) => b.id)).toEqual(["a", "text", id2]);
  });

  it("空のメモ・引けない挿入先では何も入れず null", () => {
    const editor = makeEditor([para("a", "A")]);
    expect(insertMemoQuote(editor, memo("   "))).toBeNull();
    expect(insertMemoQuote(editor, memo("メモ"), { after: "no-such-block" })).toBeNull();
    expect(insertMemoQuote(null, memo("メモ"))).toBeNull();
    expect(editor.document).toHaveLength(1);
  });
});

describe("registerMemoQuote / reflectMemoQuote", () => {
  const makeStore = () => ({ setQuote: vi.fn() });

  it("registerMemoQuote は紐づけ（メモの id・本文・日時）をストアに書く", () => {
    const store = makeStore();
    registerMemoQuote(store, "b1", memo("本文"), "2026-10-30T11:00:00.000Z");
    expect(store.setQuote).toHaveBeenCalledWith("b1", {
      captureId: "cap_1",
      quotedAt: "2026-10-30T11:00:00.000Z",
      quotedText: "本文",
    });
  });

  it("reflectMemoQuote は引用ブロックの中身を今のメモで置き換え、紐づけを更新する", () => {
    const editor = makeEditor([para("a", "A")]);
    const id = insertMemoQuote(editor, memo("古い本文"))!;
    const store = makeStore();
    const updated = memo("新しい本文\n二行目");
    expect(reflectMemoQuote(editor, store, id, updated, "2026-10-31T00:00:00.000Z")).toBe(true);
    expect(plain(editor.getBlock(id))).toBe("新しい本文\n二行目");
    expect(editor.getBlock(id).type).toBe("quote");
    expect(store.setQuote).toHaveBeenCalledWith(id, {
      captureId: "cap_1",
      quotedAt: "2026-10-31T00:00:00.000Z",
      quotedText: "新しい本文\n二行目",
    });
  });

  it("reflectMemoQuote: ブロックが無い・メモが空なら何もしない", () => {
    const editor = makeEditor([para("a", "A")]);
    const store = makeStore();
    expect(reflectMemoQuote(editor, store, "nope", memo("本文"))).toBe(false);
    expect(reflectMemoQuote(editor, store, "a", memo(" "))).toBe(false);
    expect(store.setQuote).not.toHaveBeenCalled();
    expect(plain(editor.getBlock("a"))).toBe("A");
  });
});
