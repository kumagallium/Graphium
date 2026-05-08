import { describe, it, expect } from "vitest";
import {
  parseProvIngesterOutput,
  buildProvIngesterSystemPrompt,
  buildProvIngesterUserMessage,
} from "./prov-ingester";

describe("parseProvIngesterOutput", () => {
  it("有効な JSON をパースして title + blocks を返す", () => {
    const raw = JSON.stringify({
      title: "Tomato Pasta",
      blocks: [
        { text: "Slice", blockType: "heading", level: 2, role: "procedure" },
        { text: "200g spaghetti", role: "material", blockType: "bulletListItem" },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.title).toBe("Tomato Pasta");
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[0]).toMatchObject({
      text: "Slice",
      role: "procedure",
      blockType: "heading",
      level: 2,
    });
  });

  it("children を再帰的にパースする（ネストした attribute）", () => {
    const raw = JSON.stringify({
      title: "Recipe",
      blocks: [
        {
          text: "bamboo shoots",
          role: "material",
          blockType: "bulletListItem",
          children: [
            { text: "sliced 1cm thick", role: "attribute", blockType: "bulletListItem" },
            { text: "boiled", role: "attribute", blockType: "bulletListItem" },
          ],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].children).toHaveLength(2);
    expect(out.blocks[0].children![0].role).toBe("attribute");
    expect(out.blocks[0].children![1].text).toBe("boiled");
  });

  it("深いネストでも MAX_DEPTH (4) まで保持し、超過は切り捨てる", () => {
    // 6 階層ネストを作る
    const deepest = { text: "d5", role: "attribute" as const, blockType: "bulletListItem" as const };
    const d4 = { text: "d4", role: "attribute" as const, blockType: "bulletListItem" as const, children: [deepest] };
    const d3 = { text: "d3", role: "attribute" as const, blockType: "bulletListItem" as const, children: [d4] };
    const d2 = { text: "d2", role: "attribute" as const, blockType: "bulletListItem" as const, children: [d3] };
    const d1 = { text: "d1", role: "material" as const, blockType: "bulletListItem" as const, children: [d2] };
    const raw = JSON.stringify({ title: "T", blocks: [d1] });

    const out = parseProvIngesterOutput(raw);
    // 深さ 4 (d1, d2, d3, d4) まで到達し、その先 (d5) は切り捨て
    let cursor: any = out.blocks[0];
    for (const expected of ["d1", "d2", "d3", "d4"]) {
      expect(cursor.text).toBe(expected);
      cursor = cursor.children?.[0];
    }
    // 4 階層目 (d4) には children が付いていないこと
    expect(cursor).toBeUndefined();
  });

  it("```json ... ``` でラップされた出力を解凍する", () => {
    const raw = '```json\n{"title":"T","blocks":[{"text":"x","blockType":"paragraph"}]}\n```';
    const out = parseProvIngesterOutput(raw);
    expect(out.title).toBe("T");
    expect(out.blocks).toHaveLength(1);
  });

  it("role が未定義の値なら落とす（undefined 扱い）", () => {
    const raw = JSON.stringify({
      title: "T",
      blocks: [{ text: "x", role: "ingredient", blockType: "paragraph" }],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].role).toBeUndefined();
    expect(out.blocks[0].text).toBe("x");
  });

  it("blockType が無効ならば paragraph にフォールバック", () => {
    const raw = JSON.stringify({
      title: "T",
      blocks: [{ text: "x", blockType: "quote" }],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].blockType).toBe("paragraph");
  });

  it("heading の level は 1-3、範囲外は 2 にフォールバック", () => {
    const raw = JSON.stringify({
      title: "T",
      blocks: [
        { text: "A", blockType: "heading", level: 2 },
        { text: "B", blockType: "heading", level: 7 },
        { text: "C", blockType: "heading" },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].level).toBe(2);
    expect(out.blocks[1].level).toBe(2);
    expect(out.blocks[2].level).toBe(2);
  });

  it("text が空のブロックは除外される（子階層でも同じ）", () => {
    const raw = JSON.stringify({
      title: "T",
      blocks: [
        { text: "", role: "material" },
        {
          text: "x",
          role: "material",
          children: [
            { text: "", role: "attribute" },
            { text: "valid", role: "attribute" },
          ],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0].children).toHaveLength(1);
    expect(out.blocks[0].children![0].text).toBe("valid");
  });

  it("不正な JSON は空の結果を返す（例外を投げない）", () => {
    const out = parseProvIngesterOutput("not json");
    expect(out.title).toBe("");
    expect(out.blocks).toEqual([]);
  });

  it("blocks が配列でない場合は空配列を返す", () => {
    const out = parseProvIngesterOutput(JSON.stringify({ title: "T", blocks: "oops" }));
    expect(out.blocks).toEqual([]);
  });

  it("Phase F: paragraph の content spans をパースして role / derivedFrom を保持する", () => {
    const raw = JSON.stringify({
      title: "Recipe",
      blocks: [
        {
          blockType: "paragraph",
          content: [
            { text: "Warm " },
            { text: "olive oil", role: "material" },
            { text: " with " },
            { text: "sliced garlic", role: "material", derivedFrom: "slice-garlic" },
            { text: " over " },
            { text: "low heat", role: "attribute" },
            { text: "." },
          ],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks).toHaveLength(1);
    const block = out.blocks[0];
    expect(block.text).toBeUndefined();
    expect(block.content).toHaveLength(7);
    expect(block.content![1]).toEqual({ text: "olive oil", role: "material" });
    expect(block.content![3]).toEqual({
      text: "sliced garlic",
      role: "material",
      derivedFrom: "slice-garlic",
    });
    expect(block.content![5]).toEqual({ text: "low heat", role: "attribute" });
    expect(block.content![6]).toEqual({ text: "." });
  });

  it("Phase F: span の不正な role / 空 text / span 上の procedure は落とす", () => {
    const raw = JSON.stringify({
      title: "T",
      blocks: [
        {
          blockType: "paragraph",
          content: [
            { text: "ok", role: "ingredient" },          // 不正 role → role 削除
            { text: "" },                                 // 空 → 落ちる
            { text: "bad procedure span", role: "procedure" }, // span 上の procedure → role 削除
            { text: "result alias", role: "result" },    // result → output に正規化
          ],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    const spans = out.blocks[0].content!;
    expect(spans).toHaveLength(3);
    expect(spans[0]).toEqual({ text: "ok" });
    expect(spans[1]).toEqual({ text: "bad procedure span" });
    expect(spans[2]).toEqual({ text: "result alias", role: "output" });
  });

  it("句読点・記号・空白のみの role 付き span は role を剥がしてプレーン span にする", () => {
    const raw = JSON.stringify({
      title: "T",
      blocks: [
        {
          blockType: "paragraph",
          content: [
            { text: "salt", role: "material" },
            { text: ", ", role: "material" },                      // 半角カンマ + 空白
            { text: "pepper", role: "material" },
            { text: "。", role: "attribute" },                     // 全角句点
            { text: " ", role: "tool" },                           // 空白のみ
            { text: "( ", role: "material", derivedFrom: "prep" }, // 記号のみ + derivedFrom も落ちる
            { text: "—", role: "output" },                         // em-dash
            { text: "real material", role: "material" },
          ],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    const spans = out.blocks[0].content!;
    expect(spans[0]).toEqual({ text: "salt", role: "material" });
    expect(spans[1]).toEqual({ text: ", " });
    expect(spans[2]).toEqual({ text: "pepper", role: "material" });
    expect(spans[3]).toEqual({ text: "。" });
    expect(spans[4]).toEqual({ text: " " });
    expect(spans[5]).toEqual({ text: "( " });   // role も derivedFrom も剥がれる
    expect(spans[6]).toEqual({ text: "—" });
    expect(spans[7]).toEqual({ text: "real material", role: "material" });
  });

  it("Phase F: heading は span を持たず flat text を保持する", () => {
    const raw = JSON.stringify({
      title: "T",
      blocks: [
        {
          blockType: "heading",
          level: 2,
          role: "procedure",
          stepId: "slice",
          text: "Slice",
          // ここに content が入っていても heading では無視されて text 採用
          content: [{ text: "should be ignored" }],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].text).toBe("Slice");
    expect(out.blocks[0].content).toBeUndefined();
  });

  it("stepId / derivedFrom / dependsOn を拾う", () => {
    const raw = JSON.stringify({
      title: "R",
      blocks: [
        { text: "A", blockType: "heading", level: 2, role: "procedure", stepId: "slice-bamboo" },
        { text: "B", blockType: "heading", level: 2, role: "procedure", stepId: "sear-bamboo",
          dependsOn: ["slice-bamboo"] },
        { text: "sliced bamboo", blockType: "bulletListItem", role: "material",
          derivedFrom: "slice-bamboo" },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].stepId).toBe("slice-bamboo");
    expect(out.blocks[1].stepId).toBe("sear-bamboo");
    expect(out.blocks[1].dependsOn).toEqual(["slice-bamboo"]);
    expect(out.blocks[2].derivedFrom).toBe("slice-bamboo");
  });

  it("stepId の regex を満たさない値は破棄される", () => {
    const raw = JSON.stringify({
      title: "R",
      blocks: [
        { text: "A", blockType: "heading", level: 2, role: "procedure", stepId: "Step 1 !" },
        { text: "x", blockType: "bulletListItem", role: "material", derivedFrom: "BAD ID" },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].stepId).toBeUndefined();
    expect(out.blocks[1].derivedFrom).toBeUndefined();
  });

  it("stepId は小文字化される（大文字混在の揺れを吸収）", () => {
    const raw = JSON.stringify({
      title: "R",
      blocks: [
        { text: "A", blockType: "heading", level: 2, role: "procedure", stepId: "Slice-Bamboo" },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].stepId).toBe("slice-bamboo");
  });

  it("dependsOn に含まれる不正な値は除外され、有効な値だけ残る", () => {
    const raw = JSON.stringify({
      title: "R",
      blocks: [
        { text: "A", blockType: "heading", level: 2, role: "procedure", stepId: "b",
          dependsOn: ["good-id", 123, "  ", "BAD ID", "also-good"] },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].dependsOn).toEqual(["good-id", "also-good"]);
  });
});

describe("buildProvIngesterSystemPrompt", () => {
  it("英語/日本語どちらの言語でも core role キーが含まれる", () => {
    const en = buildProvIngesterSystemPrompt("en");
    const ja = buildProvIngesterSystemPrompt("ja");
    for (const role of ["material", "procedure", "tool", "attribute", "output"]) {
      expect(en).toContain(role);
      expect(ja).toContain(role);
    }
  });

  it("階層構造の規則（H2 procedure・children attribute）を説明する", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    expect(prompt).toContain("H2");
    expect(prompt).toContain("procedure");
    expect(prompt).toContain("children");
    expect(prompt).toContain("attribute");
  });

  it("材料リストの扱い（ラベルを付けない）が明示されている", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    // 「up-front の材料リストには role を付けない」という指示があるか
    expect(prompt.toLowerCase()).toContain("ingredients");
    expect(prompt).toContain("WITHOUT any");
    expect(prompt).toContain("orphan");
  });

  it("依存判定のネガティブ例（同じ道具の共有 ≠ 依存）が明示されている", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    expect(prompt).toContain("Sharing a tool is NOT a dependency");
    expect(prompt).toContain("Textual adjacency is NOT a dependency");
  });

  it("料理以外のドメイン（実験プロトコル）にも適用できるよう汎用化されている", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    // 料理特化の表現が残っていないこと
    expect(prompt).toContain("laboratory protocol");
    expect(prompt).toContain("manufacturing");
    // 実験用語が role 定義に併記されている
    expect(prompt).toContain("reagent");
    expect(prompt).toContain("potentiostat");
    // 実験プロトコルの worked example が含まれる
    expect(prompt).toContain("cyclic voltammetry");
    expect(prompt).toContain("MnO2");
  });

  it("ソース構造をミラーする方針が指示されている（固定 4 H1 を強制しない）", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    expect(prompt).toContain("Mirror the source");
    expect(prompt).toContain("Do NOT impose a fixed template");
    // 必須要素は intro paragraph + H2 procedure + terminal step の output span
    expect(prompt).toContain("intro paragraph");
    expect(prompt).toContain("terminal step");
  });

  it("各 H2 step に散文 paragraph + inline span を要求する規則が含まれる", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    expect(prompt).toContain("one or two prose paragraphs");
    expect(prompt).toContain("inline spans with role");
    expect(prompt).toContain("Do NOT use bulletListItem to list them");
  });
});

describe("buildProvIngesterUserMessage", () => {
  it("URL・タイトル・本文が含まれる", () => {
    const msg = buildProvIngesterUserMessage({
      url: "https://example.com/recipe",
      title: "Example",
      description: "A recipe",
      text: "body text",
    });
    expect(msg).toContain("https://example.com/recipe");
    expect(msg).toContain("Example");
    expect(msg).toContain("body text");
  });
});
