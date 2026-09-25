// コピー＆ペーストで @リンクを運ぶ共通処理（メインエディタ・サイドピーク共通）の回帰ガード
import { describe, expect, it, vi } from "vitest";
import type { GraphiumClipboardPayload } from "../block-lifecycle/clipboard";
import type { GraphiumIndex } from "../navigation/index-file";
import {
  applyPastedMentionLinks,
  mentionCopyContext,
  mentionLabelResolver,
  type MentionPasteOps,
} from "./mention-paste";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const mention = (label: string, extra: Record<string, unknown> = {}) => text(`@${label}`, { textColor: "blue", ...extra });
const cell = (content: any[]) => ({ type: "tableCell", content, props: {} });
const para = (id: string, content: any[]) => ({ id, type: "paragraph", content, children: [] });
const table = (id: string, rows: any[][]) => ({
  id,
  type: "table",
  content: { type: "tableContent", rows: rows.map((cells) => ({ cells })) },
  children: [],
});

/** カーソル（と選択）がどこにあるか: 表の中なら { table, row }、段落なら { block } */
type Cursor = { table: string; row: number } | { block: string } | null;

/**
 * BlockNote エディタの最小の替え玉（document / getBlock / updateBlock / カーソル）。
 * cellRanges を渡すと、セルの範囲選択（セルごとに range を持つ）を真似る。selectedText は選んだ中身の文字
 */
function fakeEditor(blocks: any[], cursor: Cursor, selectionEnd?: Cursor, cellRanges?: Cursor[], selectedText = "") {
  const store = new Map<string, any>(blocks.map((b) => [b.id, b]));
  const posOf = (c: Cursor) => {
    if (!c) return null;
    const chain =
      "table" in c
        ? [
            { type: { name: "doc" } },
            { type: { name: "blockContainer" }, attrs: { id: c.table } },
            { type: { name: "tableRow" } },
            { type: { name: "tableCell" } },
            { type: { name: "tableParagraph" } },
          ]
        : [{ type: { name: "doc" } }, { type: { name: "blockContainer" }, attrs: { id: c.block } }, { type: { name: "paragraph" } }];
    return {
      depth: chain.length - 1,
      node: (d: number) => chain[d],
      index: (d: number) => ("table" in c ? (d === 1 ? c.row : 0) : 0),
    };
  };
  const cursorBlockId = cursor ? ("table" in cursor ? cursor.table : cursor.block) : null;
  return {
    get document() {
      return [...store.values()];
    },
    getBlock: (id: string) => store.get(id),
    updateBlock: vi.fn((id: string, patch: { content: any }) => {
      store.set(id, { ...store.get(id), content: patch.content });
    }),
    getTextCursorPosition: () => (cursorBlockId ? { block: store.get(cursorBlockId) } : undefined),
    _tiptapEditor: {
      state: {
        selection: {
          $from: posOf(cursor),
          $to: posOf(selectionEnd === undefined ? cursor : selectionEnd),
          ranges: cellRanges
            ? cellRanges.map((c) => ({ $from: posOf(c), $to: posOf(c) }))
            : [{ $from: posOf(cursor), $to: posOf(selectionEnd === undefined ? cursor : selectionEnd) }],
          content: () => ({ content: { size: selectedText.length, textBetween: () => selectedText } }),
        },
      },
    },
  };
}

const noteIndex = {
  notes: [
    { noteId: "n1", title: "焼成の記録", source: "human" },
    { noteId: "w1", title: "粒径と密度", source: "ai", wikiKind: "concept" },
  ],
} as unknown as GraphiumIndex;
const media = [
  { fileId: "f1", name: "spectrum.txt" },
  { fileId: "f2", name: "XRD.txt" },
  { fileId: "f3", name: "XRD.txt" },
];

function opsWith(existing: any[] = []) {
  const noteLinks: any[][] = [];
  const ops: MentionPasteOps & { noteLinksAfter: () => any[] } = {
    addLink: vi.fn(),
    getAllLinks: () => existing,
    labelOfTarget: mentionLabelResolver(noteIndex, media),
    citeAsset: vi.fn(),
    updateNoteLinks: vi.fn((update) => {
      noteLinks.push(update(noteLinks[noteLinks.length - 1] ?? []));
    }),
    noteLinksAfter: () => noteLinks[noteLinks.length - 1] ?? [],
  };
  return ops;
}

