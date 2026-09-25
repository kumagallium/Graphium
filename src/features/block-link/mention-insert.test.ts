// @メンション挿入の共通処理（メインエディタ・サイドピーク共通）の回帰ガード
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureTableRowIdentity,
  insertAssetMention,
  recordMentionLink,
  tableRowAtCursor,
} from "./mention-insert";
import type { ReferenceSuggestion } from "./mention-menu";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const cell = (content: any[]) => ({ type: "tableCell", content, props: {} });

/**
 * BlockNote エディタの最小の替え玉。document / getBlock / updateBlock と、
 * カーソル位置（ProseMirror の $from）だけを持つ。
 * cursor: 表の中なら { tableBlockId, rowIndex }、表の外なら null
 */
function fakeEditor(blocks: any[], cursor: { tableBlockId: string; rowIndex: number } | null) {
  const store = new Map<string, any>(blocks.map((b) => [b.id, b]));
  // tableRow → blockContainer の順に外へ辿れる $from（間の table ノードは省略）
  const chain = cursor
    ? [
        { type: { name: "doc" } },
        { type: { name: "blockContainer" }, attrs: { id: cursor.tableBlockId } },
        { type: { name: "tableRow" } },
        { type: { name: "tableCell" } },
        { type: { name: "tableParagraph" } },
      ]
    : [
        { type: { name: "doc" } },
        { type: { name: "blockContainer" }, attrs: { id: "p1" } },
        { type: { name: "paragraph" } },
      ];
  const $from = {
    depth: chain.length - 1,
    node: (d: number) => chain[d],
    index: (d: number) => (cursor && d === 1 ? cursor.rowIndex : 0),
  };
  return {
    get document() {
      return [...store.values()];
    },
    getBlock: (id: string) => store.get(id),
    updateBlock: vi.fn((id: string, patch: { content: any }) => {
      store.set(id, { ...store.get(id), content: patch.content });
    }),
    insertInlineContent: vi.fn(),
    _tiptapEditor: { state: { selection: { $from } } },
  };
}

const table = (rows: any[][]) => ({
  id: "tbl",
  type: "table",
  content: { type: "tableContent", rows: rows.map((cells) => ({ cells })) },
  children: [],
});

describe("tableRowAtCursor", () => {
  it("表の中なら表ブロック ID と行の番号、外なら null", () => {
    expect(tableRowAtCursor(fakeEditor([], { tableBlockId: "tbl", rowIndex: 2 }))).toEqual({
      tableBlockId: "tbl",
      rowIndex: 2,
    });
    expect(tableRowAtCursor(fakeEditor([], null))).toBeNull();
    expect(tableRowAtCursor(null)).toBeNull();
  });
});

describe("ensureTableRowIdentity", () => {
  it("採番済みの行はその identity を返す", () => {
    const ed = fakeEditor(
      [table([[cell([text("Name")])], [cell([text("S1", { tableRowIdentity: "row_s1" })])]])],
      null,
    );
    expect(ensureTableRowIdentity(ed, { tableBlockId: "tbl", rowIndex: 1 })).toBe("row_s1");
  });

  it("保存前の新しい行は、保存時と同じ採番をその場で済ませてから返す", () => {
    const ed = fakeEditor([table([[cell([text("Name")])], [cell([text("S2")])]])], null);
    const identity = ensureTableRowIdentity(ed, { tableBlockId: "tbl", rowIndex: 1 });
    expect(identity).toMatch(/^row_/);
    // エディタ側の先頭セルにも印が付く（次の保存で同じ identity が保たれる）
    expect(ed.getBlock("tbl").content.rows[1].cells[0].content[0].styles.tableRowIdentity).toBe(identity);
  });

  it("見出し行・先頭セルが空の行は Entity ではないので undefined", () => {
    const ed = fakeEditor([table([[cell([text("Name")])], [cell([])]])], null);
    expect(ensureTableRowIdentity(ed, { tableBlockId: "tbl", rowIndex: 0 })).toBeUndefined();
    expect(ensureTableRowIdentity(ed, { tableBlockId: "tbl", rowIndex: 1 })).toBeUndefined();
  });
});

