// wiki-topic-writer の Tier 1 unit test（LLM 呼び出しなし）
//
// parseTopicWriterOutput の堅牢さ（壊れた JSON / コードフェンス付き / 途中切断）を
// wiki-ingester.parseIngesterOutput と同じ方針（無理な復旧はせず undefined を返す）で検証する。

import { describe, it, expect } from "vitest";
import {
  buildTopicWriterSystemPrompt,
  buildTopicWriterUserMessage,
  parseTopicWriterOutput,
  buildTopicNamerSystemPrompt,
  buildTopicNamerUserMessage,
  parseTopicNamerOutput,
  buildTopicConsolidatorSystemPrompt,
  buildTopicConsolidatorUserMessage,
  parseTopicConsolidatorOutput,
  buildTopicRouterSystemPrompt,
  buildTopicRouterUserMessage,
  parseTopicRouterOutput,
  buildSourceTopicReviserSystemPrompt,
  buildSourceTopicReviserUserMessage,
  parseSourceTopicReviserOutput,
  buildTopicMergerSystemPrompt,
  buildTopicMergerUserMessage,
  parseTopicMergerOutput,
} from "./wiki-topic-writer.ts";

describe("parseTopicWriterOutput", () => {
  it("素の JSON から body を取り出す", () => {
    const text = JSON.stringify({ body: "## 定義\n本文です。" });
    expect(parseTopicWriterOutput(text)).toEqual({ body: "## 定義\n本文です。" });
  });

  it("```json コードフェンス付きでもパースできる", () => {
    const text = "```json\n" + JSON.stringify({ body: "## 定義\n本文。" }) + "\n```";
    expect(parseTopicWriterOutput(text)).toEqual({ body: "## 定義\n本文。" });
  });

  it("前後の空白・改行を trim する", () => {
    const text = JSON.stringify({ body: "  ## 定義\n本文。  " });
    expect(parseTopicWriterOutput(text)?.body).toBe("## 定義\n本文。");
  });

  it("壊れた JSON（途中切断）は undefined を返す", () => {
    const truncated = '{"body": "## 定義\\n本文の途中で切れ';
    expect(parseTopicWriterOutput(truncated)).toBeUndefined();
  });

  it("body フィールドが無ければ undefined", () => {
    expect(parseTopicWriterOutput(JSON.stringify({ notBody: "x" }))).toBeUndefined();
  });

  it("body が空文字なら undefined（空ページを保存させない）", () => {
    expect(parseTopicWriterOutput(JSON.stringify({ body: "   " }))).toBeUndefined();
  });

  it("完全に JSON でないテキストは undefined（推測復旧はしない）", () => {
    expect(parseTopicWriterOutput("Sure, here's the topic page:\n## 定義\n本文")).toBeUndefined();
  });

  it("body が文字列でなければ undefined", () => {
    expect(parseTopicWriterOutput(JSON.stringify({ body: 123 }))).toBeUndefined();
  });
});

describe("buildTopicWriterUserMessage", () => {
  it("タイトルとメンバー知見（id / title / body）を含む", () => {
    const msg = buildTopicWriterUserMessage("話題タイトル", [
      { id: "claim-1", title: "知見A", body: "知見Aの本文" },
      { id: "claim-2", title: "知見B", body: "知見Bの本文" },
    ]);
    expect(msg).toContain("話題タイトル");
    expect(msg).toContain("知見A");
    expect(msg).toContain("claim-1");
    expect(msg).toContain("知見Bの本文");
  });
});

describe("buildTopicWriterSystemPrompt", () => {
  it("References セクションを自分では作らないよう指示する", () => {
    const prompt = buildTopicWriterSystemPrompt("ja");
    expect(prompt).toMatch(/References/);
  });

  it("言語指定が出力言語に反映される", () => {
    expect(buildTopicWriterSystemPrompt("ja")).toContain("Japanese");
    expect(buildTopicWriterSystemPrompt("en")).toContain("English");
  });

  it("引用はタイトルの転記ではなく id で書かせる（[[claim:<id>]] 形式）", () => {
    const prompt = buildTopicWriterSystemPrompt("ja");
    expect(prompt).toContain("[[claim:");
    expect(prompt).not.toContain("[[Claim title]]");
  });
});

