// メモの付け先（MemoTarget）の純関数テスト。
//
// 対象の不変条件:
// - memoTargetToSources: 付け先 → 保存形（sourceAsset / sourceNote）。none は何も付けない。
//   値の無い項目（title / pageNumber）はキーごと省く
// - toMemoExcerpt: 空白をまとめて 80 字で切る（サロゲートペアの途中では切らない）
// - resolveNoteViewContext: エディタにカーソルがあればブロック（空の段落は note）、
//   無くてサイドピークを開いていれば素材、それ以外は note
// - resolveQuickMemoTarget: 素材を見ていれば asset、ノートなら編集面の状況、それ以外は none

import { describe, it, expect } from "vitest";
import {
  memoTargetToSources,
  toMemoExcerpt,
  resolveNoteViewContext,
  resolveQuickMemoTarget,
  MEMO_EXCERPT_MAX,
  type MemoAssetRef,
} from "./memo-target";

const ASSET: MemoAssetRef = { fileId: "img-1", type: "image", name: "sem.png" };

describe("memoTargetToSources", () => {
  it("none は何も付けない", () => {
    expect(memoTargetToSources({ kind: "none" })).toEqual({});
  });

  it("note は sourceNote（fileId と題）だけ", () => {
    expect(memoTargetToSources({ kind: "note", fileId: "n1", title: "実験 1" })).toEqual({
      sourceNote: { fileId: "n1", title: "実験 1" },
    });
  });

  it("題が無い note は title のキーを持たない", () => {
    const { sourceNote } = memoTargetToSources({ kind: "note", fileId: "n1" });
    expect(sourceNote).toEqual({ fileId: "n1" });
    expect("title" in (sourceNote ?? {})).toBe(false);
  });

  it("block は blockId と blockText を足した sourceNote", () => {
    expect(
      memoTargetToSources({
        kind: "block",
        fileId: "n1",
        title: "実験 1",
        blockId: "b1",
        blockText: "粒界に析出物",
      }),
    ).toEqual({
      sourceNote: { fileId: "n1", title: "実験 1", blockId: "b1", blockText: "粒界に析出物" },
    });
  });

  it("素材ブロックの block は sourceAsset と sourceNote（blockId つき）の両方を持つ", () => {
    expect(
      memoTargetToSources({
        kind: "block",
        fileId: "n1",
        title: "実験 1",
        blockId: "b1",
        blockText: "sem.png",
        asset: { fileId: "img-1", type: "image", name: "sem.png" },
      }),
    ).toEqual({
      sourceAsset: { fileId: "img-1", type: "image" },
      sourceNote: { fileId: "n1", title: "実験 1", blockId: "b1", blockText: "sem.png" },
    });
  });

  it("素材に引けない block は sourceAsset のキーを持たない", () => {
    const r = memoTargetToSources({ kind: "block", fileId: "n1", blockId: "b1", blockText: "x" });
    expect("sourceAsset" in r).toBe(false);
  });

  it("素材ブロックのカーソルは、素材つきの block 付け先になる", () => {
    const view = resolveNoteViewContext({
      editorActive: true,
      cursorBlock: { id: "b1", label: "sem.png", asset: { fileId: "img-1", type: "image", name: "sem.png" } },
      peekAsset: null,
    });
    expect(view).toEqual({
      kind: "block",
      blockId: "b1",
      blockText: "sem.png",
      asset: { fileId: "img-1", type: "image", name: "sem.png" },
    });
    expect(
      resolveQuickMemoTarget({ viewingAsset: null, note: { fileId: "n1", title: "T" }, noteView: view }),
    ).toEqual({
      kind: "block",
      fileId: "n1",
      title: "T",
      blockId: "b1",
      blockText: "sem.png",
      asset: { fileId: "img-1", type: "image", name: "sem.png" },
    });
  });

  it("asset は sourceAsset（ページ番号は有るときだけ）", () => {
    expect(memoTargetToSources({ kind: "asset", ...ASSET })).toEqual({
      sourceAsset: { fileId: "img-1", type: "image" },
    });
    expect(
      memoTargetToSources({ kind: "asset", fileId: "p1", type: "pdf", name: "paper.pdf", pageNumber: 3 }),
    ).toEqual({ sourceAsset: { fileId: "p1", type: "pdf", pageNumber: 3 } });
  });
});

