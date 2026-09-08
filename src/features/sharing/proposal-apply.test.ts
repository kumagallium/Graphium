// 「変更の提案」の取り込み（仕様 §25b A-3）のテスト。
// 純関数なので DOM は使わない（既定の node 環境で走る）。

import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { TABLE_ROW_IDENTITY_STYLE } from "../../lib/table-row-identity";
import { computeProposalDiff, type ProposalDiff } from "./proposal-diff";
import { applyProposalChanges, collectAdoptedProposals } from "./proposal-apply";

// ──────────────────────────────────────────────
// 組み立て道具（proposal-diff.test.ts と同じ形）
// ──────────────────────────────────────────────

function makeDoc(
  title: string,
  blocks: any[],
  page: Record<string, any> = {},
  extra: Partial<GraphiumDocument> = {},
): GraphiumDocument {
  return {
    version: 6,
    title,
    pages: [
      {
        id: "page-1",
        title,
        blocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        ...page,
      },
    ],
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  } as GraphiumDocument;
}

function para(id: string, text: string, props: Record<string, any> = {}): any {
  return {
    id,
    type: "paragraph",
    props,
    content: text ? [{ type: "text", text, styles: {} }] : [],
    children: [],
  };
}

/** rows[0] はヘッダ。identities は「データ行の先頭セルに載せる永続 ID」 */
function table(
  id: string,
  rows: string[][],
  identities: (string | undefined)[] = [],
  content: Record<string, any> = {},
): any {
  return {
    id,
    type: "table",
    props: {},
    content: {
      type: "tableContent",
      rows: rows.map((cells, rowIndex) => ({
        cells: cells.map((text, colIndex) => {
          const identity = rowIndex > 0 && colIndex === 0 ? identities[rowIndex - 1] : undefined;
          return {
            type: "tableCell",
            props: {},
            content: text
              ? [{ type: "text", text, styles: identity ? { tableRowIdentity: identity } : {} }]
              : [],
          };
        }),
      })),
      ...content,
    },
    children: [],
  };
}

/** 表ブロックを「ヘッダ + データ行」の素の文字列として読み直す */
function readRows(block: any): string[][] {
  return (block.content?.rows ?? []).map((row: any) =>
    (row.cells ?? []).map((cell: any) =>
      (cell.content ?? []).map((inline: any) => inline.text ?? "").join(""),
    ),
  );
}

