// 個人テンプレートの編集画面の下回り（包み方・受け口）のテスト
import { describe, it, expect } from "vitest";
import {
  getUserTemplateEditHandler,
  setUserTemplateEditHandler,
  startTemplateEditing,
  templateEditDocKey,
  userTemplateAttributes,
  userTemplateToEditDocument,
} from "./template-edit";
import type { UserTemplateRecord } from "./user-template-store";

const record = (): UserTemplateRecord => ({
  version: 1,
  id: "t1",
  title: "焼結の手順",
  description: "電気炉",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  template: {
    name: "焼結の手順",
    savedAt: "2026-10-02T00:00:00.000Z",
    pageTitle: "元のノート",
    blocks: [
      { id: "b1", type: "paragraph", children: [{ id: "b1c", type: "paragraph" }] },
      { id: "tbl", type: "table" },
    ],
    labels: [["b1", "[手順]"]],
    attributes: [["b1", { checked: false, executor: "machine", status: "planned" }]],
    tableMeta: { tbl: { columns: {} } as any },
    mediaInlineLabels: { img: { label: "[結果]" } as any },
  },
});

describe("template-edit", () => {
  it("ブロック id を振り直さずに包む（ラベル・表の注釈は同じ id のまま）", () => {
    const rec = record();
    const doc = userTemplateToEditDocument(rec);
    expect(doc.title).toBe("焼結の手順");
    expect(doc.pages).toHaveLength(1);
    const page = doc.pages[0];
    expect(page.title).toBe("焼結の手順");
    expect(page.blocks.map((b: any) => b.id)).toEqual(["b1", "tbl"]);
    expect(page.blocks[0].children[0].id).toBe("b1c");
    expect(page.labels).toEqual({ b1: "[手順]" });
    expect(Object.keys(page.tableMeta ?? {})).toEqual(["tbl"]);
    expect(Object.keys(page.mediaInlineLabels ?? {})).toEqual(["img"]);
    // ノートではないので、由来・来歴は持たない
    expect(doc.templateFrom).toBeUndefined();
    expect(doc.documentProvenance).toBeUndefined();
  });

  it("包んだ文書を直しても元のレコードは変わらない", () => {
    const rec = record();
    const doc = userTemplateToEditDocument(rec);
    doc.pages[0].blocks.push({ id: "new", type: "paragraph" });
    doc.pages[0].labels.new = "[材料]";
    const attrs = userTemplateAttributes(rec);
    attrs[0][1].checked = true;
    expect(rec.template.blocks).toHaveLength(2);
    expect(rec.template.labels).toEqual([["b1", "[手順]"]]);
    expect(rec.template.attributes[0][1].checked).toBe(false);
  });

  it("注釈の無いテンプレートは tableMeta / mediaInlineLabels を持たない", () => {
    const rec = record();
    delete rec.template.tableMeta;
    delete rec.template.mediaInlineLabels;
    const page = userTemplateToEditDocument(rec).pages[0];
    expect("tableMeta" in page).toBe(false);
    expect("mediaInlineLabels" in page).toBe(false);
  });

  it("編集の 1 回分は開いたときの題名・属性の写しを持ち、捨てた印は無い", () => {
    const rec = record();
    const editing = startTemplateEditing(rec);
    expect(editing.initialTitle).toBe("焼結の手順");
    expect(editing.initialAttributes).toEqual(rec.template.attributes);
    expect(editing.initialAttributes).not.toBe(rec.template.attributes);
    expect(editing.attributesRef.current).toBeNull();
    expect(editing.discarded).toBe(false);
  });

  it("保存キーはノート・wiki:・skill: と衝突しない", () => {
    expect(templateEditDocKey("t1")).toBe("template:t1");
  });

  it("受け口は最後に登録したもの。外すのは自分が登録したものだけ", () => {
    const a = () => {};
    const b = () => {};
    const offA = setUserTemplateEditHandler(a);
    const offB = setUserTemplateEditHandler(b);
    offA();
    expect(getUserTemplateEditHandler()).toBe(b);
    offB();
    expect(getUserTemplateEditHandler()).toBeNull();
  });
});
