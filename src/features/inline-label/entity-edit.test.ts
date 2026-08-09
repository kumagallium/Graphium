import { describe, it, expect } from "vitest";
import { renameInlineEntity, removeInlineEntity } from "./entity-edit";

/** updateBlock / removeBlocks を記録するだけの fake editor */
function makeEditor(document: any[]) {
  const updates: { id: string; content: any[] }[] = [];
  const removals: string[][] = [];
  return {
    document,
    updates,
    removals,
    updateBlock(id: string, patch: { content: any[] }) {
      updates.push({ id, content: patch.content });
    },
    removeBlocks(ids: string[]) {
      removals.push(ids);
    },
  };
}

const text = (t: string, styles: Record<string, string> = {}) => ({ type: "text", text: t, styles });

describe("renameInlineEntity", () => {
  it("該当 entityId の span テキストだけを置き換える", () => {
    const ed = makeEditor([
      {
        id: "p1",
        type: "paragraph",
        content: [
          text("Cu粉末", { inlineMaterial: "ent_material_a" }),
          text("を混合する。"),
        ],
      },
    ]);
    const n = renameInlineEntity(ed, "ent_material_a", "銅粉");
    expect(n).toBe(1);
    expect(ed.updates[0].id).toBe("p1");
    expect(ed.updates[0].content.map((c: any) => c.text)).toEqual(["銅粉", "を混合する。"]);
    // entityId（mark）は維持される
    expect(ed.updates[0].content[0].styles.inlineMaterial).toBe("ent_material_a");
  });

  it("分割 mark（同ブロック複数 piece）は最初の piece に統合する", () => {
    const ed = makeEditor([
      {
        id: "p1",
        type: "paragraph",
        content: [
          text("Cu", { inlineMaterial: "ent_material_a" }),
          text("粉末", { inlineMaterial: "ent_material_a", bold: "true" }),
          text("を使う"),
        ],
      },
    ]);
    renameInlineEntity(ed, "ent_material_a", "銅粉");
    expect(ed.updates[0].content.map((c: any) => c.text)).toEqual(["銅粉", "を使う"]);
  });

  it("attribute は binding（@activity 付き）でも entityId 部分で照合する", () => {
    const ed = makeEditor([
      {
        id: "p1",
        type: "paragraph",
        content: [text("温度: 900C", { inlineAttribute: "ent_attribute_x@activity" })],
      },
    ]);
    const n = renameInlineEntity(ed, "ent_attribute_x", "温度: 950C");
    expect(n).toBe(1);
    expect(ed.updates[0].content[0].text).toBe("温度: 950C");
    expect(ed.updates[0].content[0].styles.inlineAttribute).toBe("ent_attribute_x@activity");
  });

  it("別 entityId は触らない", () => {
    const ed = makeEditor([
      { id: "p1", type: "paragraph", content: [text("A", { inlineMaterial: "ent_material_other" })] },
    ]);
    expect(renameInlineEntity(ed, "ent_material_a", "B")).toBe(0);
    expect(ed.updates).toHaveLength(0);
  });
});

describe("removeInlineEntity", () => {
  it("専用行（span が唯一の中身）はブロックごと削除する", () => {
    const ed = makeEditor([
      { id: "step1", type: "step", content: [text("粉砕")], children: [
        { id: "p1", type: "paragraph", content: [text("粉砕粉", { inlineOutput: "ent_output_a" })] },
      ] },
    ]);
    const r = removeInlineEntity(ed, "ent_output_a");
    expect(r).toEqual({ removedBlocks: 1, unstyled: 0 });
    expect(ed.removals[0]).toEqual(["p1"]);
    expect(ed.updates).toHaveLength(0);
  });

  it("文章の一部なら mark だけ外してテキストは残す", () => {
    const ed = makeEditor([
      {
        id: "p1",
        type: "paragraph",
        content: [
          text("粉砕して"),
          text("粉砕粉", { inlineOutput: "ent_output_a" }),
          text("を得た。"),
        ],
      },
    ]);
    const r = removeInlineEntity(ed, "ent_output_a");
    expect(r).toEqual({ removedBlocks: 0, unstyled: 1 });
    expect(ed.removals).toHaveLength(0);
    const c = ed.updates[0].content;
    expect(c.map((x: any) => x.text).join("")).toBe("粉砕して粉砕粉を得た。");
    expect(c[1].styles.inlineOutput).toBeUndefined();
  });

  it("空白 piece 付きの専用行も行削除と判定する", () => {
    const ed = makeEditor([
      {
        id: "p1",
        type: "paragraph",
        content: [text("温度: 900C", { inlineAttribute: "ent_attribute_x@activity" }), text("  ")],
      },
    ]);
    const r = removeInlineEntity(ed, "ent_attribute_x");
    expect(r.removedBlocks).toBe(1);
  });

  it("他の mark（太字等）が同居していても該当キーだけ外す", () => {
    const ed = makeEditor([
      {
        id: "p1",
        type: "paragraph",
        content: [text("前置き "), text("乳鉢", { inlineTool: "ent_tool_a", bold: "true" })],
      },
    ]);
    removeInlineEntity(ed, "ent_tool_a");
    const styled = ed.updates[0].content[1];
    expect(styled.styles.inlineTool).toBeUndefined();
    expect(styled.styles.bold).toBe("true");
  });
});