const payloadOf = (over: Partial<GraphiumClipboardPayload>): GraphiumClipboardPayload => ({
  version: 1,
  blockIds: [],
  labels: {},
  links: [],
  ...over,
});

describe("mentionLabelResolver", () => {
  const labelOf = mentionLabelResolver(noteIndex, media);
  it("ノートは題、知見は「🤖 種類: 題」、素材は名前", () => {
    expect(labelOf("n1")).toBe("焼成の記録");
    expect(labelOf("w1")).toBe("🤖 Concept: 粒径と密度");
    expect(labelOf("data:f1")).toBe("spectrum.txt");
  });
  it("分からない行き先（URL・消えたノート・一覧に無い素材）は null", () => {
    expect(labelOf("url:https://example.com")).toBeNull();
    expect(labelOf("gone")).toBeNull();
    expect(labelOf("data:missing")).toBeNull();
  });
});

describe("mentionCopyContext", () => {
  const labelOf = mentionLabelResolver(noteIndex, media);
  const blocks = [
    table("tbl", [
      [cell([text("Name")])],
      [cell([text("S1", { tableRowIdentity: "row_a" })])],
      [cell([text("S2", { tableRowIdentity: "row_b" })])],
    ]),
    para("p1", [text("本文")]),
  ];

  it("選択が表の 1 行の中だけなら、その行の identity（identity の無い見出し行は null）", () => {
    expect(mentionCopyContext(fakeEditor(blocks, { table: "tbl", row: 2 }), labelOf).copiedRow).toEqual({ blockId: "tbl", rowIdentity: "row_b" });
    expect(mentionCopyContext(fakeEditor(blocks, { table: "tbl", row: 0 }), labelOf).copiedRow).toEqual({ blockId: "tbl", rowIdentity: null });
  });

  it("選んだ中身に @ラベル が入っている行き先だけを運ぶ（URL だけのコピーには付けない）", () => {
    const ctx = mentionCopyContext(fakeEditor(blocks, { block: "p1" }, undefined, undefined, "測定: @spectrum.txt と https://example.com"), labelOf);
    expect(ctx.carriesMention!("data:f1")).toBe(true);
    expect(ctx.carriesMention!("n1")).toBe(false);
    // 名前の分からない行き先は確かめられないので運ばない
    expect(ctx.carriesMention!("url:https://example.com")).toBe(false);
    const urlOnly = mentionCopyContext(fakeEditor(blocks, { block: "p1" }, undefined, undefined, "https://example.com"), labelOf);
    expect(urlOnly.carriesMention!("data:f1")).toBe(false);
  });

  it("行をまたぐ選択・表の外は null", () => {
    expect(mentionCopyContext(fakeEditor(blocks, { table: "tbl", row: 1 }, { table: "tbl", row: 2 }), labelOf).copiedRow).toBeNull();
    expect(mentionCopyContext(fakeEditor(blocks, { block: "p1" }), labelOf).copiedRow).toBeNull();
  });

  it("セルの範囲選択は、全部のセルが同じ行のときだけその行（最初のセルだけで決めない）", () => {
    const row2 = { table: "tbl", row: 2 } as const;
    const row1 = { table: "tbl", row: 1 } as const;
    expect(mentionCopyContext(fakeEditor(blocks, row2, row2, [row2, row2]), labelOf).copiedRow).toEqual({ blockId: "tbl", rowIdentity: "row_b" });
    // $from / $to は最初のセルしか指さないが、2 行にまたがっている
    expect(mentionCopyContext(fakeEditor(blocks, row1, row1, [row1, row2]), labelOf).copiedRow).toBeNull();
  });
});

