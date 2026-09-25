// @メンション挿入の共通処理（メインエディタ・サイドピーク共通）の回帰ガード
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureTableRowIdentity,
  insertAssetMention,
  insertNoteMention,
  linkTableRowToNote,
  noteLinkCellAtCursor,
  recordMentionLink,
  tableCellAtCursor,
  tableRowAtCursor,
  tryConvertNoteLinkPaste,
  withDerivedFromLink,
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

// ── 表の外で選んだノート（メイン・ピーク共通） ──

describe("withDerivedFromLink", () => {
  const link = (targetNoteId: string, sourceBlockId: string): NoteLink => ({
    targetNoteId,
    sourceBlockId,
    type: "derived_from",
  });

  it("入れたノートへの派生関係を末尾に足す（既にある線は残す）", () => {
    expect(withDerivedFromLink([link("n-old", "p0")], "n-new", "p1")).toEqual([
      link("n-old", "p0"),
      link("n-new", "p1"),
    ]);
  });

  it("同じノートへの線が既にあれば、別のブロックからでも足さずに同じ配列を返す", () => {
    const links = [link("n-rich", "p0")];
    // 同じ配列（参照）が返るので、書き込み口は書き換え不要と分かる
    expect(withDerivedFromLink(links, "n-rich", "p1")).toBe(links);
  });
});

describe("insertNoteMention", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(
    initialNoteLinks: NoteLink[] = [],
    cursor: { tableBlockId: string; rowIndex: number; colIndex?: number } | null = null,
  ) {
    const ed = fakeEditor([indexTable()], cursor);
    let noteLinks = initialNoteLinks;
    const ops = {
      addLink: vi.fn(),
      updateNoteLinks: vi.fn((update: (links: NoteLink[]) => NoteLink[]) => {
        noteLinks = update(noteLinks);
      }),
      onInserted: vi.fn(),
    };
    return { ed, ops, noteLinks: () => noteLinks };
  }

  it("青い @タイトル を入れてから、reference リンクと noteLinks の派生関係を記録する", () => {
    const { ed, ops, noteLinks } = setup();
    insertNoteMention(() => ed, "p1", { id: "n-rich", label: "Rich" }, ops);

    // メニューが閉じて入力中の `@…` が片付いてから入れる
    expect(ed.insertInlineContent).not.toHaveBeenCalled();
    expect(ops.updateNoteLinks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    expect(ed.insertInlineContent).toHaveBeenCalledWith([
      { type: "text", text: "@Rich", styles: { textColor: "blue" } },
      { type: "text", text: " ", styles: {} },
    ]);
    expect(ops.addLink).toHaveBeenCalledWith({
      sourceBlockId: "p1",
      targetBlockId: "",
      targetNoteId: "n-rich",
      type: "reference",
      createdBy: "human",
    });
    expect(noteLinks()).toEqual([{ targetNoteId: "n-rich", sourceBlockId: "p1", type: "derived_from" }]);
    expect(ops.onInserted).toHaveBeenCalled();
    // 記録は入れた後（本文に無いリンクを残さない。スラッシュの「新しいノート」と同じ順）
    const inserted = ed.insertInlineContent.mock.invocationCallOrder[0];
    expect(ops.addLink.mock.invocationCallOrder[0]).toBeGreaterThan(inserted);
    expect(ops.updateNoteLinks.mock.invocationCallOrder[0]).toBeGreaterThan(inserted);
  });

  it("同じノートへの線が既にあれば noteLinks は足さない（@リンクとリンクは入れる）", () => {
    const existing: NoteLink[] = [{ targetNoteId: "n-rich", sourceBlockId: "p0", type: "derived_from" }];
    const { ed, ops, noteLinks } = setup(existing);
    insertNoteMention(() => ed, "p1", { id: "n-rich", label: "Rich" }, ops);
    vi.advanceTimersByTime(100);

    expect(noteLinks()).toBe(existing);
    expect(ed.insertInlineContent).toHaveBeenCalled();
    expect(ops.addLink).toHaveBeenCalled();
  });

  it("表のセル（note-link 列以外）に入れたら、リンクに行の identity を控える", () => {
    const { ed, ops, noteLinks } = setup([], { tableBlockId: "tbl", rowIndex: 1, colIndex: 1 });
    insertNoteMention(() => ed, "tbl", { id: "n-rich", label: "Rich" }, ops);
    vi.advanceTimersByTime(100);

    expect(ops.addLink.mock.calls[0][0]).toMatchObject({ sourceBlockId: "tbl", sourceRowIdentity: "row_s1" });
    expect(noteLinks()).toEqual([{ targetNoteId: "n-rich", sourceBlockId: "tbl", type: "derived_from" }]);
  });

  it("入れる前にエディタが外れていたら、何も記録しない", () => {
    const { ops } = setup();
    insertNoteMention(() => null, "p1", { id: "n-rich", label: "Rich" }, ops);
    vi.advanceTimersByTime(100);

    expect(ops.addLink).not.toHaveBeenCalled();
    expect(ops.updateNoteLinks).not.toHaveBeenCalled();
    expect(ops.onInserted).not.toHaveBeenCalled();
  });
});

