import { describe, it, expect } from "vitest";
import { migrateToLatest, LATEST_DOCUMENT_VERSION } from "./document-migration";
import type { GraphiumDocument } from "./document-types";

const baseDoc = (version: number, page: any): GraphiumDocument => ({
  version: version as any,
  title: "test",
  pages: [page],
  createdAt: "2026-01-01T00:00:00Z",
  modifiedAt: "2026-01-01T00:00:00Z",
});

const txt = (text: string) => [{ type: "text", text, styles: {} }];

describe("migrateToLatest", () => {
  it("最終バージョンに到達する", () => {
    const doc = baseDoc(1, { id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] });
    migrateToLatest(doc);
    expect(doc.version).toBe(LATEST_DOCUMENT_VERSION);
  });

  it("v3 → v4 → v5: result → output → BlockNote inline style 適用", () => {
    const doc = baseDoc(3, {
      id: "p1",
      title: "p1",
      blocks: [{ id: "b1", type: "paragraph", content: txt("test"), children: [] }],
      labels: { b1: "result" },
      provLinks: [],
      knowledgeLinks: [],
    });
    migrateToLatest(doc);
    expect(doc.pages[0].labels).toEqual({});
    const block = doc.pages[0].blocks[0];
    expect(block.content[0].styles.inlineOutput).toBe("ent_b1");
  });

  it("v4 → v5: block-level inline-type ラベルが BlockNote inline style に変換される", () => {
    const doc = baseDoc(4, {
      id: "p1",
      title: "p1",
      blocks: [
        { id: "b_mat", type: "bulletListItem", content: txt("NaCl 5g"), children: [] },
        { id: "b_tool", type: "bulletListItem", content: txt("ホットプレート"), children: [] },
        { id: "b_attr", type: "bulletListItem", content: txt("80°C"), children: [] },
        { id: "b_out", type: "paragraph", content: txt("透明溶液を得た"), children: [] },
      ],
      labels: {
        b_mat: "material",
        b_tool: "tool",
        b_attr: "attribute",
        b_out: "output",
      },
      provLinks: [],
      knowledgeLinks: [],
    });
    migrateToLatest(doc);

    expect(doc.pages[0].labels).toEqual({});
    const blocks = doc.pages[0].blocks;
    expect(blocks[0].content[0].styles.inlineMaterial).toBe("ent_b_mat");
    expect(blocks[1].content[0].styles.inlineTool).toBe("ent_b_tool");
    expect(blocks[2].content[0].styles.inlineAttribute).toBe("ent_b_attr");
    expect(blocks[3].content[0].styles.inlineOutput).toBe("ent_b_out");
  });

  it("v4 → v6 通し: heading 系ラベルは v6 で step 化 / 除去され、free.* だけ残る", () => {
    // v5 時点では procedure/plan/result は labels に残る仕様だったが、
    // v6 で procedure 見出しは step ブロックに変換され、plan/result は
    // （帯撤回により）除去される。migrateToLatest は常に最新まで通すので、
    // 通し結果の不変条件をここで固定する。
    const doc = baseDoc(4, {
      id: "p1",
      title: "p1",
      blocks: [
        { id: "h1", type: "heading", props: { level: 2 }, content: txt("ステップ"), children: [] },
        { id: "h_plan", type: "heading", props: { level: 3 }, content: txt("計画"), children: [] },
        { id: "h_result", type: "heading", props: { level: 3 }, content: txt("結果"), children: [] },
        { id: "p_free", type: "paragraph", content: txt("ここは目的"), children: [] },
      ],
      labels: {
        h1: "procedure",
        h_plan: "plan",
        h_result: "result",
        p_free: "free.purpose",
      },
      provLinks: [],
      knowledgeLinks: [],
    });
    migrateToLatest(doc);
    // free ラベルだけが残る
    expect(doc.pages[0].labels).toEqual({ p_free: "free.purpose" });
    // h1 は同 id の step になり、旧スコープ（plan/result 見出し + 段落）を children に持つ
    const step = doc.pages[0].blocks[0];
    expect(step.type).toBe("step");
    expect(step.id).toBe("h1");
    expect(step.children.map((c: any) => c.id)).toEqual(["h_plan", "h_result", "p_free"]);
    expect(step.content[0].styles).toEqual({});
  });

  it("v4 → v5: 既存 styles を破壊せずマージする（bold 等は残る）", () => {
    const doc = baseDoc(4, {
      id: "p1",
      title: "p1",
      blocks: [
        {
          id: "b_x",
          type: "paragraph",
          content: [{ type: "text", text: "hello", styles: { bold: true } }],
          children: [],
        },
      ],
      labels: { b_x: "material" },
      provLinks: [],
      knowledgeLinks: [],
    });
    migrateToLatest(doc);
    expect(doc.pages[0].blocks[0].content[0].styles.bold).toBe(true);
    expect(doc.pages[0].blocks[0].content[0].styles.inlineMaterial).toBe("ent_b_x");
  });

  it("v4 → v5: ネストされた children ブロックも index される", () => {
    const doc = baseDoc(4, {
      id: "p1",
      title: "p1",
      blocks: [
        {
          id: "parent",
          type: "bulletListItem",
          content: txt("親"),
          children: [
            { id: "child", type: "bulletListItem", content: txt("子要素"), children: [] },
          ],
        },
      ],
      labels: { child: "material" },
      provLinks: [],
      knowledgeLinks: [],
    });
    migrateToLatest(doc);
    expect(doc.pages[0].labels).toEqual({});
    const child = doc.pages[0].blocks[0].children[0];
    expect(child.content[0].styles.inlineMaterial).toBe("ent_child");
  });

  it("v4 → v5: ブロックが見つからないラベルは label から消すだけ", () => {
    const doc = baseDoc(4, {
      id: "p1",
      title: "p1",
      blocks: [],
      labels: { ghost: "material" },
      provLinks: [],
      knowledgeLinks: [],
    });
    migrateToLatest(doc);
    expect(doc.pages[0].labels).toEqual({});
  });

  it("v4 → v5: link inline 内の text にも style が適用される", () => {
    const doc = baseDoc(4, {
      id: "p1",
      title: "p1",
      blocks: [
        {
          id: "b_link",
          type: "paragraph",
          content: [
            { type: "text", text: "see ", styles: {} },
            { type: "link", href: "http://example.com", content: [{ type: "text", text: "here", styles: {} }] },
          ],
          children: [],
        },
      ],
      labels: { b_link: "material" },
      provLinks: [],
      knowledgeLinks: [],
    });
    migrateToLatest(doc);
    expect(doc.pages[0].blocks[0].content[0].styles.inlineMaterial).toBe("ent_b_link");
    expect(doc.pages[0].blocks[0].content[1].content[0].styles.inlineMaterial).toBe("ent_b_link");
  });

  // ──────────────────────────────────────────────
  // wikiMeta.kind: "concept" → "claim" リネームのマイグレーション
  //   - 旧 kind / 旧フィールド名 (derivedFromConcepts / conceptRole) を移行
  //   - 既に "claim" のものは触らない（idempotent）
  // ──────────────────────────────────────────────

  it('wikiMeta.kind: "concept" を "claim" にリネームする', () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "concept",
      derivedFromNotes: ["n1"],
      derivedFromChats: [],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.kind).toBe("claim");
  });

  it("既に kind: 'claim' のものは変更しない（idempotent）", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "claim",
      derivedFromNotes: ["n1"],
      derivedFromChats: [],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.kind).toBe("claim");
  });

  it("derivedFromConcepts → derivedFromClaims にリネームする", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "atom",
      derivedFromNotes: [],
      derivedFromChats: [],
      derivedFromConcepts: ["c1", "c2"],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.derivedFromClaims).toEqual(["c1", "c2"]);
    expect((doc as any).wikiMeta.derivedFromConcepts).toBeUndefined();
  });

  it("conceptRole → claimRole にリネームする（PR-B1 過渡期データの保険）", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "concept",
      derivedFromNotes: ["n1"],
      derivedFromChats: [],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
      conceptRole: ["finding", "anomaly"],
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.kind).toBe("claim");
    expect((doc as any).wikiMeta.claimRole).toEqual(["finding", "anomaly"]);
    expect((doc as any).wikiMeta.conceptRole).toBeUndefined();
  });

  it("wikiMeta が無い人ノートでは何もしない", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    migrateToLatest(doc);
    expect(doc.wikiMeta).toBeUndefined();
  });
});

