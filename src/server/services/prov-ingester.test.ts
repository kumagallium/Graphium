import { describe, it, expect } from "vitest";
import {
  parseProvIngesterOutput,
  buildProvIngesterSystemPrompt,
  buildProvIngesterUserMessage,
  hasHeadingLanguageMismatch,
  stripParameterFromStepName,
  findMergedParallelSteps,
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

  it("クォート無しキーの壊れた JSON を jsonrepair で修復してパースする", () => {
    // gpt-oss-120b が長い出力で実際に起こすパターン
    // （"Expected double-quoted property name" で JSON.parse が落ちる）
    const raw = `{
      "title": "RuAl2 試料の作製",
      "blocks": [
        { "text": "秤量", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "weighing" },
        { blockType: "paragraph", content: [ { text: "Ru を秤量する", role: "material" } ] }
      ]
    }`;
    const out = parseProvIngesterOutput(raw);
    expect(out.title).toBe("RuAl2 試料の作製");
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[1].content?.[0]).toMatchObject({
      text: "Ru を秤量する",
      role: "material",
    });
  });

  it("トレーリングカンマ入りの壊れた JSON も修復してパースする", () => {
    const raw = '{"title":"T","blocks":[{"text":"x","blockType":"paragraph"},],}';
    const out = parseProvIngesterOutput(raw);
    expect(out.title).toBe("T");
    expect(out.blocks).toHaveLength(1);
  });

  it("修復不能な非 JSON 出力は空 blocks を返す", () => {
    const out = parseProvIngesterOutput(
      "Sorry, I could not build a structure for this document.",
    );
    expect(out.title).toBe("");
    expect(out.blocks).toHaveLength(0);
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

describe("hasHeadingLanguageMismatch", () => {
  const h = (text: string) => ({ text, blockType: "heading" as const, level: 2 as const });
  const p = (text: string) => ({ blockType: "paragraph" as const, content: [{ text }] });

  it("ja 指定で見出しが英語ばかりなら true（gpt-oss の実挙動パターン）", () => {
    const blocks = [
      h("Weighing"),
      p("Ru を秤量する"),
      h("Arc melting"),
      p("Ar 雰囲気下でアーク溶解する"),
      h("Melt spinning"),
    ];
    expect(hasHeadingLanguageMismatch("ja", blocks)).toBe(true);
  });

  it("ja 指定で見出しが日本語なら false", () => {
    const blocks = [h("秤量"), p("Ru を秤量する"), h("アーク溶解"), h("X線回折測定")];
    expect(hasHeadingLanguageMismatch("ja", blocks)).toBe(false);
  });

  it("日本語が過半の混在（実測 0.78 相当）は false", () => {
    const blocks = [h("概要"), h("秤量"), h("アーク溶解"), h("Melt-Spinning")];
    expect(hasHeadingLanguageMismatch("ja", blocks)).toBe(false);
  });

  it("見出しが 1 個以下なら判定材料不足として false", () => {
    expect(hasHeadingLanguageMismatch("ja", [h("Overview"), p("本文")])).toBe(false);
    expect(hasHeadingLanguageMismatch("ja", [p("本文だけ")])).toBe(false);
  });

  it("ja 以外の言語指定では常に false", () => {
    const blocks = [h("Weighing"), h("Arc melting"), h("Melt spinning")];
    expect(hasHeadingLanguageMismatch("en", blocks)).toBe(false);
  });

  it("children 内の見出しも判定対象に含める", () => {
    const blocks = [
      { ...h("Weighing"), children: [h("Sub step"), h("Another sub")] },
      p("本文"),
    ];
    expect(hasHeadingLanguageMismatch("ja", blocks)).toBe(true);
  });
});

describe("stripParameterFromStepName", () => {
  it("末尾のパラメータ値を落とす", () => {
    expect(stripParameterFromStepName("Ball milling 1h")).toBe("Ball milling");
    expect(stripParameterFromStepName("Ball milling 0 h")).toBe("Ball milling");
    expect(stripParameterFromStepName("Hot pressing (823 K)")).toBe("Hot pressing");
    expect(stripParameterFromStepName("Annealing （48 h）")).toBe("Annealing");
    expect(stripParameterFromStepName("Milling at 300 rpm")).toBe("Milling");
    expect(stripParameterFromStepName("ボールミリング 3h")).toBe("ボールミリング");
    expect(stripParameterFromStepName("焼結 1273K")).toBe("焼結");
  });

  it("単位の無い数字・名前の一部は落とさない", () => {
    expect(stripParameterFromStepName("Milling")).toBe("Milling");
    expect(stripParameterFromStepName("Phase 2")).toBe("Phase 2");
    expect(stripParameterFromStepName("Spark plasma sintering")).toBe("Spark plasma sintering");
  });

  it("剥がすと名前が消える場合は元のまま返す", () => {
    expect(stripParameterFromStepName("1h")).toBe("1h");
    expect(stripParameterFromStepName("300 rpm")).toBe("300 rpm");
  });
});

describe("パラメータを含む手順見出しのサニタイズ", () => {
  it("procedure 見出しからはパラメータを落とし、同名の重複はそのまま残す", () => {
    const raw = JSON.stringify({
      title: "CuGaTe2",
      blocks: [
        { text: "Ball milling 0h", blockType: "heading", level: 2, role: "procedure", stepId: "bm-0h" },
        { text: "Ball milling 1h", blockType: "heading", level: 2, role: "procedure", stepId: "bm-1h" },
        { text: "結果 3h", blockType: "heading", level: 1 },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].text).toBe("Ball milling");
    expect(out.blocks[1].text).toBe("Ball milling");
    // procedure でない見出しは触らない
    expect(out.blocks[2].text).toBe("結果 3h");
  });

  it("material span の名前はパラメータを保つ（同名統合で分岐が潰れるため）", () => {
    const raw = JSON.stringify({
      title: "x",
      blocks: [
        {
          blockType: "paragraph",
          content: [{ text: "1h ボールミールド粉末", role: "material" }],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].content?.[0].text).toBe("1h ボールミールド粉末");
  });
});

describe("attribute span の attachTo", () => {
  it("attribute には activity 指定を通す", () => {
    const raw = JSON.stringify({
      title: "x",
      blocks: [
        {
          blockType: "paragraph",
          content: [
            { text: "rpm: 300", role: "attribute", attachTo: "activity" },
            { text: "purity: 99.999%", role: "attribute" },
          ],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].content?.[0].attachTo).toBe("activity");
    expect(out.blocks[0].content?.[1].attachTo).toBeUndefined();
  });

  it("attribute 以外・不正値の attachTo は捨てる", () => {
    const raw = JSON.stringify({
      title: "x",
      blocks: [
        {
          blockType: "paragraph",
          content: [
            { text: "ボールミル", role: "tool", attachTo: "activity" },
            { text: "time: 1 h", role: "attribute", attachTo: "step" },
          ],
        },
      ],
    });
    const out = parseProvIngesterOutput(raw);
    expect(out.blocks[0].content?.[0].attachTo).toBeUndefined();
    expect(out.blocks[0].content?.[1].attachTo).toBeUndefined();
  });
});

describe("buildProvIngesterSystemPrompt — 手順名と語彙", () => {
  it("見出しにパラメータを入れない規則と、同名重複の許容を説明する", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    expect(prompt).toContain("Step headings carry no parameter values");
    expect(prompt).toContain("Repeated headings are expected and correct");
    expect(prompt).toContain('"Ball milling 1h"');
  });

  it("工程条件を Activity に束ねる指定を説明する", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    expect(prompt).toContain("Where an attribute attaches");
    expect(prompt).toContain('"attachTo": "activity"');
  });

  it("語彙を渡すとセクションが載り、渡さなければ載らない", () => {
    const without = buildProvIngesterSystemPrompt("en");
    expect(without).not.toContain("(reuse before inventing)");

    const withVocab = buildProvIngesterSystemPrompt("en", {
      tool: ["プラネタリーボールミル", "グラファイトダイ"],
      attributeKey: ["rpm", "temperature"],
    });
    expect(withVocab).toContain("(reuse before inventing)");
    expect(withVocab).toContain("プラネタリーボールミル");
    expect(withVocab).toContain("rpm");
  });

  it("語彙が空なら空セクションを出さない", () => {
    const prompt = buildProvIngesterSystemPrompt("en", { tool: [], step: [] });
    expect(prompt).not.toContain("(reuse before inventing)");
  });

  it("語彙が多くても文字数上限で打ち切る", () => {
    const many = Array.from({ length: 400 }, (_, i) => `material-name-${i}`);
    const prompt = buildProvIngesterSystemPrompt("en", { material: many });
    const base = buildProvIngesterSystemPrompt("en").length;
    expect(prompt.length - base).toBeLessThan(5500);
  });
});

describe("findMergedParallelSteps", () => {
  const step = (name: string, id: string) => ({
    text: name,
    blockType: "heading" as const,
    level: 2 as const,
    role: "procedure" as const,
    stepId: id,
  });
  const para = (attrs: string[]) => ({
    blockType: "paragraph" as const,
    content: attrs.map((text) => ({ text, role: "attribute" as const })),
  });

  it("同じキーに複数の値がある手順を畳み込みとして検出する", () => {
    const merged = findMergedParallelSteps([
      step("ボールミリング", "bm"),
      para(["rpm: 300", "time: 1 h", "rpm: 300", "time: 3 h"]),
    ]);
    expect(merged).toEqual(["ボールミリング"]);
  });

  it("同名の手順が分かれていれば検出しない", () => {
    const merged = findMergedParallelSteps([
      step("ボールミリング", "bm-1h"),
      para(["rpm: 300", "time: 1 h"]),
      step("ボールミリング", "bm-3h"),
      para(["rpm: 300", "time: 3 h"]),
    ]);
    expect(merged).toEqual([]);
  });

  it("同じキーで同じ値の重複は畳み込みではない", () => {
    const merged = findMergedParallelSteps([
      step("焼結", "s"),
      para(["temperature: 823 K", "temperature: 823K"]),
    ]);
    expect(merged).toEqual([]);
  });

  it("キーを持たない属性・手順の外の属性は数えない", () => {
    const merged = findMergedParallelSteps([
      { text: "材料", blockType: "heading", level: 1 },
      para(["time: 1 h", "time: 3 h"]),
      step("粉砕", "c"),
      para(["粗く", "細かく"]),
    ]);
    expect(merged).toEqual([]);
  });

  it("畳まれた手順が複数あればすべて返す", () => {
    const merged = findMergedParallelSteps([
      step("ボールミリング", "bm"),
      para(["time: 1 h", "time: 3 h"]),
      step("熱圧成形", "hp"),
      para(["temperature: 823 K", "temperature: 923 K"]),
    ]);
    expect(merged).toEqual(["ボールミリング", "熱圧成形"]);
  });
});

describe("buildProvIngesterSystemPrompt — 並列試料", () => {
  it("1 run = 1 step と分岐・合流の例が含まれる", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    expect(prompt).toContain("One run = one step");
    expect(prompt).toContain("parallel branches");
    expect(prompt).toContain("ball-milling-0h");
    expect(prompt).toContain("converge");
  });

  it("手順数の上限が試料ぶんの増加を禁じないことを明示する", () => {
    const prompt = buildProvIngesterSystemPrompt("en");
    expect(prompt).toContain("3 operations × 3 samples = 9 steps");
  });
});