describe("tryConvertNoteLinkPaste", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** paste イベントの替え玉（既処理フラグを載せられるよう素のオブジェクト） */
  const pasteEvent = () =>
    ({ preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }) as unknown as ClipboardEvent & {
      preventDefault: ReturnType<typeof vi.fn>;
      stopImmediatePropagation: ReturnType<typeof vi.fn>;
    };

  function setup(cursorBlockId: string | null = "p1", initialNoteLinks: NoteLink[] = []) {
    const ed = {
      ...fakeEditor([indexTable()], null),
      getTextCursorPosition: () => (cursorBlockId ? { block: { id: cursorBlockId } } : undefined),
    };
    let noteLinks = initialNoteLinks;
    const ops = {
      editor: ed,
      getEditor: () => ed,
      resolveTitle: (id: string) => (id === "n-rich" ? "Rich" : null),
      addLink: vi.fn(),
      updateNoteLinks: vi.fn((update: (links: NoteLink[]) => NoteLink[]) => {
        noteLinks = update(noteLinks);
      }),
    };
    return { ed, ops, noteLinks: () => noteLinks };
  }

  it("ノートリンクを @タイトル にし、reference リンクと noteLinks の派生関係を記録する", () => {
    const { ed, ops, noteLinks } = setup();
    const e = pasteEvent();
    expect(tryConvertNoteLinkPaste(e, "https://example.com/Graphium/#note/n-rich", ops)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopImmediatePropagation).toHaveBeenCalled();

    // 貼り付けは片付けるものが無いので次のタスクで入る
    vi.advanceTimersByTime(0);
    expect(ed.insertInlineContent).toHaveBeenCalledWith([
      { type: "text", text: "@Rich", styles: { textColor: "blue" } },
      { type: "text", text: " ", styles: {} },
    ]);
    expect(ops.addLink).toHaveBeenCalledWith(
      expect.objectContaining({ sourceBlockId: "p1", targetNoteId: "n-rich", type: "reference" }),
    );
    expect(noteLinks()).toEqual([{ targetNoteId: "n-rich", sourceBlockId: "p1", type: "derived_from" }]);
  });

  it("ID は URL デコードして引く", () => {
    const { ops } = setup();
    const resolveTitle = vi.fn(() => "日本語");
    tryConvertNoteLinkPaste(pasteEvent(), "#note/%E3%81%82", { ...ops, resolveTitle });
    expect(resolveTitle).toHaveBeenCalledWith("あ");
  });

  it("同じイベントが 2 回届いても（リスナーの二重登録）1 回だけ入れる", () => {
    const { ed, ops } = setup();
    const e = pasteEvent();
    expect(tryConvertNoteLinkPaste(e, "#note/n-rich", ops)).toBe(true);
    expect(tryConvertNoteLinkPaste(e, "#note/n-rich", ops)).toBe(true);
    vi.advanceTimersByTime(0);
    expect(ed.insertInlineContent).toHaveBeenCalledTimes(1);
    expect(ops.addLink).toHaveBeenCalledTimes(1);
    expect(ops.updateNoteLinks).toHaveBeenCalledTimes(1);
  });

  it("ノートリンクでない・一覧に無いノートなら引き受けない（通常の貼り付けに任せる）", () => {
    const { ed, ops } = setup();
    const e = pasteEvent();
    expect(tryConvertNoteLinkPaste(e, "https://example.com/", ops)).toBe(false);
    expect(tryConvertNoteLinkPaste(e, "#note/n-missing", ops)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(ed.insertInlineContent).not.toHaveBeenCalled();
  });

  it("同じノートへの線が既にあれば noteLinks は足さない", () => {
    const existing: NoteLink[] = [{ targetNoteId: "n-rich", sourceBlockId: "p0", type: "derived_from" }];
    const { ops, noteLinks } = setup("p1", existing);
    tryConvertNoteLinkPaste(pasteEvent(), "#note/n-rich", ops);
    vi.advanceTimersByTime(0);
    expect(noteLinks()).toBe(existing);
    expect(ops.addLink).toHaveBeenCalled();
  });

  it("カーソルのブロックが分からなければ @タイトル だけ入れ、リンクは記録しない", () => {
    const { ed, ops } = setup(null);
    expect(tryConvertNoteLinkPaste(pasteEvent(), "#note/n-rich", ops)).toBe(true);
    vi.advanceTimersByTime(0);
    expect(ed.insertInlineContent).toHaveBeenCalled();
    expect(ops.addLink).not.toHaveBeenCalled();
    expect(ops.updateNoteLinks).not.toHaveBeenCalled();
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

// ── 構造ガード: @ メニューを持つエディタは、どれもノートの挿入を共通の関数で行う ──
// SidePeek はメインの並行実装で、メインにだけ入った処理がピークに無かった:
// - @ の行の紐付け（行アイコンが「ノートを作成」のまま残り、押すと「@名前」という題の
//   重複ノートができた）
// - 表の外で入れたノートの noteLinks（@ したノートへの派生元の線がグラフ・来歴に出なかった）

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

  it("どのエディタも表の外で選んだノートを mention-insert.ts の関数で入れる", () => {
    // @リンク・reference リンク・noteLinks の派生関係をまとめて記録する関数。
    // エディタ側で挿入とリンクの記録だけを手書きすると、noteLinks が片方で抜ける
    const missing = editors.filter(({ source }) => !/\binsertNoteMention\(/.test(source)).map((e) => e.file);
    expect(
      missing,
      `表の外で選んだノートは insertNoteMention で入れてください（noteLinks の記録を含む）: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("どのエディタもノートリンクの貼り付けを mention-insert.ts の関数で変換する", () => {
    // 貼り付けの変換をエディタ側で手書きすると、ピークだけ noteLinks が抜けていた。
    // リンクの読み取りと二重登録ガードのフラグも共通関数の中だけに置く
    const importsShared = /\btryConvertNoteLinkPaste\b[^;]*from\s*["'][^"']*block-link\/mention-insert["']/;
    const handwritten = editors
      .filter(
        ({ source }) =>
          !importsShared.test(source) || source.includes("__ghNoteLinkHandled") || source.includes("#note\\/("),
      )
      .map((e) => e.file);
    expect(
      handwritten,
      `ノートリンクの貼り付けは mention-insert.ts の tryConvertNoteLinkPaste で変換してください: ${handwritten.join(", ")}`,
    ).toEqual([]);
  });
});
