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

  it("v4 → v5: heading 系ラベル（procedure/plan/result/free.*）は labels に残る", () => {
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
    expect(doc.pages[0].labels).toEqual({
      h1: "procedure",
      h_plan: "plan",
      h_result: "result",
      p_free: "free.purpose",
    });
    expect(doc.pages[0].blocks[0].content[0].styles).toEqual({});
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
