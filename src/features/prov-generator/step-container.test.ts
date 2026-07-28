// step コンテナ（手順を children を持つブロックとして第一級化）の PROV 生成テスト
//
// 見出し + procedure ラベルが「見出しのスコープ範囲」で Activity 境界を作るのに対し、
// step は「子孫（親子関係）」で境界を作る。どちらも
//   Entity が Activity の内側にある ⇒ used / wasGeneratedBy が構造から決まる
// という同じ不変量を表す。ここではその containment 束縛を検証する。

import { describe, it, expect } from "vitest";
import { generateProvDocument } from "./generator";

const styled = (text: string, styles: Record<string, string | boolean> = {}) => ({
  type: "text",
  text,
  styles,
});

const para = (id: string, content: any[], children: any[] = []) => ({
  id,
  type: "paragraph",
  content,
  children,
});

const step = (id: string, title: string, children: any[] = []) => ({
  id,
  type: "step",
  content: [styled(title)],
  children,
});

const gen = (blocks: any[], labels = new Map<string, string>(), links: any[] = []) =>
  generateProvDocument({ blocks, labels, links } as any);

const activityIds = (doc: any) =>
  doc["@graph"].filter((n: any) => n["@type"] === "prov:Activity").map((n: any) => n["@id"]);

const usedIds = (doc: any, actId: string) => {
  const act = doc["@graph"].find((n: any) => n["@id"] === actId);
  return ((act as any)?.["prov:used"] ?? []).map((u: any) => u["@id"]);
};

describe("step コンテナ → Activity", () => {
  it("step ブロックから activity_<id> が生成され、タイトルが label になる", () => {
    const doc = gen([step("s1", "反応 A を実施する")]);
    const act = doc["@graph"].find((n: any) => n["@id"] === "activity_s1");
    expect(act).toBeDefined();
    expect(act!["@type"]).toBe("prov:Activity");
    expect(act!["rdfs:label"]).toBe("反応 A を実施する");
  });

  it("タイトルの連番プレフィックスは Activity 名から除かれる（見出しと同じ扱い）", () => {
    const doc = gen([step("s1", "1. 前処理")]);
    const act = doc["@graph"].find((n: any) => n["@id"] === "activity_s1");
    expect(act!["rdfs:label"]).toBe("前処理");
  });

  it("ラベルを付けなくても Activity になる（step はブロック型そのものが工程）", () => {
    // labels は空。旧方式では procedure ラベルが必須だった。
    const doc = gen([step("s1", "撹拌する")]);
    expect(activityIds(doc)).toEqual(["activity_s1"]);
  });
});

describe("containment による束縛", () => {
  it("子孫の material が step に prov:used される", () => {
    const doc = gen([
      step("s1", "反応 A", [
        para("p1", [styled("NaCl", { inlineMaterial: "ent_nacl" }), styled(" を投入")]),
      ]),
    ]);
    expect(usedIds(doc, "activity_s1")).toContain("inline_material_ent_nacl");
  });

  it("子孫の output が step に prov:wasGeneratedBy される", () => {
    const doc = gen([
      step("s1", "反応 A", [
        para("p1", [styled("生成物X", { inlineOutput: "ent_x" })]),
      ]),
    ]);
    const ent = doc["@graph"].find((n: any) => n["@id"] === "inline_output_ent_x");
    const gb = (ent as any)?.["prov:wasGeneratedBy"];
    const ids = Array.isArray(gb) ? gb.map((g: any) => g["@id"]) : [gb?.["@id"]];
    expect(ids).toContain("activity_s1");
  });

  it("深い階層（子の子）の entity も step に束縛される", () => {
    const doc = gen([
      step("s1", "反応 A", [
        para("p1", [styled("親")], [
          para("p2", [styled("NaCl", { inlineMaterial: "ent_nacl" })]),
        ]),
      ]),
    ]);
    expect(usedIds(doc, "activity_s1")).toContain("inline_material_ent_nacl");
  });

  it("step の外に出したブロックは step に束縛されない（ドラッグ・アウト＝アンバインド）", () => {
    // 同じ内容が step の外（兄弟）にある状態
    const doc = gen([
      step("s1", "反応 A", []),
      para("p1", [styled("NaCl", { inlineMaterial: "ent_nacl" })]),
    ]);
    expect(usedIds(doc, "activity_s1")).not.toContain("inline_material_ent_nacl");
  });

  it("step のタイトル行に塗った entity もその step に束縛される", () => {
    const doc = gen([
      {
        id: "s1",
        type: "step",
        content: [styled("NaCl", { inlineMaterial: "ent_nacl" }), styled(" を溶かす")],
        children: [],
      },
    ]);
    expect(usedIds(doc, "activity_s1")).toContain("inline_material_ent_nacl");
  });
});