describe("applyPastedMentionLinks — ブロックごと貼った", () => {
  it("貼られたブロックに実際にある @ラベル の分だけ記録し、素材は引用素材に、ノートは派生関係に積む", () => {
    const editor = fakeEditor([para("p1new", [text("測定: "), mention("spectrum.txt"), text(" と "), mention("焼成の記録")])], null);
    const ops = opsWith();
    const payload = payloadOf({
      blockIds: ["p1"],
      mentionLinks: [
        { sourceBlockId: "p1", targetNoteId: "data:f1" },
        { sourceBlockId: "p1", targetNoteId: "n1" },
        // 部分コピーで本文に入らなかったメンションのリンクは持ち込まない
        { sourceBlockId: "p1", targetNoteId: "w1" },
      ],
    });
    const count = applyPastedMentionLinks(editor, payload, new Map([["p1", "p1new"]]), ops);
    expect(count).toBe(2);
    expect((ops.addLink as any).mock.calls.map((c: any[]) => c[0].targetNoteId)).toEqual(["data:f1", "n1"]);
    expect((ops.addLink as any).mock.calls[0][0]).toMatchObject({ sourceBlockId: "p1new", targetBlockId: "", type: "reference" });
    expect(ops.citeAsset).toHaveBeenCalledWith("f1");
    expect(ops.noteLinksAfter()).toEqual([{ targetNoteId: "n1", sourceBlockId: "p1new", type: "derived_from" }]);
  });

  const xrdTable = (id: string, s1: string | null, s2: string | null) =>
    table(id, [
      [cell([text("Name")]), cell([text("Data")])],
      [cell([text("S1", s1 ? { tableRowIdentity: s1 } : {})]), cell([mention("XRD.txt")])],
      [cell([text("S2", s2 ? { tableRowIdentity: s2 } : {})]), cell([mention("XRD.txt")])],
    ]);
  const tablePayload = payloadOf({
    blockIds: ["tbl"],
    mentionLinks: [
      { sourceBlockId: "tbl", targetNoteId: "data:f2", sourceRowIdentity: "row_a" },
      { sourceBlockId: "tbl", targetNoteId: "data:f3", sourceRowIdentity: "row_b" },
    ],
  });
  const recorded = (ops: MentionPasteOps) =>
    (ops.addLink as any).mock.calls.map((c: any[]) => [c[0].sourceBlockId, c[0].targetNoteId, c[0].sourceRowIdentity]);

  it("表は同じ identity の行へ（振り直された行は新しい identity で。同じラベルが並んでも行で分かれる）", () => {
    const editor = fakeEditor([xrdTable("tbl2", "row_x", "row_y")], null);
    const ops = opsWith();
    const remap = new Map([["tbl2", new Map([["row_a", "row_x"], ["row_b", "row_y"]])]]);
    applyPastedMentionLinks(editor, tablePayload, new Map([["tbl", "tbl2"]]), ops, remap);
    expect(recorded(ops)).toEqual([
      ["tbl2", "data:f2", "row_x"],
      ["tbl2", "data:f3", "row_y"],
    ]);
  });

  it("別のノートに貼って振り直しが無ければ、元の identity の行へ", () => {
    const editor = fakeEditor([xrdTable("tbl2", "row_a", "row_b")], null);
    const ops = opsWith();
    applyPastedMentionLinks(editor, tablePayload, new Map([["tbl", "tbl2"]]), ops);
    expect(recorded(ops)).toEqual([
      ["tbl2", "data:f2", "row_a"],
      ["tbl2", "data:f3", "row_b"],
    ]);
  });

  it("行の一部だけを貼った表は、並びではなく identity で合わせる（無い行のリンクは運ばない）", () => {
    // 2 行目（row_b）だけが貼られた表。番号で合わせると row_a のリンクがこの行に付いてしまう
    const editor = fakeEditor(
      [table("tbl2", [[cell([text("S2", { tableRowIdentity: "row_b" })]), cell([mention("XRD.txt")])]])],
      { table: "tbl2", row: 0 },
    );
    const ops = opsWith();
    applyPastedMentionLinks(editor, tablePayload, new Map([["tbl", "tbl2"]]), ops);
    expect(recorded(ops)).toEqual([["tbl2", "data:f3", "row_b"]]);
  });

  it("先頭の列を含まないコピー（identity が来ない）は、行が決められないので運ばない", () => {
    const editor = fakeEditor([xrdTable("tbl2", null, null)], { table: "tbl2", row: 2 });
    const ops = opsWith();
    expect(applyPastedMentionLinks(editor, tablePayload, new Map([["tbl", "tbl2"]]), ops)).toBe(0);
  });

  it("同じリンクが既にあれば足さない", () => {
    const editor = fakeEditor([para("p1new", [mention("spectrum.txt")])], null);
    const ops = opsWith([{ sourceBlockId: "p1new", targetNoteId: "data:f1" }]);
    const payload = payloadOf({ blockIds: ["p1"], mentionLinks: [{ sourceBlockId: "p1", targetNoteId: "data:f1" }] });
    expect(applyPastedMentionLinks(editor, payload, new Map([["p1", "p1new"]]), ops)).toBe(0);
    expect(ops.addLink).not.toHaveBeenCalled();
  });
});

