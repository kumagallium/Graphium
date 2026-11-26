import { describe, it, expect } from "vitest";
import { markDuplicates, type RowState } from "./bulk-title-rename-dialog";

describe("markDuplicates", () => {
  it("同じ新しい名前が 2 行以上に出たら、どれもチェックを外して印を付ける", () => {
    let rows: Record<string, RowState> = {};
    rows = markDuplicates({ ...rows, a: { status: "ready", newName: "社内テンプレート.pptx", checked: true } }, "a");
    expect(rows.a).toEqual({ status: "ready", newName: "社内テンプレート.pptx", checked: true });
    rows = markDuplicates({ ...rows, b: { status: "ready", newName: "社内テンプレート.pptx", checked: true } }, "b");
    expect(rows.a).toMatchObject({ checked: false, duplicate: true });
    expect(rows.b).toMatchObject({ checked: false, duplicate: true });
    rows = markDuplicates({ ...rows, c: { status: "ready", newName: "熱電材料の概要.pptx", checked: true } }, "c");
    expect(rows.c).toEqual({ status: "ready", newName: "熱電材料の概要.pptx", checked: true });
  });

  it("見つからない・変更なしの行は比べない", () => {
    const rows = markDuplicates(
      { x: { status: "unchanged" }, y: { status: "ready", newName: "A paper.pdf", checked: true } },
      "y",
    );
    expect(rows.y).toEqual({ status: "ready", newName: "A paper.pdf", checked: true });
  });
});