describe("toMemoExcerpt", () => {
  it("空・null は空文字", () => {
    expect(toMemoExcerpt("")).toBe("");
    expect(toMemoExcerpt(null)).toBe("");
    expect(toMemoExcerpt(undefined)).toBe("");
    expect(toMemoExcerpt("  \n ")).toBe("");
  });

  it("改行・連続する空白を 1 つの空白にまとめる", () => {
    expect(toMemoExcerpt("  粒界に\n\n析出物   あり ")).toBe("粒界に 析出物 あり");
  });

  it("80 字で切る", () => {
    const long = "あ".repeat(200);
    const out = toMemoExcerpt(long);
    expect(Array.from(out).length).toBe(MEMO_EXCERPT_MAX);
  });

  it("サロゲートペアの途中では切らない", () => {
    const text = "a".repeat(79) + "😀" + "b";
    const out = toMemoExcerpt(text);
    expect(out.endsWith("😀")).toBe(true);
    expect(Array.from(out).length).toBe(80);
  });
});

describe("resolveNoteViewContext", () => {
  it("エディタにカーソルがあり、ブロックに文字があれば block", () => {
    expect(
      resolveNoteViewContext({
        editorActive: true,
        cursorBlock: { id: "b1", label: "粒界" },
        peekAsset: null,
      }),
    ).toEqual({ kind: "block", blockId: "b1", blockText: "粒界" });
  });

  it("空の段落（抜粋が空）は note", () => {
    expect(
      resolveNoteViewContext({ editorActive: true, cursorBlock: { id: "b1", label: "" }, peekAsset: null }),
    ).toEqual({ kind: "note" });
    expect(resolveNoteViewContext({ editorActive: true, cursorBlock: null, peekAsset: null })).toEqual({
      kind: "note",
    });
  });

  it("エディタにカーソルが無く、素材のサイドピークを開いていれば asset", () => {
    expect(
      resolveNoteViewContext({ editorActive: false, cursorBlock: { id: "b1", label: "x" }, peekAsset: ASSET }),
    ).toEqual({ kind: "asset", asset: ASSET });
  });

  it("サイドピークを開いていても、本文で書いている最中ならブロックを優先する", () => {
    expect(
      resolveNoteViewContext({ editorActive: true, cursorBlock: { id: "b1", label: "x" }, peekAsset: ASSET }),
    ).toEqual({ kind: "block", blockId: "b1", blockText: "x" });
  });

  it("ノートを開いているだけなら note", () => {
    expect(resolveNoteViewContext({ editorActive: false, cursorBlock: null, peekAsset: null })).toEqual({
      kind: "note",
    });
  });
});

describe("resolveQuickMemoTarget", () => {
  const note = { fileId: "n1", title: "実験 1" };

  it("素材の全画面・ピークを見ていれば asset（ノートの状況より先）", () => {
    expect(
      resolveQuickMemoTarget({ viewingAsset: ASSET, note, noteView: { kind: "note" } }),
    ).toEqual({ kind: "asset", fileId: "img-1", type: "image", name: "sem.png" });
  });

  it("編集面が無ければ（一覧・ホーム・テンプレート編集）none", () => {
    expect(resolveQuickMemoTarget({ viewingAsset: null, note: null, noteView: null })).toEqual({ kind: "none" });
    expect(resolveQuickMemoTarget({ viewingAsset: null, note, noteView: null })).toEqual({ kind: "none" });
  });

  it("ノートのブロックにカーソルがあれば block（題つき）", () => {
    expect(
      resolveQuickMemoTarget({
        viewingAsset: null,
        note,
        noteView: { kind: "block", blockId: "b1", blockText: "粒界" },
      }),
    ).toEqual({ kind: "block", fileId: "n1", title: "実験 1", blockId: "b1", blockText: "粒界" });
  });

  it("ノートを開いているだけなら note", () => {
    expect(resolveQuickMemoTarget({ viewingAsset: null, note, noteView: { kind: "note" } })).toEqual({
      kind: "note",
      fileId: "n1",
      title: "実験 1",
    });
  });

  it("編集面内の素材ピークなら asset", () => {
    expect(
      resolveQuickMemoTarget({ viewingAsset: null, note, noteView: { kind: "asset", asset: ASSET } }),
    ).toMatchObject({ kind: "asset", fileId: "img-1" });
  });

  it("未保存の新規ノート（fileId なし）は note / block に付けられないので none", () => {
    expect(
      resolveQuickMemoTarget({ viewingAsset: null, note: { fileId: null }, noteView: { kind: "note" } }),
    ).toEqual({ kind: "none" });
    expect(
      resolveQuickMemoTarget({
        viewingAsset: null,
        note: { fileId: undefined },
        noteView: { kind: "block", blockId: "b", blockText: "t" },
      }),
    ).toEqual({ kind: "none" });
  });
});