describe("migrateToLatest: synthesisMode \"inductive\" 廃止 (PR-B4)", () => {
  // induction を Synthesis モードから外し、Atomizer 層に移動した。
  // 過去 inductive で保存されていた Synthesis は読み込み時に undefined にする。

  it("synthesisMode: \"inductive\" は undefined に格下げ", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "synthesis",
      derivedFromNotes: ["n1", "n2"],
      derivedFromChats: [],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
      synthesisMode: "inductive",
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.synthesisMode).toBeUndefined();
  });

  it("他の synthesisMode 値（abductive 等）は触らない", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "synthesis",
      derivedFromNotes: ["n1"],
      derivedFromChats: [],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
      synthesisMode: "abductive",
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.synthesisMode).toBe("abductive");
  });
});

describe("migrateToLatest: procedureContext は Claim 専用 (PR-B4.5)", () => {
  // 砂時計のくびれを通った Atom / Synthesis は context-stripped を contract と
  // するため、PR-B3 で書き込まれた procedureContext は strip する。
  // Claim には触らない。

  it("Atom の procedureContext は読み込み時に削除", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "atom",
      derivedFromNotes: [],
      derivedFromChats: [],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
      procedureContext: {
        derivedFromNotes: ["n1"],
        keyTools: ["BallMill"],
      },
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.procedureContext).toBeUndefined();
  });

  it("Synthesis の procedureContext も読み込み時に削除", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "synthesis",
      derivedFromNotes: ["n1"],
      derivedFromChats: [],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
      procedureContext: { keyTools: ["X"] },
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.procedureContext).toBeUndefined();
  });

  it("Claim の procedureContext は保持される（context あり層）", () => {
    const doc = baseDoc(5, {
      id: "p1", title: "p1", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [],
    });
    (doc as any).wikiMeta = {
      kind: "claim",
      derivedFromNotes: ["n1"],
      derivedFromChats: [],
      generatedAt: "2026-04-01T00:00:00Z",
      generatedBy: { model: "claude-opus-4-7", version: "1.0.0" },
      procedureContext: {
        derivedFromNotes: ["n1"],
        keyTools: ["X"],
      },
    };
    migrateToLatest(doc);
    expect((doc as any).wikiMeta.procedureContext).toBeDefined();
    expect((doc as any).wikiMeta.procedureContext.keyTools).toEqual(["X"]);
  });
});

