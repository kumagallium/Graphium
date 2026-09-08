// 「変更の提案」の差分エンジンのテスト（仕様 §25 B-7）。
// 純関数なので DOM は使わない（既定の node 環境で走る）。

import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  computeProposalDiff,
  stripForkSuffix,
  summarizeProposalDiff,
  type BlockChange,
  type TableCellChange,
} from "./proposal-diff";
import { blockToReadableText } from "./proposal-block-text";

// ──────────────────────────────────────────────
// 組み立て道具
// ──────────────────────────────────────────────

function makeDoc(
  title: string,
  blocks: any[],
  extra: Partial<GraphiumDocument> = {},
): GraphiumDocument {
  return {
    version: 6,
    title,
    pages: [
      { id: "page-1", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] },
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
function table(id: string, rows: string[][], identities: (string | undefined)[] = []): any {
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
    },
    children: [],
  };
}

function image(id: string, url: string, props: Record<string, any> = {}): any {
  return { id, type: "image", props: { url, name: "figure.png", ...props }, children: [] };
}

function find(blocks: BlockChange[], blockId: string): BlockChange | undefined {
  return blocks.find((b) => b.blockId === blockId);
}

function cell(cells: TableCellChange[] | undefined, kind: TableCellChange["kind"]) {
  return (cells ?? []).filter((c) => c.kind === kind);
}

// ──────────────────────────────────────────────
// ブロックの対応付け
// ──────────────────────────────────────────────

describe("computeProposalDiff — ブロックの対応付け", () => {
  it("id が同じでテキストだけ変わったブロックは modified になる", () => {
    const mine = makeDoc("計画", [para("b1", "80 ℃ で 3 時間"), para("b2", "そのまま")]);
    const theirs = makeDoc("計画", [para("b1", "85 ℃ で 3 時間"), para("b2", "そのまま")]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0]).toMatchObject({
      kind: "modified",
      blockId: "b1",
      before: "80 ℃ で 3 時間",
      after: "85 ℃ で 3 時間",
      by: "unknown",
    });
    expect(diff.blocks[0].propsOnly).toBeUndefined();
  });

  it("分割などで id が変わっても、種類 + テキストが同じなら同じブロックとみなす", () => {
    // 提案側は id が総取り替えになっている（コピー経由の編集など）
    const mine = makeDoc("計画", [para("old-1", "収率を記録する"), para("old-2", "考察")]);
    const theirs = makeDoc("計画", [para("new-1", "収率を記録する"), para("new-2", "考察")]);

    expect(computeProposalDiff({ mine, theirs }).blocks).toEqual([]);
  });

  it("id もテキストも変わったブロックは削除 + 追加になる（対応付けの手がかりが無いため）", () => {
    const mine = makeDoc("計画", [para("old-1", "収率を記録する"), para("old-2", "考察")]);
    const theirs = makeDoc("計画", [para("new-1", "収率を記録する"), para("new-2", "考察を書く")]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks.map((b) => [b.kind, b.blockId])).toEqual([
      ["removed", "old-2"],
      ["added", "new-2"],
    ]);
  });

  it("props だけ違って id が変わったブロックは、テキスト一致で対応付いて modified になる", () => {
    const mine = makeDoc("計画", [para("old-1", "注意書き", { textColor: "default" })]);
    const theirs = makeDoc("計画", [para("new-1", "注意書き", { textColor: "red" })]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0]).toMatchObject({
      kind: "modified",
      blockId: "new-1",
      mineBlockId: "old-1",
      propsOnly: true,
    });
  });

  it("追加・削除は元側の並びを保ったまま出る", () => {
    const mine = makeDoc("計画", [para("a", "手順 1"), para("b", "手順 2")]);
    const theirs = makeDoc("計画", [para("a", "手順 1"), para("c", "手順 3")]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks.map((b) => [b.kind, b.blockId])).toEqual([
      ["removed", "b"],
      ["added", "c"],
    ]);
    expect(find(diff.blocks, "c")?.after).toBe("手順 3");
    expect(find(diff.blocks, "b")?.before).toBe("手順 2");
  });

  it("中身が同じで並びだけ変わったブロックは moved になる", () => {
    const mine = makeDoc("計画", [para("a", "一"), para("b", "二"), para("c", "三")]);
    const theirs = makeDoc("計画", [para("c", "三"), para("a", "一"), para("b", "二")]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0]).toMatchObject({ kind: "moved", blockId: "c" });
  });

  it("中身も並びも変わったブロックは modified に moved の印を付ける", () => {
    const mine = makeDoc("計画", [para("a", "一"), para("b", "二"), para("c", "三")]);
    const theirs = makeDoc("計画", [para("c", "三を直した"), para("a", "一"), para("b", "二")]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0]).toMatchObject({ kind: "modified", blockId: "c", moved: true });
  });

  it("同じ本文なら差分は空", () => {
    const blocks = [para("a", "一"), table("t", [["列"], ["値"]])];

    expect(computeProposalDiff({ mine: makeDoc("計画", blocks), theirs: makeDoc("計画", blocks) })).toEqual({
      blocks: [],
      unsupported: [],
    });
  });

  it("子ブロックも平坦化して 1 項目ずつ見る", () => {
    const mine = makeDoc("計画", [
      { ...para("parent", "手順"), children: [para("child", "40 ℃")] },
    ]);
    const theirs = makeDoc("計画", [
      { ...para("parent", "手順"), children: [para("child", "45 ℃")] },
    ]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0]).toMatchObject({ kind: "modified", blockId: "child", after: "45 ℃" });
  });

  it("columnList / column はレイアウトの器なので項目にせず、中身だけを見る", () => {
    const wrap = (children: any[]) => ({
      id: "cl",
      type: "columnList",
      props: {},
      children: [{ id: "col", type: "column", props: {}, children }],
    });
    const mine = makeDoc("計画", [wrap([para("x", "左")])]);
    const theirs = makeDoc("計画", [wrap([para("x", "右")])]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks.map((b) => b.blockId)).toEqual(["x"]);
  });
});