describe("入れ子の step", () => {
  it("内側の step が優先して束縛する（最も近い祖先が勝つ）", () => {
    const doc = gen([
      step("outer", "外側", [
        step("inner", "内側", [
          para("p1", [styled("NaCl", { inlineMaterial: "ent_nacl" })]),
        ]),
      ]),
    ]);
    expect(usedIds(doc, "activity_inner")).toContain("inline_material_ent_nacl");
    expect(usedIds(doc, "activity_outer")).not.toContain("inline_material_ent_nacl");
  });
});

describe("見出しパスとの共存（二重束縛の回避）", () => {
  it("step 内の procedure 見出しからは Activity を作らない", () => {
    const doc = gen(
      [step("s1", "反応 A", [
        { id: "h1", type: "heading", props: { level: 2 }, content: [styled("小見出し")], children: [] },
      ])],
      new Map([["h1", "procedure"]]),
    );
    expect(activityIds(doc)).toEqual(["activity_s1"]);
    expect(doc["@graph"].find((n: any) => n["@id"] === "activity_h1")).toBeUndefined();
  });

  it("step 内の見出しは外側の見出しスコープを壊さない", () => {
    // 「procedure 見出し → step（中に見出し） → step 外の段落」の順。
    // step 内の見出しが scopeStack を pop してしまうと、最後の段落が
    // 見出し Activity に束縛されなくなる。
    const doc = gen(
      [
        { id: "h-proc", type: "heading", props: { level: 2 }, content: [styled("工程")], children: [] },
        step("s1", "反応 A", [
          { id: "h-in", type: "heading", props: { level: 2 }, content: [styled("中の見出し")], children: [] },
        ]),
        para("p-after", [styled("NaCl", { inlineMaterial: "ent_nacl" })]),
      ],
      new Map([["h-proc", "procedure"]]),
    );
    expect(usedIds(doc, "activity_h-proc")).toContain("inline_material_ent_nacl");
  });

  it("step の外は従来どおり見出し + procedure で束縛される（後方互換）", () => {
    const doc = gen(
      [
        { id: "h-proc", type: "heading", props: { level: 2 }, content: [styled("工程")], children: [] },
        para("p1", [styled("NaCl", { inlineMaterial: "ent_nacl" })]),
        step("s1", "別の工程", [
          para("p2", [styled("KCl", { inlineMaterial: "ent_kcl" })]),
        ]),
      ],
      new Map([["h-proc", "procedure"]]),
    );
    // 見出し側
    expect(usedIds(doc, "activity_h-proc")).toContain("inline_material_ent_nacl");
    // step 側（見出しには吸われない）
    expect(usedIds(doc, "activity_s1")).toContain("inline_material_ent_kcl");
    expect(usedIds(doc, "activity_h-proc")).not.toContain("inline_material_ent_kcl");
  });
});