describe("migrateToLatest: 未知の inline style を strip する", () => {
  it("inlineProcedure のような schema 外 style キーを除去する（version 据え置き）", () => {
    const doc: GraphiumDocument = {
      version: 5,
      title: "T",
      pages: [
        {
          id: "main",
          title: "T",
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              props: {},
              content: [
                {
                  type: "text",
                  text: "変換",
                  styles: { inlineProcedure: "ent_procedure_xxx", bold: true },
                },
                {
                  type: "text",
                  text: "ok",
                  styles: { inlineMaterial: "ent_m_yyy" },
                },
              ],
              children: [],
            },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
      createdAt: "2026-05-19T00:00:00Z",
      modifiedAt: "2026-05-19T00:00:00Z",
    };
    migrateToLatest(doc);
    const block = doc.pages[0].blocks[0];
    expect(block.content[0].styles.inlineProcedure).toBeUndefined();
    expect(block.content[0].styles.bold).toBe(true); // 標準 style は残す
    expect(block.content[1].styles.inlineMaterial).toBe("ent_m_yyy"); // 既知 inline style は残す
  });

  it("link ブロック内の text の styles もクリーンアップする", () => {
    const doc: GraphiumDocument = {
      version: 5,
      title: "T",
      pages: [
        {
          id: "main",
          title: "T",
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              props: {},
              content: [
                {
                  type: "link",
                  href: "https://example.com",
                  content: [
                    {
                      type: "text",
                      text: "link",
                      styles: { inlineProcedure: "ent_x", italic: true },
                    },
                  ],
                },
              ],
              children: [],
            },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
      createdAt: "2026-05-19T00:00:00Z",
      modifiedAt: "2026-05-19T00:00:00Z",
    };
    migrateToLatest(doc);
    const linkContent = (doc.pages[0].blocks[0].content as any)[0].content[0];
    expect(linkContent.styles.inlineProcedure).toBeUndefined();
    expect(linkContent.styles.italic).toBe(true);
  });
});

// ── v5 → v6: procedure 見出し + スコープ → step コンテナ ──
import { generateProvDocument } from "../features/prov-generator/generator";

describe("migrateProcedureHeadingsToSteps (v5→v6)", () => {
  const styled = (text: string, styles: Record<string, string> = {}) => ({
    type: "text",
    text,
    styles,
  });
  const heading = (id: string, level: number, text: string) => ({
    id,
    type: "heading",
    props: { level },
    content: [styled(text)],
    children: [],
  });
  const para = (id: string, content: any[]) => ({
    id,
    type: "paragraph",
    content,
    children: [],
  });
  const v5doc = (blocks: any[], labels: Record<string, string>): any => ({
    version: 5,
    title: "t",
    pages: [{ id: "p1", title: "Main", blocks, labels, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
    source: "human",
  });

  it("procedure 見出しが同じ id の step になり、スコープが children に入る", () => {
    const doc = v5doc(
      [
        heading("h1", 2, "1. 前処理"),
        para("p1", [styled("洗浄した")]),
        para("p2", [styled("乾燥した")]),
        heading("h2", 2, "2. 反応"),
        para("p3", [styled("撹拌した")]),
        para("tail", [styled("まとめ（工程の外）")]),
      ],
      { h1: "procedure", h2: "procedure" },
    );
    // 注: h2 のスコープは同レベル見出しが無いので末尾まで（tail も含む）
    const out = migrateToLatest(doc);
    expect(out.version).toBe(6);
    const blocks = out.pages[0].blocks;
    expect(blocks.map((b: any) => [b.type, b.id])).toEqual([
      ["step", "h1"],
      ["step", "h2"],
    ]);
    expect(blocks[0].children.map((c: any) => c.id)).toEqual(["p1", "p2"]);
    expect(blocks[1].children.map((c: any) => c.id)).toEqual(["p3", "tail"]);
    // タイトル content は見出しの content を引き継ぐ
    expect(blocks[0].content[0].text).toBe("1. 前処理");
    // procedure ラベルは消える
    expect(out.pages[0].labels).toEqual({});
  });

  it("下位レベルの procedure は入れ子 step になる", () => {
    const doc = v5doc(
      [
        heading("outer", 2, "外側"),
        para("p1", [styled("a")]),
        heading("inner", 3, "内側"),
        para("p2", [styled("b")]),
      ],
      { outer: "procedure", inner: "procedure" },
    );
    const blocks = migrateToLatest(doc).pages[0].blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("outer");
    expect(blocks[0].children.map((c: any) => c.id)).toEqual(["p1", "inner"]);
    expect(blocks[0].children[1].type).toBe("step");
    expect(blocks[0].children[1].children.map((c: any) => c.id)).toEqual(["p2"]);
  });

  it("plan / result ラベルは除去され、見出しは通常見出しとして step 内に残る", () => {
    const doc = v5doc(
      [
        heading("h1", 2, "工程"),
        heading("hp", 3, "計画"),
        para("p1", [styled("予定")]),
      ],
      { h1: "procedure", hp: "plan" },
    );
    const out = migrateToLatest(doc);
    const step = out.pages[0].blocks[0];
    expect(step.children.map((c: any) => [c.type, c.id])).toEqual([
      ["heading", "hp"],
      ["paragraph", "p1"],
    ]);
    expect(out.pages[0].labels).toEqual({});
  });

  it("procedure の無いノートは構造が変わらない（v6 に上がるだけ）", () => {
    const doc = v5doc(
      [heading("h1", 2, "ただの見出し"), para("p1", [styled("本文")])],
      {},
    );
    const out = migrateToLatest(doc);
    expect(out.version).toBe(6);
    expect(out.pages[0].blocks.map((b: any) => [b.type, b.id])).toEqual([
      ["heading", "h1"],
      ["paragraph", "p1"],
    ]);
  });

  it("グラフ等価性: 変換前（見出し+ラベル）と変換後（step）で同一の PROV が出る", () => {
    const mkBlocks = () => [
      heading("h1", 2, "1. 合成"),
      para("p1", [styled("NaCl", { inlineMaterial: "ent_nacl" }), styled(" を投入")]),
      para("p2", [styled("中間体Y", { inlineOutput: "ent_y" })]),
      heading("h2", 2, "2. 精製"),
      para("p3", [styled("カラム", { inlineTool: "ent_col" })]),
    ];
    // 変換前: 旧方式のまま generator にかける
    const before = generateProvDocument({
      blocks: mkBlocks(),
      labels: new Map([
        ["h1", "procedure"],
        ["h2", "procedure"],
      ]),
      links: [],
    } as any);
    // 変換後: migrate してから、残ったラベル（空）で generator にかける
    const migrated = migrateToLatest(v5doc(mkBlocks(), { h1: "procedure", h2: "procedure" }));
    const after = generateProvDocument({
      blocks: migrated.pages[0].blocks,
      labels: new Map(Object.entries(migrated.pages[0].labels ?? {})),
      links: [],
    } as any);

    const key = (doc: any) => ({
      activities: doc["@graph"]
        .filter((n: any) => n["@type"] === "prov:Activity")
        .map((n: any) => [n["@id"], n["rdfs:label"]])
        .sort(),
      used: doc["@graph"]
        .filter((n: any) => n["@type"] === "prov:Activity")
        .flatMap((n: any) =>
          ((n["prov:used"] ?? []) as any[]).map((u: any) => [n["@id"], u["@id"]]),
        )
        .sort(),
      generated: doc["@graph"]
        .filter((n: any) => n["prov:wasGeneratedBy"])
        .map((n: any) => n["@id"])
        .sort(),
    });
    expect(key(after)).toEqual(key(before));
  });
});

describe("migrateToLatest - 自己参照リンクのサニタイズ", () => {
  const linkDoc = (knowledgeLinks: any[], provLinks: any[] = []): GraphiumDocument =>
    baseDoc(LATEST_DOCUMENT_VERSION, {
      id: "p1",
      title: "p1",
      blocks: [],
      labels: {},
      provLinks,
      knowledgeLinks,
    });

  it("selfId を渡すと knowledgeLinks の自己参照（targetNoteId === selfId）を除去する", () => {
    const doc = linkDoc([
      { id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "self-id", type: "reference", layer: "knowledge", createdBy: "ai" },
      { id: "l2", sourceBlockId: "b2", targetBlockId: "", targetNoteId: "other-id", type: "reference", layer: "knowledge", createdBy: "ai" },
    ]);
    migrateToLatest(doc, "self-id");
    expect(doc.pages[0].knowledgeLinks).toEqual([
      { id: "l2", sourceBlockId: "b2", targetBlockId: "", targetNoteId: "other-id", type: "reference", layer: "knowledge", createdBy: "ai" },
    ]);
  });

  it("selfId を渡すと provLinks の自己参照も除去する", () => {
    const doc = linkDoc([], [
      { id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "self-id", type: "informed_by", layer: "prov", createdBy: "ai" },
    ]);
    migrateToLatest(doc, "self-id");
    expect(doc.pages[0].provLinks).toEqual([]);
  });

  it("selfId を渡さない場合は自己参照リンクをそのまま残す（後方互換）", () => {
    const doc = linkDoc([
      { id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "self-id", type: "reference", layer: "knowledge", createdBy: "ai" },
    ]);
    migrateToLatest(doc);
    expect(doc.pages[0].knowledgeLinks).toHaveLength(1);
  });

  it("自己参照が無ければ selfId を渡しても変化しない", () => {
    const doc = linkDoc([
      { id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "other-id", type: "reference", layer: "knowledge", createdBy: "ai" },
    ]);
    migrateToLatest(doc, "self-id");
    expect(doc.pages[0].knowledgeLinks).toHaveLength(1);
  });
});