function rowIdentity(block: any, dataRowIndex: number): string | undefined {
  const cell = block.content?.rows?.[dataRowIndex + 1]?.cells?.[0];
  for (const inline of cell?.content ?? []) {
    const value = inline?.styles?.[TABLE_ROW_IDENTITY_STYLE];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function ids(blocks: any[]): string[] {
  return blocks.map((block) => block.id);
}

function diffOf(mine: GraphiumDocument, theirs: GraphiumDocument, base?: GraphiumDocument) {
  return computeProposalDiff({ mine, theirs, base });
}

/** 差分から、条件に合う項目の id を取り出す */
function idOf(diff: ProposalDiff, blockId: string): string {
  const change = diff.blocks.find((b) => b.blockId === blockId);
  if (!change) throw new Error(`change not found: ${blockId}`);
  return change.id;
}

function findTable(doc: GraphiumDocument, blockId: string): any {
  return doc.pages[0].blocks.find((block: any) => block.id === blockId);
}

// ──────────────────────────────────────────────
// ブロック
// ──────────────────────────────────────────────

describe("applyProposalChanges — ブロック", () => {
  it("追加を提案側の直前ブロックの後ろへ差し込む", () => {
    const mine = makeDoc("実験", [para("a", "前"), para("c", "後")]);
    const theirs = makeDoc("実験", [para("a", "前"), para("b", "足した"), para("c", "後")]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "b")]),
    });

    expect(ids(result.doc.pages[0].blocks)).toEqual(["a", "b", "c"]);
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it("直前ブロックが手元に無ければ、さらに手前まで遡って位置を決める", () => {
    // 提案側は a → x → y。x は手元に無い（提案者が消した）ので y は a の後ろへ
    const mine = makeDoc("実験", [para("a", "前"), para("z", "後")]);
    const theirs = makeDoc("実験", [para("a", "前"), para("y", "足した")]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "y")]),
    });

    expect(ids(result.doc.pages[0].blocks)).toEqual(["a", "y", "z"]);
  });

  it("提案側の先頭に足されたブロックは手元の先頭へ入る", () => {
    const mine = makeDoc("実験", [para("a", "本文")]);
    const theirs = makeDoc("実験", [para("intro", "はじめに"), para("a", "本文")]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "intro")]),
    });

    expect(ids(result.doc.pages[0].blocks)).toEqual(["intro", "a"]);
  });

  it("削除を選ぶと手元から外れる", () => {
    const mine = makeDoc("実験", [para("a", "残す"), para("b", "消す")]);
    const theirs = makeDoc("実験", [para("a", "残す")]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "b")]),
    });

    expect(ids(result.doc.pages[0].blocks)).toEqual(["a"]);
    expect(result.applied).toBe(1);
  });

  it("変更は提案側の中身で置き換わる", () => {
    const mine = makeDoc("実験", [para("a", "もとの文")]);
    const theirs = makeDoc("実験", [para("a", "書き換えた文")]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "a")]),
    });

    const block: any = result.doc.pages[0].blocks[0];
    expect(block.id).toBe("a");
    expect(block.content[0].text).toBe("書き換えた文");
    expect(result.applied).toBe(1);
  });

  it("id 以外で対応付いた変更でも、手元のブロック id はそのまま残る", () => {
    // 同じテキストのまま提案側で id が変わり props だけ動いた（段落を打ち直した）ケース
    const mine = makeDoc("実験", [para("a", "同じ文", { textAlignment: "left" })]);
    const theirs = makeDoc("実験", [para("a2", "同じ文", { textAlignment: "center" })]);
    const diff = diffOf(mine, theirs);
    expect(diff.blocks[0].kind).toBe("modified");
    expect(diff.blocks[0].mineBlockId).toBe("a");

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([diff.blocks[0].id]),
    });

    const block: any = result.doc.pages[0].blocks[0];
    expect(block.id).toBe("a");
    expect(block.props.textAlignment).toBe("center");
  });

  it("並び替えを選ぶと提案側の並びになる", () => {
    const mine = makeDoc("実験", [para("a", "あ"), para("b", "い"), para("c", "う")]);
    const theirs = makeDoc("実験", [para("b", "い"), para("a", "あ"), para("c", "う")]);
    const diff = diffOf(mine, theirs);
    const moved = diff.blocks.filter((b) => b.kind === "moved");
    expect(moved.length).toBeGreaterThan(0);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set(moved.map((b) => b.id)),
    });

    expect(ids(result.doc.pages[0].blocks)).toEqual(["b", "a", "c"]);
  });

  it("選ばれていない項目は触らず、mine も変更しない", () => {
    const mine = makeDoc("実験", [para("a", "あ"), para("b", "い")]);
    const theirs = makeDoc("提案", [para("a", "あ"), para("b", "変えた"), para("c", "足した")]);
    const before = JSON.stringify(mine);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({ mine, theirs, diff, selected: new Set() });

    expect(result.applied).toBe(0);
    expect(result.doc.title).toBe("実験");
    expect(result.doc.pages[0].blocks).toEqual(mine.pages[0].blocks);
    expect(result.doc).not.toBe(mine);
    expect(JSON.stringify(mine)).toBe(before);
  });

  it("両方が変えた項目（both）を明示的に選ぶと提案側が勝つ", () => {
    const base = makeDoc("実験", [para("a", "もと")]);
    const mine = makeDoc("実験", [para("a", "作者が直した")]);
    const theirs = makeDoc("実験", [para("a", "提案者が直した")]);
    const diff = diffOf(mine, theirs, base);
    expect(diff.blocks[0].by).toBe("both");

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([diff.blocks[0].id]),
    });

    expect((result.doc.pages[0].blocks[0] as any).content[0].text).toBe("提案者が直した");
  });

  it("2 ページ目以降には触らず skipped に理由を入れる", () => {
    const mine = makeDoc("実験", [para("a", "あ")]);
    mine.pages.push({
      id: "page-2",
      title: "2 枚目",
      blocks: [para("p2", "そのまま")],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    });
    const theirs = makeDoc("実験", [para("a", "あ"), para("b", "足した")]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "b")]),
    });

    expect(result.skipped).toContain("multiple-pages");
    expect(result.doc.pages).toHaveLength(2);
    expect(result.doc.pages[1]).toEqual(mine.pages[1]);
  });
});