// ──────────────────────────────────────────────
// 比較から外すもの
// ──────────────────────────────────────────────

describe("computeProposalDiff — 比較から外すもの", () => {
  it("sharedRef / forkedFrom / chats / 来歴 / 文脈 / 日時が違っても差分にしない", () => {
    const blocks = [para("b1", "同じ本文")];
    const mine = makeDoc("計画", blocks, {
      sharedRef: { id: "s1", type: "note", sharedAt: "2026-09-01T00:00:00.000Z", hash: "h1" },
      noteContexts: ["研究室"],
      chats: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      modifiedAt: "2026-01-02T00:00:00.000Z",
    });
    const theirs = makeDoc("計画", blocks, {
      forkedFrom: {
        sharedId: "s1",
        hash: "h1",
        authorName: "先生",
        authorEmail: "t@example.test",
        forkedAt: "2026-09-02T00:00:00.000Z",
      },
      templateFrom: { sharedId: "t1", hash: "h2", title: "雛形", usedAt: "2026-09-02T00:00:00.000Z" },
      documentProvenance: { entities: [], activities: [], agents: [] } as any,
      noteContexts: ["自分用"],
      createdAt: "2026-09-02T00:00:00.000Z",
      modifiedAt: "2026-09-03T00:00:00.000Z",
    });

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toEqual([]);
    expect(diff.title).toBeUndefined();
  });

  it("媒体ブロックの url は比べない（共有側は shared-blob: に置き換わるため）", () => {
    const mine = makeDoc("計画", [image("img", "graphium-media://local/abc.png")]);
    const theirs = makeDoc("計画", [image("img", "shared-blob:sha256:deadbeef")]);

    expect(computeProposalDiff({ mine, theirs }).blocks).toEqual([]);
  });

  it("媒体ブロックの url 以外の props（caption 等）は比べる", () => {
    const mine = makeDoc("計画", [image("img", "graphium-media://local/abc.png", { caption: "図 1" })]);
    const theirs = makeDoc("計画", [image("img", "shared-blob:sha256:deadbeef", { caption: "図 1（再測定）" })]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toHaveLength(1);
    // 読めるテキストは同じ（名前だけ）なので「設定が変わった」扱いになる
    expect(diff.blocks[0]).toMatchObject({ kind: "modified", propsOnly: true });
    expect(diff.blocks[0].after).toBe("[image: figure.png]");
  });

  it("props の書き順が違うだけなら差分にしない", () => {
    const mine = makeDoc("計画", [para("b1", "本文", { textAlignment: "left", textColor: "default" })]);
    const theirs = makeDoc("計画", [para("b1", "本文", { textColor: "default", textAlignment: "left" })]);

    expect(computeProposalDiff({ mine, theirs }).blocks).toEqual([]);
  });

  it("中身を持たないブロック（chart 等）は props の違いを modified + propsOnly で出す", () => {
    const chart = (config: string) => ({ id: "c1", type: "chart", props: { config }, children: [] });
    const mine = makeDoc("計画", [chart('{"kind":"line"}')]);
    const theirs = makeDoc("計画", [chart('{"kind":"bar"}')]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0]).toMatchObject({
      kind: "modified",
      blockType: "chart",
      propsOnly: true,
      before: "",
      after: "",
    });
  });

  it("2 ページ目以降は比べきれないので unsupported に理由を残す", () => {
    const mine = makeDoc("計画", [para("b1", "1 ページ目")]);
    const theirs = makeDoc("計画", [para("b1", "1 ページ目を直した")], {
      pages: [
        {
          id: "page-1",
          title: "計画",
          blocks: [para("b1", "1 ページ目を直した")],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
        {
          id: "page-2",
          title: "続き",
          blocks: [para("b9", "2 ページ目")],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
    });

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.unsupported).toEqual(["multiple-pages"]);
    expect(diff.blocks.map((b) => b.blockId)).toEqual(["b1"]);
  });
});

// ──────────────────────────────────────────────
// 題名
// ──────────────────────────────────────────────

describe("computeProposalDiff — 題名", () => {
  it("末尾の (forked) は 1 回だけ落として比べる", () => {
    const mine = makeDoc("反応条件の検討", [para("b1", "本文")]);
    const theirs = makeDoc("反応条件の検討 (forked)", [para("b1", "本文")]);

    expect(computeProposalDiff({ mine, theirs }).title).toBeUndefined();
  });

  it("題名が変わっていれば before / after は元の文字列のまま返す", () => {
    const mine = makeDoc("反応条件の検討", [para("b1", "本文")]);
    const theirs = makeDoc("反応条件の検討 v2 (forked)", [para("b1", "本文")]);

    expect(computeProposalDiff({ mine, theirs }).title).toEqual({
      id: "title",
      by: "unknown",
      before: "反応条件の検討",
      after: "反応条件の検討 v2 (forked)",
    });
  });
});

// ──────────────────────────────────────────────
// 表（セル単位）
// ──────────────────────────────────────────────

describe("computeProposalDiff — 表", () => {
  const header = ["試料", "温度", "収率"];

  it("セル・行・列の変更をセル単位の子項目にする", () => {
    const mine = makeDoc("測定", [
      table("t1", [header, ["A", "80", "12"], ["B", "90", "15"]]),
    ]);
    const theirs = makeDoc("測定", [
      table("t1", [
        [...header, "備考"],
        ["A", "85", "12", "再測定"],
        ["C", "70", "9", ""],
      ]),
    ]);

    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks).toHaveLength(1);
    const change = diff.blocks[0];
    expect(change.kind).toBe("table");

    expect(cell(change.cells, "columnAdded")).toEqual([
      {
        kind: "columnAdded",
        id: "col:t1:name:備考",
        by: "unknown",
        column: "備考",
        columnIndex: 3,
        cells: ["再測定", ""],
      },
    ]);
    expect(cell(change.cells, "cellModified")).toEqual([
      {
        kind: "cellModified",
        id: "cell:t1:text:A:name:温度",
        by: "unknown",
        rowLabel: "A",
        rowIndex: 0,
        column: "温度",
        columnIndex: 1,
        before: "80",
        after: "85",
      },
    ]);
    expect(cell(change.cells, "rowAdded")).toMatchObject([{ rowLabel: "C", cells: ["C", "70", "9", ""] }]);
    expect(cell(change.cells, "rowRemoved")).toMatchObject([{ rowLabel: "B", cells: ["B", "90", "15"] }]);
  });

  it("列が減ると columnRemoved になる", () => {
    const mine = makeDoc("測定", [table("t1", [header, ["A", "80", "12"]])]);
    const theirs = makeDoc("測定", [table("t1", [["試料", "温度"], ["A", "80"]])]);

    const change = computeProposalDiff({ mine, theirs }).blocks[0];

    expect(cell(change.cells, "columnRemoved")).toMatchObject([{ column: "収率", cells: ["12"] }]);
  });

  it("行 ID があれば先頭セルを書き換えても同じ行として扱う", () => {
    const mine = makeDoc("測定", [
      table("t1", [header, ["A", "80", "12"], ["B", "90", "15"]], ["row_a", "row_b"]),
    ]);
    const theirs = makeDoc("測定", [
      table("t1", [header, ["A-2", "80", "12"], ["B", "90", "15"]], ["row_a", "row_b"]),
    ]);

    const change = computeProposalDiff({ mine, theirs }).blocks[0];

    expect(cell(change.cells, "rowAdded")).toEqual([]);
    expect(cell(change.cells, "rowRemoved")).toEqual([]);
    expect(cell(change.cells, "cellModified")).toMatchObject([
      { column: "試料", before: "A", after: "A-2" },
    ]);
  });
});

// ──────────────────────────────────────────────
// 3 者比較
// ──────────────────────────────────────────────

describe("computeProposalDiff — 3 者比較", () => {
  const base = makeDoc("計画", [
    para("p1", "80 ℃ で加熱"),
    para("p2", "収率を記録"),
    para("p3", "考察"),
    para("p4", "作者だけが消す段落"),
  ]);
  const mine = makeDoc("計画", [
    para("p1", "80 ℃ で加熱"),
    para("p2", "収率と純度を記録"),
    para("p3", "考察（作者版）"),
    para("p4", "作者だけが消す段落"),
  ]);
  const theirs = makeDoc("計画", [
    para("p1", "85 ℃ で加熱"),
    para("p2", "収率を記録"),
    para("p3", "考察（提案版）"),
    para("p5", "提案者が足した段落"),
  ]);

  it("提案者だけが変えた項目は theirs、作者だけなら mine、両方なら both", () => {
    const diff = computeProposalDiff({ base, mine, theirs });

    expect(find(diff.blocks, "p1")).toMatchObject({ kind: "modified", by: "theirs" });
    expect(find(diff.blocks, "p2")).toMatchObject({ kind: "modified", by: "mine" });
    expect(find(diff.blocks, "p3")).toMatchObject({ kind: "modified", by: "both" });
  });

  it("提案側だけにあるブロックは added / theirs、提案側が消したブロックは removed / theirs", () => {
    const diff = computeProposalDiff({ base, mine, theirs });

    expect(find(diff.blocks, "p5")).toMatchObject({ kind: "added", by: "theirs" });
    expect(find(diff.blocks, "p4")).toMatchObject({ kind: "removed", by: "theirs" });
  });

  it("基準版の本文も each 項目に添える", () => {
    const diff = computeProposalDiff({ base, mine, theirs });

    expect(find(diff.blocks, "p3")?.base).toBe("考察");
    expect(find(diff.blocks, "p5")?.base).toBeUndefined();
  });

  it("基準版が無ければ 2 者比較に格下げして全部 unknown にする", () => {
    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.blocks.every((b) => b.by === "unknown")).toBe(true);
    expect(diff.blocks.every((b) => b.base === undefined)).toBe(true);
  });

  it("表のセルも 3 者で分類する", () => {
    const header = ["試料", "温度"];
    const baseDoc = makeDoc("測定", [table("t1", [header, ["A", "80"], ["B", "90"]])]);
    const mineDoc = makeDoc("測定", [table("t1", [header, ["A", "80"], ["B", "95"]])]);
    const theirsDoc = makeDoc("測定", [table("t1", [header, ["A", "85"], ["B", "90"]])]);

    const change = computeProposalDiff({ base: baseDoc, mine: mineDoc, theirs: theirsDoc }).blocks[0];
    const modified = cell(change.cells, "cellModified");

    expect(modified).toMatchObject([
      { rowLabel: "A", by: "theirs", before: "80", after: "85" },
      { rowLabel: "B", by: "mine", before: "95", after: "90" },
    ]);
  });

  it("題名も 3 者で分類する", () => {
    const diff = computeProposalDiff({
      base: makeDoc("計画", [para("p1", "本文")]),
      mine: makeDoc("計画", [para("p1", "本文")]),
      theirs: makeDoc("計画 v2 (forked)", [para("p1", "本文")]),
    });

    expect(diff.title).toMatchObject({ by: "theirs", base: "計画", after: "計画 v2 (forked)" });
  });
});