describe("parseTopicNamerOutput", () => {
  it("claimId → topics のマップをパースする", () => {
    const text = JSON.stringify({ topics: { "claim-1": ["A", "B"], "claim-2": ["C"] } });
    expect(parseTopicNamerOutput(text)).toEqual({ "claim-1": ["A", "B"], "claim-2": ["C"] });
  });

  it("```json コードフェンス付きでもパースできる", () => {
    const text = "```json\n" + JSON.stringify({ topics: { "claim-1": ["A"] } }) + "\n```";
    expect(parseTopicNamerOutput(text)).toEqual({ "claim-1": ["A"] });
  });

  it("各エントリは parseTopics と同じルールでサニタイズされる（非文字列・空・重複を落とす。件数上限は無い）", () => {
    const text = JSON.stringify({
      topics: {
        "claim-1": ["A", "", "a", 123, "B", "C", "D"],
      },
    });
    // "a" は "A" の正規化重複として落ちる。それ以外は件数を切り詰めずに残す。
    expect(parseTopicNamerOutput(text)).toEqual({ "claim-1": ["A", "B", "C", "D"] });
  });

  it("トピックが 0 件になった claim は結果に含めない", () => {
    const text = JSON.stringify({ topics: { "claim-1": [], "claim-2": ["  ", 1, null] } });
    expect(parseTopicNamerOutput(text)).toEqual({});
  });

  it("topics フィールドが無ければ undefined", () => {
    expect(parseTopicNamerOutput(JSON.stringify({ notTopics: {} }))).toBeUndefined();
  });

  it("壊れた JSON（途中切断）は undefined を返す", () => {
    const truncated = '{"topics": {"claim-1": ["A"';
    expect(parseTopicNamerOutput(truncated)).toBeUndefined();
  });

  it("topics が配列や文字列など object でない場合は undefined", () => {
    expect(parseTopicNamerOutput(JSON.stringify({ topics: ["A", "B"] }))).toBeUndefined();
    expect(parseTopicNamerOutput(JSON.stringify({ topics: "A" }))).toBeUndefined();
  });
});

describe("buildTopicNamerUserMessage", () => {
  it("既存話題一覧と claim の id / title / body を含む", () => {
    const msg = buildTopicNamerUserMessage(["既存話題A"], [
      { id: "claim-1", title: "知見A", body: "知見Aの本文" },
    ]);
    expect(msg).toContain("既存話題A");
    expect(msg).toContain("知見A");
    expect(msg).toContain("claim-1");
    expect(msg).toContain("知見Aの本文");
  });

  it("既存話題が無ければ (none yet) と表示する", () => {
    const msg = buildTopicNamerUserMessage([], [{ id: "c1", title: "T", body: "B" }]);
    expect(msg).toContain("(none yet)");
  });
});

describe("buildTopicNamerSystemPrompt", () => {
  it("言語指定が出力言語に反映される", () => {
    expect(buildTopicNamerSystemPrompt("ja")).toContain("Japanese");
    expect(buildTopicNamerSystemPrompt("en")).toContain("English");
  });

  it("本文を書かず話題名のみを命名する指示を含む", () => {
    const prompt = buildTopicNamerSystemPrompt("en");
    expect(prompt).toMatch(/do not write any page body/i);
  });
});

describe("parseTopicConsolidatorOutput", () => {
  it("提案名 → 正式名 の対応表をパースする", () => {
    const text = JSON.stringify({ mapping: { "AI3V 格子熱伝導率": "AI3V格子熱伝導率", "AI3V格子熱伝導率": "AI3V格子熱伝導率" } });
    expect(parseTopicConsolidatorOutput(text)).toEqual({
      "AI3V 格子熱伝導率": "AI3V格子熱伝導率",
      "AI3V格子熱伝導率": "AI3V格子熱伝導率",
    });
  });

  it("```json コードフェンス付きでもパースできる", () => {
    const text = "```json\n" + JSON.stringify({ mapping: { A: "A" } }) + "\n```";
    expect(parseTopicConsolidatorOutput(text)).toEqual({ A: "A" });
  });

  it("非文字列・空文字のエントリは落とす", () => {
    const text = JSON.stringify({ mapping: { A: "A", B: 123, "": "X", C: "" } });
    expect(parseTopicConsolidatorOutput(text)).toEqual({ A: "A" });
  });

  it("mapping フィールドが無ければ undefined", () => {
    expect(parseTopicConsolidatorOutput(JSON.stringify({ notMapping: {} }))).toBeUndefined();
  });

  it("壊れた JSON（途中切断）は undefined を返す", () => {
    const truncated = '{"mapping": {"A": "A"';
    expect(parseTopicConsolidatorOutput(truncated)).toBeUndefined();
  });
});