describe("step を跨ぐ工程の連鎖", () => {
  // PROV-DM の wasInformedBy(B, A) は ∃E. wasGeneratedBy(E, A) ∧ used(B, E) を意味する。
  // generator は明示的な wasInformedBy エッジを張らず、共有 Entity（同名の output と
  // material を 1 ノードに統合）でこの構造を表現する（generator.ts L1040 / L1096）。
  // step 間でも同じ導出が成り立つことを確認する。
  it("step1 の output と step2 の material が同名なら 1 Entity に統合され連鎖が立つ", () => {
    const doc = gen(
      [
        step("s1", "合成", [
          para("p1", [styled("中間体Y", { inlineOutput: "ent_y" })]),
        ]),
        step("s2", "精製", [
          para("p2", [styled("中間体Y", { inlineMaterial: "ent_y2" })]),
        ]),
      ],
      new Map(),
      [
        {
          id: "l1",
          sourceBlockId: "s2",
          targetBlockId: "s1",
          type: "informed_by" as const,
          layer: "prov" as const,
          createdBy: "human" as const,
        },
      ],
    );
    // 統合された 1 つの Entity を介して、s1 が生成し s2 が使う形になる
    const shared = doc["@graph"].find(
      (n: any) => n["@type"] === "prov:Entity" && n["rdfs:label"] === "中間体Y",
    );
    expect(shared).toBeDefined();

    // wasGeneratedBy(E, s1)
    const gb = (shared as any)["prov:wasGeneratedBy"];
    const gbIds = Array.isArray(gb) ? gb.map((g: any) => g["@id"]) : [gb?.["@id"]];
    expect(gbIds).toContain("activity_s1");

    // used(s2, E) — この 2 つが揃うと wasInformedBy(s2, s1) が構造的に導出される
    expect(usedIds(doc, "activity_s2")).toContain(shared!["@id"]);
  });

  it("同名 Entity が無い場合でも informed_by リンクから連鎖が張られる", () => {
    const doc = gen(
      [step("s1", "合成", []), step("s2", "精製", [])],
      new Map(),
      [
        {
          id: "l1",
          sourceBlockId: "s2",
          targetBlockId: "s1",
          type: "informed_by" as const,
          layer: "prov" as const,
          createdBy: "human" as const,
        },
      ],
    );
    // proxy Entity を介して s2 が s1 の成果物を used する形になる
    const act2 = doc["@graph"].find((n: any) => n["@id"] === "activity_s2");
    expect(act2).toBeDefined();
    expect(usedIds(doc, "activity_s2").length).toBeGreaterThan(0);
  });
});

// ── step の中に phase（計画/結果）の概念は無い ──
// 「step 内のモード帯」は一度実装したうえで撤回した。予定と実際の区別が効くのは
// プロトコル 1 本 × 実施 N 回の比較で、それはノート単位の分離（partOfPlanNoteId）が担う。
// step の子に plan / result ラベルが残っていても（撤回前に付けた等）、生成には影響しない。
describe("step 内の phase ラベルは無視される（帯は撤回済み）", () => {
  it("step の子に plan ラベルがあっても _plan Entity は作られない", () => {
    const doc = gen(
      [
        step("s1", "反応 A", [
          para("p-plan", [styled("NaCl", { inlineMaterial: "ent_nacl" })]),
        ]),
      ],
      new Map([["p-plan", "plan"]]),
    );
    // 通常の実施 Entity として扱われる
    expect(doc["@graph"].find((n: any) => n["@id"] === "inline_material_ent_nacl")).toBeDefined();
    expect(doc["@graph"].find((n: any) => n["@id"] === "inline_material_ent_nacl_plan")).toBeUndefined();
    // step への束縛は通常どおり
    expect(usedIds(doc, "activity_s1")).toContain("inline_material_ent_nacl");
  });

  it("見出し + procedure の旧ノートでは [Plan] 見出しの phase が従来どおり効く（後方互換）", () => {
    const doc = gen(
      [
        { id: "h-proc", type: "heading", props: { level: 2 }, content: [styled("工程")], children: [] },
        { id: "h-plan", type: "heading", props: { level: 3 }, content: [styled("計画")], children: [] },
        para("p1", [styled("NaCl", { inlineMaterial: "ent_nacl" })]),
      ],
      new Map([
        ["h-proc", "procedure"],
        ["h-plan", "plan"],
      ]),
    );
    expect(doc["@graph"].find((n: any) => n["@id"] === "inline_material_ent_nacl_plan")).toBeDefined();
  });
});
