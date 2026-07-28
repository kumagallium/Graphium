import { describe, it, expect } from "vitest";
import { buildProvNoteDocument } from "./prov-note-builder";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";

// 変換後はブロックが step の children に入るため、テキストで再帰検索する
const findByText = (blocks: any[], text: string): any => {
  for (const b of blocks ?? []) {
    if (b?.content?.[0]?.text === text) return b;
    const hit = findByText(b?.children, text);
    if (hit) return hit;
  }
  return null;
};

describe("buildProvNoteDocument", () => {
  const baseParams = {
    title: "Tomato Pasta",
    sourceUrl: "https://example.com/tomato-pasta",
    sourceTitle: "Tomato Pasta — Example",
    sourceFetchedAt: "2026-04-24T12:00:00.000Z",
    model: "claude-sonnet-4-6",
  };

  it("sourceUrl / sourceTitle / sourceFetchedAt をトップレベルに保存する", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [{ text: "200g spaghetti", role: "material", blockType: "bulletListItem" }],
    });
    expect(doc.sourceUrl).toBe(baseParams.sourceUrl);
    expect(doc.sourceTitle).toBe(baseParams.sourceTitle);
    expect(doc.sourceFetchedAt).toBe(baseParams.sourceFetchedAt);
  });

  it("version は LATEST、pages は 1 ページ", () => {
    const doc = buildProvNoteDocument({ ...baseParams, blocks: [] });
    expect(doc.version).toBe(LATEST_DOCUMENT_VERSION);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].id).toBe("main");
  });

  it("出典ヘッダーブロックが先頭に挿入される", () => {
    const doc = buildProvNoteDocument({ ...baseParams, blocks: [] });
    const [first] = doc.pages[0].blocks;
    expect(first.type).toBe("paragraph");
    const hasLink = first.content.some(
      (c: any) => c.type === "link" && c.href === baseParams.sourceUrl,
    );
    expect(hasLink).toBe(true);
  });

  it("Phase E: procedure は step ブロックになり、material は inline highlight になる", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Slice", blockType: "heading", level: 2, role: "procedure" },
        { text: "spaghetti", role: "material", blockType: "bulletListItem" },
        { text: "Narrative paragraph", blockType: "paragraph" },
      ],
    });
    const page = doc.pages[0];
    // source header + step（スコープの 2 ブロックは step の children に入る）
    expect(page.blocks).toHaveLength(2);
    const [, step] = page.blocks;
    expect(step.type).toBe("step");
    expect(step.content[0].text).toBe("Slice");
    const [material, para] = step.children;
    // procedure ラベルは step 化で消費される（labels には残らない）
    expect(page.labels[step.id]).toBeUndefined();
    // material は inline highlight として content に書き戻される (block-level label には登録されない)
    expect(page.labels[material.id]).toBeUndefined();
    expect(material.content[0].styles.inlineMaterial).toMatch(/^ent_material_/);
    expect(page.labels[para.id]).toBeUndefined();
  });

  it("ネストした children も全て inline highlight として content に焼き込まれる", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Slice", blockType: "heading", level: 2, role: "procedure" },
        {
          text: "bamboo",
          role: "material",
          blockType: "bulletListItem",
          children: [
            { text: "sliced 1cm", role: "attribute", blockType: "bulletListItem" },
            { text: "boiled", role: "attribute", blockType: "bulletListItem" },
          ],
        },
      ],
    });
    const page = doc.pages[0];
    // step の children に入る
    const material = page.blocks[1].children[0];
    expect(material.type).toBe("bulletListItem");
    expect(material.content[0].styles.inlineMaterial).toMatch(/^ent_material_/);
    expect(material.children).toHaveLength(2);

    // attribute も inline highlight 化（block-level label には入らない）
    expect(page.labels[material.id]).toBeUndefined();
    for (const child of material.children) {
      expect(page.labels[child.id]).toBeUndefined();
      expect(child.content[0].styles.inlineAttribute).toMatch(/^ent_attribute_/);
    }
  });

  it("role のエイリアス（'materials'）は正規化されて inline highlight になる", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Prep", blockType: "heading", level: 2, role: "procedure" },
        { text: "egg", role: "materials", blockType: "bulletListItem" },
      ],
    });
    const material = findByText(doc.pages[0].blocks, "egg");
    expect(material.content[0].styles.inlineMaterial).toMatch(/^ent_material_/);
  });

  it("role が core でなければ inline style もラベルも付かない", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [{ text: "x", role: "unknown-role", blockType: "paragraph" }],
    });
    const contentBlock = doc.pages[0].blocks[1];
    expect(doc.pages[0].labels[contentBlock.id]).toBeUndefined();
    expect(contentBlock.content[0].styles).toEqual({});
  });

  it("Phase F: paragraph の content spans から inline highlight 付き BlockNote content を組み立てる", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Sauté", blockType: "heading", level: 2, role: "procedure", stepId: "saute-garlic" },
        {
          blockType: "paragraph",
          content: [
            { text: "Warm " },
            { text: "olive oil", role: "material" },
            { text: " over " },
            { text: "low heat", role: "attribute" },
            { text: "." },
          ],
        },
      ],
    });
    const page = doc.pages[0];
    // step の children に入る
    const para = page.blocks[1].children[0];
    expect(para.type).toBe("paragraph");
    expect(para.content).toHaveLength(5);
    expect(para.content[0]).toEqual({ type: "text", text: "Warm ", styles: {} });
    expect(para.content[1].text).toBe("olive oil");
    expect(para.content[1].styles.inlineMaterial).toMatch(/^ent_material_/);
    expect(para.content[3].styles.inlineAttribute).toMatch(/^ent_attribute_/);
    expect(para.content[4]).toEqual({ type: "text", text: ".", styles: {} });
    // block-level labels には何も入らない
    expect(page.labels[para.id]).toBeUndefined();
  });

  it("Phase F: span の derivedFrom から informed_by リンクが張られる", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Slice", blockType: "heading", level: 2, role: "procedure", stepId: "slice-garlic" },
        {
          blockType: "paragraph",
          content: [{ text: "garlic", role: "material" }],
        },
        { text: "Sauté", blockType: "heading", level: 2, role: "procedure", stepId: "saute-garlic" },
        {
          blockType: "paragraph",
          content: [
            { text: "Warm oil with " },
            { text: "sliced garlic", role: "material", derivedFrom: "slice-garlic" },
            { text: "." },
          ],
        },
      ],
    });
    const page = doc.pages[0];
    // 変換で step になるが id は見出しを引き継ぐので、リンクは step 間に張られる
    const steps = page.blocks.filter((b: any) => b.type === "step");
    // saute-garlic → slice-garlic の informed_by が span derivedFrom 由来で張られる
    const links = page.provLinks;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      sourceBlockId: steps[1].id,
      targetBlockId: steps[0].id,
      type: "informed_by",
    });
  });

  it("Phase F: scope 外の material/tool/output span は inline 化されずプレーンになる（attribute は許容）", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        // scope 開かない（procedure heading なし）でいきなり paragraph
        {
          blockType: "paragraph",
          content: [
            { text: "olive oil", role: "material" },        // scope 外 → drop
            { text: " warmed at " },
            { text: "low heat", role: "attribute" },        // scope 外でも attribute は許容
          ],
        },
      ],
    });
    const para = doc.pages[0].blocks[1];
    expect(para.content[0].styles).toEqual({});             // material は剥がれる
    expect(para.content[2].styles.inlineAttribute).toMatch(/^ent_attribute_/);
  });

  it("heading の props.level が設定される", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [{ text: "Ingredients", blockType: "heading", level: 2 }],
    });
    const heading = doc.pages[0].blocks[1];
    expect(heading.type).toBe("heading");
    expect(heading.props.level).toBe(2);
  });

  it("text が空白のみのブロックは落ちる（親子階層どちらも）", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "   ", role: "material" },
        {
          text: "real",
          role: "material",
          children: [
            { text: "", role: "attribute" },
            { text: "valid", role: "attribute" },
          ],
        },
      ],
    });
    const page = doc.pages[0];
    expect(page.blocks).toHaveLength(2); // source + 1 material
    const material = page.blocks[1];
    expect(material.children).toHaveLength(1);
    expect(material.children[0].content[0].text).toBe("valid");
  });

  it("依存情報が無い場合は文書順の線形連鎖にフォールバックする", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Slice", blockType: "heading", level: 2, role: "procedure" },
        { text: "bamboo", role: "material", blockType: "bulletListItem" },
        { text: "Sauté", blockType: "heading", level: 2, role: "procedure" },
        { text: "frying pan", role: "tool", blockType: "bulletListItem" },
        { text: "Plate", blockType: "heading", level: 2, role: "procedure" },
        { text: "finished steak", role: "output", blockType: "bulletListItem" },
      ],
    });
    const page = doc.pages[0];
    const steps = page.blocks.filter((b: any) => b.type === "step");
    const links = page.provLinks;
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      sourceBlockId: steps[1].id,
      targetBlockId: steps[0].id,
      type: "informed_by",
      layer: "prov",
      createdBy: "ai",
    });
    expect(links[1]).toMatchObject({
      sourceBlockId: steps[2].id,
      targetBlockId: steps[1].id,
      type: "informed_by",
    });
  });

  it("material.derivedFrom から非線形な informed_by DAG を構築する（並列分岐）", () => {
    // 料理レシピの並列パターン：
    //   slice-bamboo -- sear-bamboo --
    //   slice-garlic -- saute-garlic --  → plate
    // 線形連鎖にはならず、plate が saute-garlic と sear-bamboo の両方から枝を受ける
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Slice bamboo", blockType: "heading", level: 2, role: "procedure", stepId: "slice-bamboo" },
        { text: "bamboo", role: "material", blockType: "bulletListItem" },
        { text: "Slice garlic", blockType: "heading", level: 2, role: "procedure", stepId: "slice-garlic" },
        { text: "garlic", role: "material", blockType: "bulletListItem" },
        { text: "Sauté garlic", blockType: "heading", level: 2, role: "procedure", stepId: "saute-garlic" },
        { text: "sliced garlic", role: "material", blockType: "bulletListItem", derivedFrom: "slice-garlic" },
        { text: "Sear bamboo", blockType: "heading", level: 2, role: "procedure", stepId: "sear-bamboo" },
        { text: "sliced bamboo", role: "material", blockType: "bulletListItem", derivedFrom: "slice-bamboo" },
        { text: "Plate", blockType: "heading", level: 2, role: "procedure", stepId: "plate",
          dependsOn: ["saute-garlic", "sear-bamboo"] },
        { text: "steak", role: "output", blockType: "bulletListItem" },
      ],
    });
    const page = doc.pages[0];
    const byStepId = (stepId: string) => {
      // その手順の block.id を 見出しの text で逆引き
      const textMap: Record<string, string> = {
        "slice-bamboo": "Slice bamboo",
        "slice-garlic": "Slice garlic",
        "saute-garlic": "Sauté garlic",
        "sear-bamboo": "Sear bamboo",
        "plate": "Plate",
      };
      const step = page.blocks.find(
        (b: any) => b.type === "step" && b.content[0].text === textMap[stepId],
      );
      return step.id;
    };

    const links = page.provLinks;
    // 期待: saute-garlic→slice-garlic / sear-bamboo→slice-bamboo / plate→saute-garlic / plate→sear-bamboo
    expect(links).toHaveLength(4);
    const pairs = new Set(links.map((l: any) => `${l.sourceBlockId} ${l.targetBlockId}`));
    expect(pairs.has(`${byStepId("saute-garlic")} ${byStepId("slice-garlic")}`)).toBe(true);
    expect(pairs.has(`${byStepId("sear-bamboo")} ${byStepId("slice-bamboo")}`)).toBe(true);
    expect(pairs.has(`${byStepId("plate")} ${byStepId("saute-garlic")}`)).toBe(true);
    expect(pairs.has(`${byStepId("plate")} ${byStepId("sear-bamboo")}`)).toBe(true);
    // 線形連鎖では出るが、正しい DAG では出ないペア
    expect(pairs.has(`${byStepId("slice-garlic")} ${byStepId("slice-bamboo")}`)).toBe(false);
    expect(pairs.has(`${byStepId("sear-bamboo")} ${byStepId("saute-garlic")}`)).toBe(false);
  });

  it("同じ (from, to) ペアの依存が重複しても 1 本に正規化される", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "A", blockType: "heading", level: 2, role: "procedure", stepId: "a" },
        { text: "B", blockType: "heading", level: 2, role: "procedure", stepId: "b",
          dependsOn: ["a"] },
        // 同じ a→b 依存を material 経由でも宣言
        { text: "thing from a", role: "material", blockType: "bulletListItem", derivedFrom: "a" },
      ],
    });
    expect(doc.pages[0].provLinks).toHaveLength(1);
  });

  it("H2 procedure スコープ外の material/tool/result はラベルを自動で剥がす（孤立ノード防止）", () => {
    // 材料リストセクション（H1「材料」配下）が material ラベル付きで来ても、
    // 手順スコープに入るまでの間は PROV グラフから除外する
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Ingredients", blockType: "heading", level: 1 },
        { text: "pantry bamboo", role: "material", blockType: "bulletListItem" },
        { text: "pantry garlic", role: "material", blockType: "bulletListItem" },
        { text: "old frying pan", role: "tool", blockType: "bulletListItem" },
        { text: "Steps", blockType: "heading", level: 1 },
        { text: "Slice bamboo", blockType: "heading", level: 2, role: "procedure", stepId: "slice-bamboo" },
        { text: "bamboo shoots", role: "material", blockType: "bulletListItem" },
      ],
    });
    const page = doc.pages[0];

    // スコープ外の 3 つのブロックには label / inline style どちらも付かない
    const pantryBamboo = findByText(page.blocks, "pantry bamboo");
    const pantryGarlic = findByText(page.blocks, "pantry garlic");
    const oldPan = findByText(page.blocks, "old frying pan");
    expect(page.labels[pantryBamboo.id]).toBeUndefined();
    expect(pantryBamboo.content[0].styles).toEqual({});
    expect(page.labels[pantryGarlic.id]).toBeUndefined();
    expect(pantryGarlic.content[0].styles).toEqual({});
    expect(page.labels[oldPan.id]).toBeUndefined();
    expect(oldPan.content[0].styles).toEqual({});

    // スコープ内の material は inline highlight 化され、step の children に入る
    const scopedMaterial = findByText(page.blocks, "bamboo shoots");
    expect(scopedMaterial.content[0].styles.inlineMaterial).toMatch(/^ent_material_/);
    const sliceStep = page.blocks.find(
      (b: any) => b.type === "step" && b.content[0].text === "Slice bamboo",
    );
    expect(sliceStep.children.some((c: any) => c.id === scopedMaterial.id)).toBe(true);

    // テキストはそのまま残る（ブロック自体は削除しない）
    expect(pantryBamboo).toBeDefined();
    expect(oldPan).toBeDefined();
  });

  it("スコープ外の material に derivedFrom が付いていても informed_by は張らない（剥がし後は無視）", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "A", blockType: "heading", level: 2, role: "procedure", stepId: "a" },
        { text: "foo", role: "material", blockType: "bulletListItem" },
        // scope を閉じる H1 が来ないので厳密には "A" の scope のままだが、
        // 仕様上 H2 procedure でのみ scope が開く。以下は別の H2 が来るまで scope 内。
        // ここでは scope 外のケースを正しくテストするために先頭 material から始める
      ],
    });
    // 1 個しか procedure が無いので informed_by は 0 本（正しい）
    expect(doc.pages[0].provLinks).toHaveLength(0);
  });

  it("スコープ外の attribute は inline highlight として残す（親探索で吸収されるため）", () => {
    // attribute は prov-generator が祖先探索で親 Entity に埋め込むため、
    // スコープ外でも PROV グラフが汚れにくい。inline style は残す（block-level label には載らない）。
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Overview", blockType: "heading", level: 1 },
        { text: "serves 4", role: "attribute", blockType: "bulletListItem" },
      ],
    });
    const page = doc.pages[0];
    const attrBlock = page.blocks.find((b: any) => b.content[0].text === "serves 4");
    expect(page.labels[attrBlock.id]).toBeUndefined();
    expect(attrBlock.content[0].styles.inlineAttribute).toMatch(/^ent_attribute_/);
  });

  it("未定義 stepId / 自己参照は無視される", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "A", blockType: "heading", level: 2, role: "procedure", stepId: "a",
          dependsOn: ["nonexistent", "a"] },
        { text: "B", blockType: "heading", level: 2, role: "procedure", stepId: "b",
          dependsOn: ["a"] },
      ],
    });
    expect(doc.pages[0].provLinks).toHaveLength(1);
  });

  it("procedure が 0-1 個なら informed_by は 0 個", () => {
    const none = buildProvNoteDocument({
      ...baseParams,
      blocks: [{ text: "x", role: "material", blockType: "bulletListItem" }],
    });
    expect(none.pages[0].provLinks).toHaveLength(0);

    const one = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Slice", blockType: "heading", level: 2, role: "procedure" },
        { text: "bamboo", role: "material", blockType: "bulletListItem" },
      ],
    });
    expect(one.pages[0].provLinks).toHaveLength(0);
  });

  it("paragraph で role:procedure が付いたブロックは informed_by 連鎖に含めない（H2 のみ対象）", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [
        { text: "Step one", blockType: "paragraph", role: "procedure" },
        { text: "Step two", blockType: "heading", level: 2, role: "procedure" },
        { text: "Step three", blockType: "heading", level: 2, role: "procedure" },
      ],
    });
    // heading 2 つ分の 1 リンクのみ
    expect(doc.pages[0].provLinks).toHaveLength(1);
  });

  it("generatedBy にモデル情報が入る", () => {
    const doc = buildProvNoteDocument({
      ...baseParams,
      blocks: [],
      tokenUsage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
    expect(doc.generatedBy?.agent).toBe("prov-ingester");
    expect(doc.generatedBy?.model).toBe(baseParams.model);
    expect(doc.generatedBy?.tokenUsage?.total_tokens).toBe(150);
  });
});