describe("buildTopicConsolidatorUserMessage", () => {
  it("既存話題を「タイトル: 定義の先頭文」形式で列挙する", () => {
    const msg = buildTopicConsolidatorUserMessage(
      [{ id: "t1", title: "話題A", oneLiner: "話題Aの定義。" }],
      ["話題A", "話題A "],
    );
    expect(msg).toContain("話題A: 話題Aの定義。");
    expect(msg).toContain("Proposed topic names (2)");
  });

  it("oneLiner が無ければタイトルのみ", () => {
    const msg = buildTopicConsolidatorUserMessage([{ id: "t1", title: "話題A" }], ["話題A"]);
    expect(msg).toContain("- 話題A\n");
  });

  it("既存話題が無ければ (none yet)", () => {
    const msg = buildTopicConsolidatorUserMessage([], ["話題A"]);
    expect(msg).toContain("(none yet)");
  });
});

describe("buildTopicConsolidatorSystemPrompt", () => {
  it("言語指定が出力言語に反映される", () => {
    expect(buildTopicConsolidatorSystemPrompt("ja")).toContain("Japanese");
    expect(buildTopicConsolidatorSystemPrompt("en")).toContain("English");
  });

  it("件数の上限に関する数値を含まない（Karpathy 方針: 数値しきい値を置かない）", () => {
    const prompt = buildTopicConsolidatorSystemPrompt("en");
    expect(prompt).not.toMatch(/\d+-\d+\s*claims?/i);
  });
});

describe("parseTopicRouterOutput", () => {
  it("update / create の配列を取り出す", () => {
    const text = JSON.stringify({ update: ["t1", "t2"], create: ["新トピック"] });
    expect(parseTopicRouterOutput(text)).toEqual({ update: ["t1", "t2"], create: ["新トピック"] });
  });

  it("フィールドが欠けていれば空配列で埋める", () => {
    expect(parseTopicRouterOutput(JSON.stringify({}))).toEqual({ update: [], create: [] });
  });

  it("非文字列・空文字を落とす", () => {
    const text = JSON.stringify({ update: ["t1", "", 123, null], create: ["ok", ""] });
    expect(parseTopicRouterOutput(text)).toEqual({ update: ["t1"], create: ["ok"] });
  });

  it("コードフェンス付きでもパースできる", () => {
    const text = "```json\n" + JSON.stringify({ update: [], create: ["x"] }) + "\n```";
    expect(parseTopicRouterOutput(text)).toEqual({ update: [], create: ["x"] });
  });

  it("壊れた JSON は undefined", () => {
    expect(parseTopicRouterOutput("{not json")).toBeUndefined();
  });
});

describe("buildTopicRouterUserMessage / buildTopicRouterSystemPrompt", () => {
  it("既存トピックを id 付きで列挙する", () => {
    const msg = buildTopicRouterUserMessage(
      { id: "note-1", title: "資料タイトル", text: "本文" },
      [{ id: "t1", title: "話題A", oneLiner: "話題Aの定義。" }],
    );
    expect(msg).toContain("話題A (id: t1): 話題Aの定義。");
    expect(msg).toContain("id: note-1");
  });

  it("既存トピックが無ければ (none yet)", () => {
    const msg = buildTopicRouterUserMessage({ id: "s1", title: "t", text: "x" }, []);
    expect(msg).toContain("(none yet)");
  });

  it("件数の上限・しきい値の数値を置かない", () => {
    const prompt = buildTopicRouterSystemPrompt("en");
    expect(prompt).not.toMatch(/\d+\s*(topics?|concepts?)\b/i);
  });
});