describe("applyPastedMentionLinks — 文中に貼った（ブロックが増えない）", () => {
  // 表の 2 行目（row_b）のセルの中だけをコピーした: コピー側でその行のリンクだけに絞ってある
  const fromRow = payloadOf({
    blockIds: ["tbl"],
    mentionLinks: [{ sourceBlockId: "tbl", targetNoteId: "data:f3", sourceRowIdentity: "row_b" }],
  });

  it("段落に貼ると、カーソルのブロックへ（行の紐付けなし）", () => {
    const editor = fakeEditor([para("d1", [text("比較: "), mention("XRD.txt")])], { block: "d1" });
    const ops = opsWith();
    applyPastedMentionLinks(editor, fromRow, new Map(), ops);
    expect((ops.addLink as any).mock.calls.map((c: any[]) => c[0])).toEqual([
      { sourceBlockId: "d1", targetBlockId: "", targetNoteId: "data:f3", type: "reference", createdBy: "human" },
    ]);
  });

  it("表のセルに貼ると、カーソルの行に紐づける", () => {
    const editor = fakeEditor(
      [
        table("t9", [
          [cell([text("Name")]), cell([text("Data")])],
          [cell([text("S9", { tableRowIdentity: "row_z" })]), cell([mention("XRD.txt")])],
        ]),
      ],
      { table: "t9", row: 1 },
    );
    const ops = opsWith();
    applyPastedMentionLinks(editor, fromRow, new Map(), ops);
    expect((ops.addLink as any).mock.calls.map((c: any[]) => [c[0].sourceBlockId, c[0].targetNoteId, c[0].sourceRowIdentity])).toEqual([
      ["t9", "data:f3", "row_z"],
    ]);
  });

  it("ノートの末尾に貼って空の段落が足されても、カーソルのブロックへ", () => {
    // BlockNote は末尾に空の段落を足すので、それが「増えたブロック」として対応に載る
    const editor = fakeEditor([para("last", [text("測定: "), mention("spectrum.txt")]), para("trailing", [])], { block: "last" });
    const ops = opsWith();
    const payload = payloadOf({ blockIds: ["p1"], mentionLinks: [{ sourceBlockId: "p1", targetNoteId: "data:f1" }] });
    expect(applyPastedMentionLinks(editor, payload, new Map([["p1", "trailing"]]), ops)).toBe(1);
    expect((ops.addLink as any).mock.calls[0][0]).toMatchObject({ sourceBlockId: "last", targetNoteId: "data:f1" });
  });

  it("複数ブロックからのコピーは、どのブロックのリンクか分からないので運ばない", () => {
    const editor = fakeEditor([para("d1", [mention("spectrum.txt")])], { block: "d1" });
    const ops = opsWith();
    const payload = payloadOf({
      blockIds: ["p1", "p2"],
      mentionLinks: [{ sourceBlockId: "p1", targetNoteId: "data:f1" }],
    });
    expect(applyPastedMentionLinks(editor, payload, new Map(), ops)).toBe(0);
  });
});