// ──────────────────────────────────────────────
// 題名
// ──────────────────────────────────────────────

describe("applyProposalChanges — 題名", () => {
  it("題名を選ぶと提案側の題名になる", () => {
    const mine = makeDoc("もとの題名", [para("a", "あ")]);
    const theirs = makeDoc("新しい題名", [para("a", "あ")]);
    const diff = diffOf(mine, theirs);
    expect(diff.title?.id).toBe("title");

    const result = applyProposalChanges({ mine, theirs, diff, selected: new Set(["title"]) });

    expect(result.doc.title).toBe("新しい題名");
    expect(result.applied).toBe(1);
  });

  it("題名を選ばなければ変わらない", () => {
    const mine = makeDoc("もとの題名", [para("a", "あ")]);
    const theirs = makeDoc("新しい題名", [para("a", "あ")]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({ mine, theirs, diff, selected: new Set() });

    expect(result.doc.title).toBe("もとの題名");
  });
});

// ──────────────────────────────────────────────
// 表
// ──────────────────────────────────────────────

describe("applyProposalChanges — 表", () => {
  it("セルの書き換えで先頭セルの行 identity が残る", () => {
    const mine = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "1"], ["B", "2"]], ["r1", "r2"]),
    ]);
    const theirs = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "9"], ["B", "2"]], ["r1", "r2"]),
    ]);
    const diff = diffOf(mine, theirs);
    const cells = diff.blocks[0].cells ?? [];
    const cellChange = cells.find((c) => c.kind === "cellModified");
    expect(cellChange).toBeDefined();

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([cellChange!.id]),
    });

    const next = findTable(result.doc, "t1");
    expect(readRows(next)).toEqual([["試料", "量"], ["A", "9"], ["B", "2"]]);
    expect(rowIdentity(next, 0)).toBe("r1");
    expect(rowIdentity(next, 1)).toBe("r2");
    expect(result.applied).toBe(1);
  });

  it("先頭セル自体の書き換えでも identity を壊さない", () => {
    const mine = makeDoc("実験", [table("t1", [["試料", "量"], ["A", "1"]], ["r1"])]);
    const theirs = makeDoc("実験", [table("t1", [["試料", "量"], ["A 改", "1"]], ["r1"])]);
    const diff = diffOf(mine, theirs);
    const cellChange = (diff.blocks[0].cells ?? []).find((c) => c.kind === "cellModified");

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([cellChange!.id]),
    });

    const next = findTable(result.doc, "t1");
    expect(readRows(next)[1]).toEqual(["A 改", "1"]);
    expect(rowIdentity(next, 0)).toBe("r1");
  });

  it("行の追加は提案側の行 id ごと入る", () => {
    const mine = makeDoc("実験", [table("t1", [["試料", "量"], ["A", "1"]], ["r1"])]);
    const theirs = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "1"], ["B", "2"]], ["r1", "r2"]),
    ]);
    const diff = diffOf(mine, theirs);
    const rowAdded = (diff.blocks[0].cells ?? []).find((c) => c.kind === "rowAdded");
    expect(rowAdded).toBeDefined();

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([rowAdded!.id]),
    });

    const next = findTable(result.doc, "t1");
    expect(readRows(next)).toEqual([["試料", "量"], ["A", "1"], ["B", "2"]]);
    expect(rowIdentity(next, 1)).toBe("r2");
  });

  it("行の削除を選ぶとその行だけ消える", () => {
    const mine = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "1"], ["B", "2"]], ["r1", "r2"]),
    ]);
    const theirs = makeDoc("実験", [table("t1", [["試料", "量"], ["A", "1"]], ["r1"])]);
    const diff = diffOf(mine, theirs);
    const rowRemoved = (diff.blocks[0].cells ?? []).find((c) => c.kind === "rowRemoved");

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([rowRemoved!.id]),
    });

    expect(readRows(findTable(result.doc, "t1"))).toEqual([["試料", "量"], ["A", "1"]]);
  });

  it("列の追加はヘッダと各行のセルが入り、columnWidths と headerRows を保つ", () => {
    const mine = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "1"]], ["r1"], {
        columnWidths: [120, 80],
        headerRows: 1,
      }),
    ]);
    const theirs = makeDoc("実験", [
      table("t1", [["試料", "量", "備考"], ["A", "1", "追試"]], ["r1"]),
    ]);
    const diff = diffOf(mine, theirs);
    const columnAdded = (diff.blocks[0].cells ?? []).find((c) => c.kind === "columnAdded");
    expect(columnAdded).toBeDefined();

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([columnAdded!.id]),
    });

    const next = findTable(result.doc, "t1");
    expect(readRows(next)).toEqual([["試料", "量", "備考"], ["A", "1", "追試"]]);
    expect(next.content.headerRows).toBe(1);
    expect(next.content.columnWidths).toHaveLength(3);
    expect(next.content.columnWidths.slice(0, 2)).toEqual([120, 80]);
    expect(rowIdentity(next, 0)).toBe("r1");
  });

  it("列の削除を選ぶとその列だけ消える", () => {
    const mine = makeDoc("実験", [
      table("t1", [["試料", "量", "備考"], ["A", "1", "追試"]], ["r1"], {
        columnWidths: [120, 80, 200],
      }),
    ]);
    const theirs = makeDoc("実験", [table("t1", [["試料", "量"], ["A", "1"]], ["r1"])]);
    const diff = diffOf(mine, theirs);
    const columnRemoved = (diff.blocks[0].cells ?? []).find((c) => c.kind === "columnRemoved");

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([columnRemoved!.id]),
    });

    const next = findTable(result.doc, "t1");
    expect(readRows(next)).toEqual([["試料", "量"], ["A", "1"]]);
    expect(next.content.columnWidths).toEqual([120, 80]);
  });

  it("表ブロックごと選ぶと提案側の中身に置き換わり、columnWidths は残る", () => {
    const mine = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "1"]], ["r1"], { columnWidths: [120, 80] }),
    ]);
    const theirs = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "9"], ["B", "2"]], ["r1", "r2"]),
    ]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([diff.blocks[0].id]),
    });

    const next = findTable(result.doc, "t1");
    expect(readRows(next)).toEqual([["試料", "量"], ["A", "9"], ["B", "2"]]);
    expect(next.content.columnWidths).toEqual([120, 80]);
    expect(result.applied).toBe(1);
  });

  it("選んだセル項目だけが入り、選ばなかったセルは元のまま", () => {
    const mine = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "1"], ["B", "2"]], ["r1", "r2"]),
    ]);
    const theirs = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "9"], ["B", "8"]], ["r1", "r2"]),
    ]);
    const diff = diffOf(mine, theirs);
    const cells = (diff.blocks[0].cells ?? []).filter((c) => c.kind === "cellModified");
    expect(cells).toHaveLength(2);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([cells[0].id]),
    });

    expect(readRows(findTable(result.doc, "t1"))).toEqual([
      ["試料", "量"],
      ["A", "9"],
      ["B", "2"],
    ]);
    expect(result.applied).toBe(1);
  });
});