describe("parseSourceTopicReviserOutput", () => {
  it("素の JSON から body を取り出す", () => {
    const text = JSON.stringify({ body: "## 定義\n本文。" });
    expect(parseSourceTopicReviserOutput(text)).toEqual({ body: "## 定義\n本文。" });
  });

  it("コードフェンス付きでもパースできる", () => {
    const text = "```json\n" + JSON.stringify({ body: "本文" }) + "\n```";
    expect(parseSourceTopicReviserOutput(text)).toEqual({ body: "本文" });
  });

  it("空本文・壊れた JSON は undefined", () => {
    expect(parseSourceTopicReviserOutput(JSON.stringify({ body: "" }))).toBeUndefined();
    expect(parseSourceTopicReviserOutput("{not json")).toBeUndefined();
  });
});

describe("buildSourceTopicReviserUserMessage", () => {
  it("現在の本文が空なら「1 件目」の注記を出す", () => {
    const msg = buildSourceTopicReviserUserMessage("トピック", "", { id: "s1", title: "資料", text: "本文" });
    expect(msg).toContain("empty — this is the first source");
  });

  it("現在の本文があればそのまま渡す", () => {
    const msg = buildSourceTopicReviserUserMessage("トピック", "## 定義\n既存の本文", { id: "s1", title: "資料", text: "本文" });
    expect(msg).toContain("## 定義\n既存の本文");
    expect(msg).toContain("id: s1");
  });
});

describe("buildSourceTopicReviserSystemPrompt", () => {
  it("[[source:<id>]] 引用形式を明記する", () => {
    expect(buildSourceTopicReviserSystemPrompt("en")).toContain("[[source:<id>]]");
  });

  it("上限を置かないルールが含まれる（Karpathy 方針）", () => {
    const prompt = buildSourceTopicReviserSystemPrompt("en");
    expect(prompt).toMatch(/No arbitrary limits/i);
  });

  it("推量の強さを保持するルールが含まれる", () => {
    const prompt = buildSourceTopicReviserSystemPrompt("ja");
    expect(prompt).toMatch(/hedg/i);
  });
});

describe("parseTopicMergerOutput", () => {
  it("素の JSON から body を取り出す", () => {
    const text = JSON.stringify({ body: "## 定義\n統合後の本文。" });
    expect(parseTopicMergerOutput(text)).toEqual({ body: "## 定義\n統合後の本文。" });
  });

  it("コードフェンス付きでもパースできる", () => {
    const text = "```json\n" + JSON.stringify({ body: "本文" }) + "\n```";
    expect(parseTopicMergerOutput(text)).toEqual({ body: "本文" });
  });

  it("空本文・壊れた JSON は undefined", () => {
    expect(parseTopicMergerOutput(JSON.stringify({ body: "" }))).toBeUndefined();
    expect(parseTopicMergerOutput("{not json")).toBeUndefined();
  });
});

describe("buildTopicMergerUserMessage", () => {
  it("渡した本文をすべて含める", () => {
    const msg = buildTopicMergerUserMessage("トピック", ["本文1 [[source:s1]]", "本文2 [[source:s2]]"]);
    expect(msg).toContain("本文1 [[source:s1]]");
    expect(msg).toContain("本文2 [[source:s2]]");
    expect(msg).toContain("トピック");
  });
});

describe("buildTopicMergerSystemPrompt", () => {
  it("引用を書き換えない・落とさないことを明記する", () => {
    const prompt = buildTopicMergerSystemPrompt("en");
    expect(prompt).toMatch(/never invent, drop, or rewrite/i);
    expect(prompt).toContain("[[source:<id>]]");
  });

  it("食い違いは統合せず両論併記するルールが含まれる", () => {
    const prompt = buildTopicMergerSystemPrompt("en");
    expect(prompt).toMatch(/keep both sentences/i);
  });

  it("文の決まり（sentence discipline）を共有する", () => {
    const prompt = buildTopicMergerSystemPrompt("ja");
    expect(prompt).toMatch(/Sentence discipline/i);
  });
});