describe("recordMentionLink", () => {
  it("表のセルに入れたリンクには行の identity を控える", () => {
    const ed = fakeEditor(
      [table([[cell([text("Name")])], [cell([text("S1", { tableRowIdentity: "row_s1" })])]])],
      { tableBlockId: "tbl", rowIndex: 1 },
    );
    const addLink = vi.fn();
    recordMentionLink(ed, addLink, { sourceBlockId: "tbl", targetNoteId: "data:f1" });
    expect(addLink).toHaveBeenCalledWith({
      sourceBlockId: "tbl",
      targetBlockId: "",
      targetNoteId: "data:f1",
      type: "reference",
      createdBy: "human",
      sourceRowIdentity: "row_s1",
    });
  });

  it("表の外のリンクは従来どおり（行の identity なし）", () => {
    const addLink = vi.fn();
    recordMentionLink(fakeEditor([], null), addLink, { sourceBlockId: "p1", targetNoteId: "n1" });
    expect(addLink.mock.calls[0][0]).not.toHaveProperty("sourceRowIdentity");
  });

  it("row を渡すとカーソルではなくその行に紐づける（セルを書き換えて入れる経路）", () => {
    const ed = fakeEditor(
      [
        table([
          [cell([text("Name")])],
          [cell([text("S1", { tableRowIdentity: "row_s1" })])],
          [cell([text("S2", { tableRowIdentity: "row_s2" })])],
        ]),
      ],
      { tableBlockId: "tbl", rowIndex: 1 },
    );
    const addLink = vi.fn();
    recordMentionLink(ed, addLink, {
      sourceBlockId: "tbl",
      targetNoteId: "n2",
      row: { tableBlockId: "tbl", rowIndex: 2 },
    });
    expect(addLink.mock.calls[0][0].sourceRowIdentity).toBe("row_s2");
  });
});

describe("insertAssetMention", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const asset = (assetType: string, label: string): ReferenceSuggestion => ({
    type: "asset",
    id: "f1",
    label,
    group: "",
    assetType,
  });

  it("データ素材は @素材名 を入れ、外部ソース ID のリンクを記録し、引用素材に積む", () => {
    const ed = fakeEditor([], null);
    const addLink = vi.fn();
    const citeAsset = vi.fn();
    const onInserted = vi.fn();
    insertAssetMention(() => ed, "p1", asset("data", "🧾 spectrum.txt"), { addLink, citeAsset, onInserted });
    expect(citeAsset).toHaveBeenCalledWith("f1");
    expect(ed.insertInlineContent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(ed.insertInlineContent).toHaveBeenCalledWith([
      { type: "text", text: "@spectrum.txt", styles: { textColor: "blue" } },
      { type: "text", text: " ", styles: {} },
    ]);
    expect(addLink.mock.calls[0][0]).toMatchObject({ sourceBlockId: "p1", targetNoteId: "data:f1" });
    expect(onInserted).toHaveBeenCalled();
  });

  it("画像はインライン画像として入れ、リンクの記録も引用素材への追加もしない", () => {
    const ed = fakeEditor([], null);
    const addLink = vi.fn();
    const citeAsset = vi.fn();
    insertAssetMention(() => ed, "p1", asset("image", "🖼 photo.jpg"), { addLink, citeAsset });
    vi.advanceTimersByTime(100);
    expect(ed.insertInlineContent).toHaveBeenCalledWith([
      { type: "inlineImage", props: { fileId: "f1", name: "photo.jpg" } },
      { type: "text", text: " ", styles: {} },
    ]);
    expect(addLink).not.toHaveBeenCalled();
    expect(citeAsset).not.toHaveBeenCalled();
  });
});
