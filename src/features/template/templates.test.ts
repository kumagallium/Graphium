// テンプレート定義のテスト
//
// 計画テンプレートは説明文（template.plan.desc）とマニュアルで「対象と詳細ノートを
// 紐付けるインデックステーブル付き」と謳っている。表が素の table のまま挿入されると
// その説明が嘘になる（行頭のノート作成ボタンも @ での紐付けも出ない）ので、
//   - 定義側の columnTypes マーク（どの表を note-link にするか）
//   - note-app の handleTemplateSelect がそれを tableMeta に適用するときの前提
//     （挿入前に振った id が挿入後も保たれ、先頭列の名前が読める）
// をここで固定する。

import { describe, it, expect, afterEach } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { getAllTemplates, type TemplateDef } from "./templates";
import { readFirstColumnName, withColumnType } from "../table-meta";
import { getLocale, syncLocale, t } from "../../i18n";

const identity = (key: string) => key;

/** path（ルートからのインデックス配列）でブロックを引く。note-app の idAtPath と同じ辿り方 */
function blockAtPath(blocks: any[], path: number[]): any | null {
  let nodes: any[] = blocks;
  let node: any = null;
  for (const idx of path) {
    node = nodes?.[idx];
    if (!node) return null;
    nodes = node.children ?? [];
  }
  return node;
}

/** note-app の handleTemplateSelect と同じく、挿入前に全ブロックへ id を振る */
function assignIds(list: any[]) {
  for (const b of list ?? []) {
    if (b && typeof b === "object") {
      if (!b.id) b.id = crypto.randomUUID();
      if (Array.isArray(b.children)) assignIds(b.children);
    }
  }
}

function planTemplate(): TemplateDef {
  const plan = getAllTemplates().find((tmpl) => tmpl.id === "plan");
  if (!plan) throw new Error("plan template is not registered");
  return plan;
}

describe("計画テンプレート", () => {
  it("『対象と条件』の表が note-link（インデックステーブル）でマークされている", () => {
    const { blocks, columnTypes } = planTemplate().build(identity);

    const noteLinkMarks = (columnTypes ?? []).filter((c) => c.type === "note-link");
    expect(noteLinkMarks).toHaveLength(1);

    // マークされているのはテーブルで、しかもテンプレート内で唯一の表（= 対象と条件の表）
    const table = blockAtPath(blocks, noteLinkMarks[0].path);
    expect(table?.type).toBe("table");
    expect(blocks.filter((b) => b.type === "table")).toHaveLength(1);

    // 先頭列がノート名になる列（行頭ボタンでこの列の値からノートが作られる）
    expect(readFirstColumnName(table)).toBe("template.plan.colSampleName");
  });

  it("タグ・説明文と実体が揃っている（インデックステーブルを謳うなら note-link が付く）", () => {
    const plan = planTemplate();
    expect(plan.tagKeys).toContain("template.tag.indexTable");
    const { columnTypes } = plan.build(identity);
    expect((columnTypes ?? []).some((c) => c.type === "note-link")).toBe(true);
  });
});

describe("公式テンプレートの columnTypes", () => {
  it("path はすべてテーブルブロックを指す（列のふるまいは表にしか付かない）", () => {
    for (const tmpl of getAllTemplates()) {
      const { blocks, columnTypes } = tmpl.build(identity);
      for (const { path } of columnTypes ?? []) {
        expect(blockAtPath(blocks, path)?.type, `${tmpl.id}: [${path.join(", ")}]`).toBe("table");
      }
    }
  });
});

describe("テンプレート適用（note-app の handleTemplateSelect と同じ手順）", () => {
  // note-app は「挿入前に id を振る → columnTypes の path を id に解決 → insertBlocks →
  // editor.getBlock(id) → readFirstColumnName を列名として addColumnType(id, 列名, type)」
  // の順で、スラッシュメニューのインデックステーブル挿入と同じ関数で note-link を付ける。
  // ここでは id が挿入後も保たれ、先頭列名が読めて、tableMeta の形になることを
  // ヘッドレス BlockNote で確認する（列名は言語で変わるので日英とも見る）。
  const originalLocale = getLocale();
  afterEach(() => {
    syncLocale(originalLocale);
  });

  it.each([
    ["ja", "対象"],
    ["en", "Item"],
  ] as const)("%s: 挿入後の表に先頭列「%s」をキーとして note-link が付く", (locale, expectedColumn) => {
    syncLocale(locale);
    const { blocks, columnTypes } = planTemplate().build(t);
    assignIds(blocks);
    const marks = (columnTypes ?? []).map((c) => ({
      blockId: blockAtPath(blocks, c.path)?.id ?? null,
      type: c.type,
    }));
    expect(marks).toHaveLength(1);
    expect(marks[0].blockId).toBeTruthy();

    const editor = BlockNoteEditor.create({
      initialContent: [{ type: "paragraph", content: [{ type: "text", text: "/", styles: {} }] }],
    } as any);
    editor.insertBlocks(blocks as any, (editor.document as any[])[0], "after");

    // 挿入前に振った id で挿入後の表が引ける（focusPath / provLinks と同じ前提）
    const inserted = editor.getBlock(marks[0].blockId!) as any;
    expect(inserted?.type).toBe("table");

    // 先頭列名をキーに note-link が付く = スラッシュ挿入したインデックステーブルと同じ形
    const columnName = readFirstColumnName(inserted);
    expect(columnName).toBe(expectedColumn);
    expect(withColumnType(undefined, columnName, marks[0].type)).toEqual({
      [expectedColumn]: ["note-link"],
    });
  });
});
