// PageTemplate → 挿入用 / 新規ノート用の変換テスト。
// id の振り直しと blockId→path 変換を外すと、ラベルや表のふるまいが
// 別のブロックに付く（ユーザーのノートが静かに壊れる）ので単体で押さえる。

import { describe, it, expect } from "vitest";
import {
  pageTemplateToBuildResult,
  buildDocumentFromTemplate,
  remapTemplateBlocks,
} from "./from-page-template";
import type { PageTemplate } from "./types";

function makeTemplate(overrides: Partial<PageTemplate> = {}): PageTemplate {
  return {
    name: "焼結テンプレ",
    savedAt: "2026-09-01T00:00:00Z",
    pageTitle: "焼結の手順",
    blocks: [
      { id: "h1", type: "heading", props: { level: 1 }, content: [], children: [] },
      {
        id: "s1",
        type: "step",
        content: [],
        children: [
          { id: "p1", type: "paragraph", content: [], children: [] },
          {
            id: "t1",
            type: "table",
            content: {
              rows: [
                { cells: [[{ type: "text", text: "試料" }], [{ type: "text", text: "温度" }]] },
              ],
            },
            children: [],
          },
        ],
      },
    ],
    labels: [["s1", "procedure"]],
    attributes: [["s1", { checked: false, executor: "human", status: "planned" }]],
    ...overrides,
  };
}

describe("remapTemplateBlocks", () => {
  it("すべてのブロックに新しい id を振り、元のテンプレートは変更しない", () => {
    const tpl = makeTemplate();
    const { blocks, idMap } = remapTemplateBlocks(tpl);
    expect(tpl.blocks[0].id).toBe("h1"); // 元は無傷
    expect(blocks[0].id).not.toBe("h1");
    expect(idMap.get("s1")).toBe(blocks[1].id);
    expect(idMap.get("p1")).toBe(blocks[1].children[0].id);
    // 全部ユニーク
    const ids = [blocks[0].id, blocks[1].id, ...blocks[1].children.map((c: any) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("blockId → path（ルートからのインデックス配列）を作る", () => {
    const { pathMap } = remapTemplateBlocks(makeTemplate());
    expect(pathMap.get("h1")).toEqual([0]);
    expect(pathMap.get("s1")).toEqual([1]);
    expect(pathMap.get("p1")).toEqual([1, 0]);
    expect(pathMap.get("t1")).toEqual([1, 1]);
  });
});

describe("pageTemplateToBuildResult", () => {
  it("labels と attributes が path に変換される", () => {
    const r = pageTemplateToBuildResult(makeTemplate());
    expect(r.labels).toEqual([{ path: [1], label: "procedure" }]);
    expect(r.attributes).toEqual([
      { path: [1], attributes: { checked: false, executor: "human", status: "planned" } },
    ]);
  });

  it("本文に無い blockId のラベル・属性は捨てる", () => {
    const r = pageTemplateToBuildResult(
      makeTemplate({
        labels: [["missing", "procedure"]],
        attributes: [["missing", { checked: true, executor: "ai", status: "done" }]],
      }),
    );
    expect(r.labels).toEqual([]);
    expect(r.attributes).toBeUndefined();
  });

  it("tableMeta の先頭列のふるまいが columnTypes になる", () => {
    const r = pageTemplateToBuildResult(
      makeTemplate({
        tableMeta: { t1: { caption: "試料表", columns: { 試料: ["note-link"] } } },
      }),
    );
    expect(r.columnTypes).toEqual([{ path: [1, 1], type: "note-link" }]);
  });

  it("先頭列以外に付いたふるまいは復元しない（適用経路が先頭列しか扱えない）", () => {
    const r = pageTemplateToBuildResult(
      makeTemplate({ tableMeta: { t1: { columns: { 温度: ["datetime-auto"] } } } }),
    );
    expect(r.columnTypes).toBeUndefined();
  });

  it("provLinks は付けない", () => {
    expect(pageTemplateToBuildResult(makeTemplate()).provLinks).toBeUndefined();
  });
});

describe("buildDocumentFromTemplate", () => {
  const templateFrom = {
    sharedId: "sid-1",
    hash: "sha256:abc",
    title: "焼結テンプレ",
    usedAt: "2026-09-04T00:00:00Z",
  };

  it("1 ページのノートを組み立て、templateFrom を載せる", () => {
    const doc = buildDocumentFromTemplate(makeTemplate(), {
      title: "9/4 の焼結",
      templateFrom,
    });
    expect(doc.title).toBe("9/4 の焼結");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].id).toBe("main");
    expect(doc.pages[0].title).toBe("9/4 の焼結");
    expect(doc.templateFrom).toEqual(templateFrom);
    expect(doc.sharedRef).toBeUndefined();
    expect(doc.forkedFrom).toBeUndefined();
    expect(doc.documentProvenance).toBeUndefined();
  });

  it("page.labels は新しい blockId をキーに復元される", () => {
    const doc = buildDocumentFromTemplate(makeTemplate(), {
      title: "N",
      templateFrom,
    });
    const stepId = doc.pages[0].blocks[1].id;
    expect(stepId).not.toBe("s1");
    expect(doc.pages[0].labels).toEqual({ [stepId]: "procedure" });
  });

  it("tableMeta / mediaInlineLabels も新しい blockId に貼り替わる", () => {
    const doc = buildDocumentFromTemplate(
      makeTemplate({
        tableMeta: { t1: { caption: "試料表", columns: { 試料: ["note-link"] } } },
        mediaInlineLabels: { p1: { label: "material", entityId: "e1" } },
      }),
      { title: "N", templateFrom },
    );
    const tableId = doc.pages[0].blocks[1].children[1].id;
    const paraId = doc.pages[0].blocks[1].children[0].id;
    expect(Object.keys(doc.pages[0].tableMeta ?? {})).toEqual([tableId]);
    expect(doc.pages[0].tableMeta![tableId].caption).toBe("試料表");
    expect(doc.pages[0].mediaInlineLabels).toEqual({
      [paraId]: { label: "material", entityId: "e1" },
    });
  });

  it("tableMeta.noteLinks（共有元のノート id）は引き継がない", () => {
    const doc = buildDocumentFromTemplate(
      makeTemplate({
        tableMeta: { t1: { caption: "表", noteLinks: { 行1: "note-of-someone-else" } } },
      }),
      { title: "N", templateFrom },
    );
    const tableId = doc.pages[0].blocks[1].children[1].id;
    expect(doc.pages[0].tableMeta![tableId].noteLinks).toBeUndefined();
    expect(doc.pages[0].tableMeta![tableId].caption).toBe("表");
  });

  it("注釈が無ければ tableMeta / mediaInlineLabels のフィールド自体を付けない", () => {
    const doc = buildDocumentFromTemplate(makeTemplate(), { title: "N", templateFrom });
    expect(doc.pages[0].tableMeta).toBeUndefined();
    expect(doc.pages[0].mediaInlineLabels).toBeUndefined();
  });

  it("同じテンプレートから 2 回作っても blockId は衝突しない", () => {
    const tpl = makeTemplate();
    const a = buildDocumentFromTemplate(tpl, { title: "A", templateFrom });
    const b = buildDocumentFromTemplate(tpl, { title: "B", templateFrom });
    expect(a.pages[0].blocks[1].id).not.toBe(b.pages[0].blocks[1].id);
  });
});