// ──────────────────────────────────────────────
// 集計と表示用テキスト
// ──────────────────────────────────────────────

describe("summarizeProposalDiff", () => {
  it("種類と by の内訳を数える", () => {
    const base = makeDoc("計画", [para("p1", "一"), para("p2", "二")]);
    const mine = makeDoc("計画", [para("p1", "一"), para("p2", "二を作者が直した")]);
    const theirs = makeDoc("計画", [para("p1", "一を提案者が直した"), para("p2", "二"), para("p3", "三")]);

    const summary = summarizeProposalDiff(computeProposalDiff({ base, mine, theirs }));

    expect(summary).toMatchObject({
      total: 3,
      added: 1,
      modified: 2,
      removed: 0,
      byTheirs: 2,
      byMine: 1,
    });
  });
});

describe("blockToReadableText", () => {
  it("見出し・箇条書き・表を Markdown 断片にする", () => {
    expect(
      blockToReadableText({
        id: "h",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "実験手順", styles: {} }],
      }),
    ).toBe("## 実験手順");
    expect(
      blockToReadableText({
        id: "l",
        type: "bulletListItem",
        props: {},
        content: [{ type: "text", text: "秤量する", styles: {} }],
      }),
    ).toBe("- 秤量する");
    expect(blockToReadableText(table("t", [["試料"], ["A"]]))).toBe("| 試料 |\n| --- |\n| A |");
  });

  it("子ブロックは含めない（平坦化して別項目にするため）", () => {
    const block = { ...para("p", "親"), children: [para("c", "子")] };

    expect(blockToReadableText(block)).toBe("親");
  });

  it("名前の無い媒体ブロックは url を出さない（比べていないものを見せない）", () => {
    expect(blockToReadableText({ id: "i", type: "image", props: { url: "shared-blob:sha256:x" } })).toBe("");
  });
});

