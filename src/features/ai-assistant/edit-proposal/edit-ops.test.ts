import { describe, expect, it } from "vitest";
import { applyEditChange, diffBlocksToOps, formatBlocksForAi, listBlocksForEdit } from "./edit-ops";

const p = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "paragraph",
  props: { textColor: "default" },
  content: [{ type: "text", text, styles: {} }],
  children: [],
  ...extra,
});

const doc = () => [
  { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "手順", styles: {} }], children: [] },
  p("a", "一次発酵: 30℃ で 50 分"),
  p("b", "", {
    content: [
      { type: "text", text: "参照: ", styles: {} },
      { type: "link", href: "https://example.com", content: [{ type: "text", text: "資料", styles: {} }] },
    ],
  }),
  p("c", "親", { children: [p("c1", "子")] }),
];

describe("listBlocksForEdit", () => {
  it("文書順に b1… を振り、リンク入りは書き換え不可・子持ちを印す", () => {
    const list = listBlocksForEdit(doc());
    expect(list.map((b) => b.handle)).toEqual(["b1", "b2", "b3", "b4", "b5"]);
    expect(list.find((b) => b.id === "b")?.rewritable).toBe(false);
    expect(list.find((b) => b.id === "c")?.hasChildren).toBe(true);
    expect(list.find((b) => b.id === "c1")?.depth).toBe(1);
    expect(formatBlocksForAi(list)).toContain("[b3 | paragraph, read-only]");
  });

  it("skip に入れた ID は出さない", () => {
    expect(listBlocksForEdit(doc(), new Set(["h"]))[0].id).toBe("a");
  });
});

describe("applyEditChange", () => {
  it("置き換えは ID と子を残して中身を差し替え、元の配列は変えない", () => {
    const before = doc();
    const r = applyEditChange(before, { op: "replace", blockId: "a", before: "一次発酵: 30℃ で 50 分", after: "一次発酵: **28℃** で 60 分" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.blocks[1];
    expect(a.id).toBe("a");
    expect(a.content.map((c: any) => c.text).join("")).toBe("一次発酵: 28℃ で 60 分");
    expect(before[1].content[0].text).toBe("一次発酵: 30℃ で 50 分");
  });

  it("置き換えの 2 行目以降は後ろに足し、種別が変われば前の種別の props を持ち越さない", () => {
    const r = applyEditChange(doc(), { op: "replace", blockId: "h", before: "## 手順", after: "手順の説明\n- 一つ目" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blocks[0]).toMatchObject({ id: "h", type: "paragraph" });
    expect(r.blocks[0].props.level).toBeUndefined();
    expect(r.blocks[1].type).toBe("bulletListItem");
  });

  it("案の後に本文が変わっていれば stale", () => {
    const r = applyEditChange(doc(), { op: "replace", blockId: "a", before: "古い本文", after: "x" });
    expect(r).toEqual({ ok: false, reason: "stale" });
  });

  it("空白の違いだけなら stale にしない", () => {
    const r = applyEditChange(doc(), { op: "delete", blockId: "a", before: "  一次発酵:  30℃ で 50 分 " });
    expect(r.ok).toBe(true);
  });

  it("リンク入りのブロックは置き換えない（後ろに足すのは可）", () => {
    const before = "参照: [資料](https://example.com)";
    expect(applyEditChange(doc(), { op: "replace", blockId: "b", before, after: "x" })).toEqual({ ok: false, reason: "not_rewritable" });
    const r = applyEditChange(doc(), { op: "insert", blockId: "b", before, after: "追記" });
    expect(r.ok && r.blocks.map((b: any) => b.id).indexOf("b")).toBe(2);
    expect(r.ok && r.blocks[3].content[0].text).toBe("追記");
  });

  it("子持ちのブロックは消さない・子のブロックは消せる・無い ID は missing", () => {
    expect(applyEditChange(doc(), { op: "delete", blockId: "c", before: "親" })).toEqual({ ok: false, reason: "has_children" });
    const r = applyEditChange(doc(), { op: "delete", blockId: "c1", before: "子" });
    expect(r.ok && r.blocks[3].children).toEqual([]);
    expect(applyEditChange(doc(), { op: "delete", blockId: "zz", before: "" })).toEqual({ ok: false, reason: "missing" });
  });

  it("表などの文字でないブロックは、本文が空でも消さない", () => {
    const blocks = [{ id: "t", type: "table", props: {}, content: { type: "tableContent", rows: [] }, children: [] }];
    expect(applyEditChange(blocks, { op: "delete", blockId: "t", before: "" })).toEqual({ ok: false, reason: "not_rewritable" });
  });

  it("空の本文での置き換え・追加は empty", () => {
    expect(applyEditChange(doc(), { op: "insert", blockId: "a", before: "一次発酵: 30℃ で 50 分", after: "  \n " })).toEqual({ ok: false, reason: "empty" });
  });
});

describe("diffBlocksToOps", () => {
  it("書き換え・追加・削除を最小の操作にする", () => {
    const before = doc();
    let r = applyEditChange(before, { op: "replace", blockId: "a", before: "一次発酵: 30℃ で 50 分", after: "変更" });
    if (!r.ok) throw new Error();
    r = applyEditChange(r.blocks, { op: "insert", blockId: "a", before: "変更", after: "足した" });
    if (!r.ok) throw new Error();
    r = applyEditChange(r.blocks, { op: "delete", blockId: "c1", before: "子" });
    if (!r.ok) throw new Error();
    const ops = diffBlocksToOps(before, r.blocks);
    expect(ops[0]).toEqual({ kind: "remove", ids: ["c1"] });
    expect(ops.find((o) => o.kind === "update")).toMatchObject({ id: "a" });
    expect(ops.find((o) => o.kind === "insert")).toMatchObject({ refId: "a", placement: "after" });
    expect(ops).toHaveLength(3);
  });

  it("消したブロックを戻す（元に戻す）と、前の兄弟の後ろに入れ直す", () => {
    const before = doc();
    const r = applyEditChange(before, { op: "delete", blockId: "a", before: "一次発酵: 30℃ で 50 分" });
    if (!r.ok) throw new Error();
    const ops = diffBlocksToOps(r.blocks, before);
    expect(ops).toEqual([{ kind: "insert", blocks: [before[1]], refId: "h", placement: "after" }]);
  });

  it("変わっていなければ操作は無い", () => {
    expect(diffBlocksToOps(doc(), doc())).toEqual([]);
  });
});
