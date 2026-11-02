// 書式ツールバーの「メモ」ボタン用の登録口と判定のテスト。
//
// 対象の不変条件:
// - 開き手はエディタ単位（別のエディタには効かない）。登録・解除・未登録
// - openSelectionMemo: 選択の先頭ブロックの ID と、選んだ文字の抜粋（80 字・空白まとめ）を渡す。
//   開き手が無い・先頭ブロックが取れないときは何もせず false
// - openMaterialMemo: 開き手の結果をそのまま返す。未登録は false
// - canOpenMaterialMemo: 開き手の登録されたエディタで、素材に引ける画像・動画・PDF だけ true

import { describe, it, expect, vi } from "vitest";
import {
  setSelectionMemoOpener,
  hasSelectionMemoOpener,
  openSelectionMemo,
  setMaterialMemoOpener,
  hasMaterialMemoOpener,
  openMaterialMemo,
  getSelectionStartBlockId,
  canOpenMaterialMemo,
} from "./memo-toolbar";

/** tiptap の selection.$from を真似た最小のエディタ。ancestors は浅い順 */
function fakeEditor(opts: { ancestors?: Array<{ name: string; id?: string }>; selected?: string } = {}) {
  const ancestors = opts.ancestors ?? [
    { name: "doc" },
    { name: "blockGroup" },
    { name: "blockContainer", id: "b1" },
    { name: "paragraph" },
  ];
  return {
    _tiptapEditor: {
      state: {
        selection: {
          $from: {
            depth: ancestors.length - 1,
            node: (d: number) => ({ type: { name: ancestors[d].name }, attrs: { id: ancestors[d].id } }),
          },
        },
      },
    },
    getSelectedText: () => opts.selected ?? "",
  };
}

describe("getSelectionStartBlockId", () => {
  it("選択の先頭から外へ辿って、最も内側の blockContainer の ID を返す", () => {
    const editor = fakeEditor({
      ancestors: [
        { name: "doc" },
        { name: "blockGroup" },
        { name: "blockContainer", id: "outer" },
        { name: "blockGroup" },
        { name: "blockContainer", id: "inner" },
        { name: "paragraph" },
      ],
    });
    expect(getSelectionStartBlockId(editor)).toBe("inner");
  });

  it("選択が無い・ブロックが無ければ null", () => {
    expect(getSelectionStartBlockId({})).toBeNull();
    expect(getSelectionStartBlockId(null)).toBeNull();
    expect(getSelectionStartBlockId(fakeEditor({ ancestors: [{ name: "doc" }] }))).toBeNull();
  });
});

describe("選んだ文にメモ", () => {
  it("開き手はエディタ単位で登録・解除できる", () => {
    const a = fakeEditor();
    const b = fakeEditor();
    const cb = vi.fn();
    expect(hasSelectionMemoOpener(a)).toBe(false);
    setSelectionMemoOpener(a, cb);
    expect(hasSelectionMemoOpener(a)).toBe(true);
    expect(hasSelectionMemoOpener(b)).toBe(false);
    setSelectionMemoOpener(a, null);
    expect(hasSelectionMemoOpener(a)).toBe(false);
  });

  it("先頭ブロックの ID と、選んだ文字の抜粋を開き手に渡す", () => {
    const editor = fakeEditor({ selected: "  粒界に\n析出物が   見える " });
    const cb = vi.fn();
    setSelectionMemoOpener(editor, cb);
    expect(openSelectionMemo(editor)).toBe(true);
    expect(cb).toHaveBeenCalledWith({ blockId: "b1", blockText: "粒界に 析出物が 見える" });
  });

  it("長い選択は 80 字で切る", () => {
    const editor = fakeEditor({ selected: "あ".repeat(200) });
    const cb = vi.fn();
    setSelectionMemoOpener(editor, cb);
    openSelectionMemo(editor);
    expect(Array.from(cb.mock.calls[0][0].blockText).length).toBe(80);
  });

  it("開き手が無い・先頭ブロックが取れないときは何もしない", () => {
    const noOpener = fakeEditor();
    expect(openSelectionMemo(noOpener)).toBe(false);

    const noBlock = fakeEditor({ ancestors: [{ name: "doc" }] });
    const cb = vi.fn();
    setSelectionMemoOpener(noBlock, cb);
    expect(openSelectionMemo(noBlock)).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("素材ブロックのメモ", () => {
  it("開き手の結果をそのまま返し、未登録は false", () => {
    const editor = fakeEditor();
    expect(openMaterialMemo(editor, "b1")).toBe(false);
    const cb = vi.fn(() => true);
    setMaterialMemoOpener(editor, cb);
    expect(hasMaterialMemoOpener(editor)).toBe(true);
    expect(openMaterialMemo(editor, "b1")).toBe(true);
    expect(cb).toHaveBeenCalledWith("b1");
    setMaterialMemoOpener(editor, () => false);
    expect(openMaterialMemo(editor, "b1")).toBe(false);
    setMaterialMemoOpener(editor, null);
    expect(hasMaterialMemoOpener(editor)).toBe(false);
  });

  describe("canOpenMaterialMemo", () => {
    const index = { media: [{ fileId: "f1", name: "a.png", type: "image" }] } as never;
    const extract = (url: string) => (url.startsWith("local:") ? url.slice(6) : null);

    it("開き手があり、素材に引ける画像・動画・PDF だけ true", () => {
      const editor = fakeEditor();
      setMaterialMemoOpener(editor, () => true);
      expect(canOpenMaterialMemo(editor, { type: "image", props: { url: "local:f1" } }, index, extract)).toBe(true);
      // 素材の索引に無い・外部 URL
      expect(canOpenMaterialMemo(editor, { type: "image", props: { url: "local:zzz" } }, index, extract)).toBe(false);
      expect(canOpenMaterialMemo(editor, { type: "image", props: { url: "https://x/a.png" } }, index, extract)).toBe(false);
      // 対象外のブロック型
      expect(canOpenMaterialMemo(editor, { type: "audio", props: { url: "local:f1" } }, index, extract)).toBe(false);
      expect(canOpenMaterialMemo(editor, null, index, extract)).toBe(false);
    });

    it("開き手が無いエディタでは false", () => {
      expect(canOpenMaterialMemo(fakeEditor(), { type: "image", props: { url: "local:f1" } }, index, extract)).toBe(false);
    });
  });
});