describe("stripForkSuffix", () => {
  it("末尾の (forked) を 1 回だけ落とす", () => {
    expect(stripForkSuffix("計画 (forked)")).toBe("計画");
    expect(stripForkSuffix("計画 (forked) (forked)")).toBe("計画 (forked)");
    expect(stripForkSuffix("(forked) 計画")).toBe("(forked) 計画");
  });
});

// ──────────────────────────────────────────────
// 項目 ID（取り込みの選択に使う。仕様 §25b A-1）
// ──────────────────────────────────────────────

describe("項目 ID", () => {
  it("ブロックの項目は block:<ブロック id>、題名は title", () => {
    const mine = makeDoc("もとの題名", [para("a", "残す"), para("b", "消す")]);
    const theirs = makeDoc("新しい題名", [para("a", "書き換えた"), para("c", "足した")]);
    const diff = computeProposalDiff({ mine, theirs });

    expect(diff.title?.id).toBe("title");
    expect(find(diff.blocks, "a")?.id).toBe("block:a");
    expect(find(diff.blocks, "b")?.id).toBe("block:b");
    expect(find(diff.blocks, "c")?.id).toBe("block:c");
  });

  it("id の無いブロックは平坦化した並び順で一意にする", () => {
    const noId = { type: "paragraph", props: {}, content: [], children: [] };
    const mine = makeDoc("実験", [para("a", "あ")]);
    const theirs = makeDoc("実験", [para("a", "あ"), noId]);
    const diff = computeProposalDiff({ mine, theirs });

    const added = diff.blocks.find((b) => b.kind === "added");
    expect(added?.id).toBe("block:@t1");
  });

  it("表の項目はセル / 行 / 列で接頭辞が分かれ、すべて一意", () => {
    const mine = makeDoc("実験", [
      table("t1", [["試料", "量", "備考"], ["A", "1", "旧"], ["B", "2", "旧"]], ["r1", "r2"]),
    ]);
    const theirs = makeDoc("実験", [
      table("t1", [["試料", "量"], ["A", "9"], ["C", "3"]], ["r1", "r3"]),
    ]);
    const diff = computeProposalDiff({ mine, theirs });
    const cells = diff.blocks[0].cells ?? [];

    expect(cell(cells, "cellModified")[0].id).toBe("cell:t1:id:r1:name:量");
    expect(cell(cells, "rowAdded")[0].id).toBe("row:t1:id:r3");
    expect(cell(cells, "rowRemoved")[0].id).toBe("row:t1:id:r2");
    expect(cell(cells, "columnRemoved")[0].id).toBe("col:t1:name:備考");

    const all = [diff.blocks[0].id, ...cells.map((c) => c.id)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("同じ入力からは同じ ID になる", () => {
    const mine = makeDoc("もとの題名", [
      para("a", "残す"),
      table("t1", [["試料", "量"], ["A", "1"]], ["r1"]),
    ]);
    const theirs = makeDoc("新しい題名", [
      para("a", "書き換えた"),
      table("t1", [["試料", "量"], ["A", "9"], ["B", "2"]], ["r1", "r2"]),
      para("c", "足した"),
    ]);

    const collect = () => {
      const diff = computeProposalDiff({ mine, theirs });
      return [
        diff.title?.id,
        ...diff.blocks.flatMap((b) => [b.id, ...(b.cells ?? []).map((c) => c.id)]),
      ];
    };

    expect(collect()).toEqual(collect());
  });
});
