// @メンション挿入の共通処理（メインエディタ・サイドピーク共通）の回帰ガード
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureTableRowIdentity,
  insertAssetMention,
  linkTableRowToNote,
  noteLinkCellAtCursor,
  recordMentionLink,
  tableCellAtCursor,
  tableRowAtCursor,
} from "./mention-insert";
import type { ReferenceSuggestion } from "./mention-menu";
import type { NoteLink, TableMeta } from "../../lib/document-types";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const cell = (content: any[]) => ({ type: "tableCell", content, props: {} });

/**
 * BlockNote エディタの最小の替え玉。document / getBlock / updateBlock と、
 * カーソル位置（ProseMirror の $from）だけを持つ。
 * cursor: 表の中なら { tableBlockId, rowIndex, colIndex? }、表の外なら null
 */
function fakeEditor(
  blocks: any[],
  cursor: { tableBlockId: string; rowIndex: number; colIndex?: number } | null,
) {
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
  // index(d) は d 段目の祖先の中で何番目の子にいるか。表の中なら
  // 1 段目（表を包むところ）で行の番号、2 段目（tableRow）で列の番号
  const $from = {
    depth: chain.length - 1,
    node: (d: number) => chain[d],
    index: (d: number) => (!cursor ? 0 : d === 1 ? cursor.rowIndex : d === 2 ? (cursor.colIndex ?? 0) : 0),
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

describe("tableCellAtCursor", () => {
  it("表の中なら行と列の番号、外なら null", () => {
    expect(tableCellAtCursor(fakeEditor([], { tableBlockId: "tbl", rowIndex: 2, colIndex: 1 }))).toEqual({
      tableBlockId: "tbl",
      rowIndex: 2,
      colIndex: 1,
    });
    expect(tableCellAtCursor(fakeEditor([], null))).toBeNull();
  });
});

// ── インデックステーブルの行の紐付け（メイン・ピーク共通） ──

/** 先頭列 Name に note-link が付いたインデックステーブル（2 列目は条件） */
const indexTable = () =>
  table([
    [cell([text("Name")]), cell([text("Cond")])],
    [cell([text("S1", { tableRowIdentity: "row_s1" })]), cell([text("80C", { textColor: "red" })])],
    [cell([text("S2", { tableRowIdentity: "row_s2" })]), cell([])],
  ]);
const noteLinkMeta = (): Record<string, TableMeta> => ({ tbl: { columns: { Name: ["note-link"] } } });

describe("noteLinkCellAtCursor", () => {
  const at = (cursor: { tableBlockId: string; rowIndex: number; colIndex?: number } | null, metas = noteLinkMeta()) =>
    noteLinkCellAtCursor(fakeEditor([indexTable()], cursor), (id) => metas[id]);

  it("note-link 列の見出し以外のセルなら、その位置を返す", () => {
    expect(at({ tableBlockId: "tbl", rowIndex: 2, colIndex: 0 })).toEqual({
      tableBlockId: "tbl",
      rowIndex: 2,
      colIndex: 0,
    });
  });

  it("他の列・見出し行・表の外では紐付けない（本文と同じ普通のメンションになる）", () => {
    expect(at({ tableBlockId: "tbl", rowIndex: 1, colIndex: 1 })).toBeNull();
    expect(at({ tableBlockId: "tbl", rowIndex: 0, colIndex: 0 })).toBeNull();
    expect(at(null)).toBeNull();
  });

  it("note-link のふるまいが無い表では紐付けない", () => {
    expect(at({ tableBlockId: "tbl", rowIndex: 1, colIndex: 0 }, {})).toBeNull();
    expect(at({ tableBlockId: "tbl", rowIndex: 1, colIndex: 0 }, { tbl: { caption: "Samples" } })).toBeNull();
  });
});

describe("linkTableRowToNote", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(initialNoteLinks: NoteLink[] = []) {
    const tbl = indexTable();
    (tbl.content as any).columnWidths = [140, undefined];
    const ed = fakeEditor([tbl], { tableBlockId: "tbl", rowIndex: 2, colIndex: 0 });
    let noteLinks = initialNoteLinks;
    const ops = {
      setNoteLink: vi.fn(),
      addLink: vi.fn(),
      updateNoteLinks: vi.fn((update: (links: NoteLink[]) => NoteLink[]) => {
        noteLinks = update(noteLinks);
      }),
      onLinked: vi.fn(),
    };
    return { ed, ops, noteLinks: () => noteLinks };
  }

  it("表の注釈・noteLinks を控え、打ったセルを青い @名前 に書き換えて行にリンクを紐づける", () => {
    const { ed, ops, noteLinks } = setup();
    linkTableRowToNote(() => ed, { tableBlockId: "tbl", rowIndex: 2, colIndex: 0 }, { id: "n-rich", label: "Rich" }, ops);

    // 表の注釈のキーは書き換えた後のセルの文字（行アイコン層はこれで「開く」行と判断する）
    expect(ops.setNoteLink).toHaveBeenCalledWith("tbl", "@Rich", "n-rich");
    expect(noteLinks()).toEqual([{ targetNoteId: "n-rich", sourceBlockId: "tbl", type: "derived_from" }]);
    expect(ops.onLinked).toHaveBeenCalled();
    // セルの書き換えはメニューが片付いてから
    expect(ed.updateBlock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    const content = ed.getBlock("tbl").content;
    // 打ったセルだけ書き換わり、行の identity は引き継がれる
    expect(content.rows[2].cells[0].content).toEqual([
      text("@Rich", { textColor: "blue", tableRowIdentity: "row_s2" }),
    ]);
    // 他の行・他の列はそのまま。列幅も戻らない
    expect(content.rows[1].cells).toEqual(indexTable().content.rows[1].cells);
    expect(content.rows[2].cells[1]).toEqual(cell([]));
    expect(content.columnWidths).toEqual([140, undefined]);
    // reference リンクはカーソルではなく打った行に紐づく
    expect(ops.addLink).toHaveBeenCalledWith({
      sourceBlockId: "tbl",
      targetBlockId: "",
      targetNoteId: "n-rich",
      type: "reference",
      createdBy: "human",
      sourceRowIdentity: "row_s2",
    });
  });

  it("同じノートへの noteLinks が既にあれば足さない", () => {
    const existing: NoteLink = { targetNoteId: "n-rich", sourceBlockId: "p1", type: "derived_from" };
    const { ed, ops, noteLinks } = setup([existing]);
    linkTableRowToNote(() => ed, { tableBlockId: "tbl", rowIndex: 2, colIndex: 0 }, { id: "n-rich", label: "Rich" }, ops);
    expect(noteLinks()).toEqual([existing]);
  });

  it("書き込む前にエディタが外れていたら、表には触らない（注釈は先に控える）", () => {
    const { ops } = setup();
    linkTableRowToNote(() => null, { tableBlockId: "tbl", rowIndex: 2, colIndex: 0 }, { id: "n-rich", label: "Rich" }, ops);
    vi.advanceTimersByTime(100);
    expect(ops.setNoteLink).toHaveBeenCalled();
    expect(ops.addLink).not.toHaveBeenCalled();
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

// ── 構造ガード: @ メニューを持つエディタは、どれも行の紐付けを共通の関数で行う ──
// SidePeek はメインの並行実装で、メインにだけ入った @ の行の紐付けがピークに無かった
// （行アイコンが「ノートを作成」のまま残り、押すと「@名前」という題の重複ノートができた）

const SRC_DIR = fileURLToPath(new URL("../..", import.meta.url));

/** src 配下の .ts/.tsx を列挙する（テストとストーリーは除く） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|spec|stories)\.tsx?$/.test(name)) continue;
    out.push(path);
  }
  return out;
}

describe("構造ガード", () => {
  // エディタに @ メニューの選択口（onMentionSelect）を渡しているファイル
  const editors = collectSourceFiles(SRC_DIR)
    .map((file) => ({ file: file.slice(SRC_DIR.length), source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes("onMentionSelect={"));

  it("メインエディタと SidePeek の両方を見つけている", () => {
    // prop 名が変わってガードが空振りするのを防ぐ
    const files = editors.map((e) => e.file);
    expect(files).toContain("note-app.tsx");
    expect(files).toContain("features/index-table/side-peek.tsx");
  });

  it("どのエディタも行の紐付けの判定と書き込みを mention-insert.ts の関数で行う", () => {
    const missing = editors
      .filter(({ source }) => !/\bnoteLinkCellAtCursor\(/.test(source) || !/\blinkTableRowToNote\(/.test(source))
      .map((e) => e.file);
    expect(
      missing,
      `インデックステーブルの note-link 列で選んだノートは noteLinkCellAtCursor / linkTableRowToNote で行に紐付けてください: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