// ──────────────────────────────────────────────
// ラベル・provLinks
// ──────────────────────────────────────────────

describe("applyProposalChanges — ラベルと provLinks", () => {
  it("取り込んだブロックの分だけラベルを写す", () => {
    const mine = makeDoc("実験", [para("a", "手順")], { labels: { a: "procedure" } });
    const theirs = makeDoc(
      "実験",
      [para("a", "手順"), para("b", "結果")],
      { labels: { a: "plan", b: "result" } },
    );
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "b")]),
    });

    // 取り込んだ b のラベルは入り、取り込んでいない a のラベルは手元のまま
    expect(result.doc.pages[0].labels).toEqual({ a: "procedure", b: "result" });
  });

  it("削除したブロックのラベルとリンクは落ちる", () => {
    const link = {
      id: "l1",
      sourceBlockId: "b",
      targetBlockId: "a",
      type: "derived_from",
      layer: "prov",
      createdBy: "human",
    } as any;
    const mine = makeDoc(
      "実験",
      [para("a", "手順"), para("b", "結果")],
      { labels: { a: "procedure", b: "result" }, provLinks: [link] },
    );
    const theirs = makeDoc("実験", [para("a", "手順")]);
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "b")]),
    });

    expect(result.doc.pages[0].labels).toEqual({ a: "procedure" });
    expect(result.doc.pages[0].provLinks).toEqual([]);
  });

  it("取り込んだブロックから出ている provLinks を写す（行き先が手元にあるものだけ）", () => {
    const carried = {
      id: "l1",
      sourceBlockId: "b",
      targetBlockId: "a",
      type: "derived_from",
      layer: "prov",
      createdBy: "human",
    } as any;
    const dangling = {
      id: "l2",
      sourceBlockId: "b",
      targetBlockId: "nowhere",
      type: "used",
      layer: "prov",
      createdBy: "human",
    } as any;
    const mine = makeDoc("実験", [para("a", "手順")]);
    const theirs = makeDoc(
      "実験",
      [para("a", "手順"), para("b", "結果")],
      {
        provLinks: [carried, dangling],
        knowledgeLinks: [
          {
            id: "k1",
            sourceBlockId: "b",
            targetBlockId: "a",
            type: "reference",
            layer: "knowledge",
            createdBy: "human",
          } as any,
        ],
      },
    );
    const diff = diffOf(mine, theirs);

    const result = applyProposalChanges({
      mine,
      theirs,
      diff,
      selected: new Set([idOf(diff, "b")]),
    });

    expect(result.doc.pages[0].provLinks.map((l) => l.id)).toEqual(["l1"]);
    // knowledgeLinks は提案者ローカルの id なので運ばない
    expect(result.doc.pages[0].knowledgeLinks).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// collectAdoptedProposals
// ──────────────────────────────────────────────

describe("collectAdoptedProposals", () => {
  function docWithActivities(activities: any[]): GraphiumDocument {
    return makeDoc("実験", [para("a", "あ")], {}, {
      documentProvenance: { revisions: [], activities, agents: [] },
    } as Partial<GraphiumDocument>);
  }

  it("proposal_adopt の shared: ソースを重複なく集める", () => {
    const doc = docWithActivities([
      { id: "e1", type: "human_edit", startedAt: "", endedAt: "", wasAssociatedWith: "ag1" },
      {
        id: "e2",
        type: "proposal_adopt",
        startedAt: "",
        endedAt: "",
        wasAssociatedWith: "ag1",
        used: ["shared:p1", "note:x"],
      },
      {
        id: "e3",
        type: "proposal_adopt",
        startedAt: "",
        endedAt: "",
        wasAssociatedWith: "ag1",
        used: ["shared:p2", "shared:p1"],
      },
    ]);

    expect(collectAdoptedProposals(doc)).toEqual(["p1", "p2"]);
  });

  it("来歴が無いときは空", () => {
    expect(collectAdoptedProposals(makeDoc("実験", []))).toEqual([]);
    expect(collectAdoptedProposals(null)).toEqual([]);
  });
});
