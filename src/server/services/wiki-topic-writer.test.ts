// wiki-topic-writer の Tier 1 unit test（LLM 呼び出しなし）
//
// 各パーサーの堅牢さ（壊れた JSON / コードフェンス付き / 途中切断）を
// wiki-ingester.parseIngesterOutput と同じ方針（無理な復旧はせず undefined を返す）で検証する。
// Topic Writer / Topic Namer（知見からトピックを作る旧形式）は撤去済み。

import { describe, it, expect } from "vitest";
import {
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
  buildSourceSurveySystemPrompt,
  buildSourceSurveyUserMessage,
  parseSourceSurveyOutput,
  buildWindowTextWithSurvey,
} from "./wiki-topic-writer.ts";

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

  it("previouslyCited が true なら既存引用の再確認を指示する文を追加する", () => {
    const msg = buildSourceTopicReviserUserMessage(
      "トピック", "## 定義\n既存の本文[[source:s1]]", { id: "s1", title: "資料", text: "更新後の本文" }, true,
    );
    expect(msg).toContain("already cited on this page as [[source:s1]]");
    expect(msg).toContain("keep it only if the new text still supports it");
  });

  it("previouslyCited を渡さなければ再確認の指示は追加しない", () => {
    const msg = buildSourceTopicReviserUserMessage("トピック", "## 定義\n既存の本文", { id: "s1", title: "資料", text: "本文" });
    expect(msg).not.toContain("already cited on this page");
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

describe("parseSourceSurveyOutput", () => {
  it("素の JSON から survey を取り出す", () => {
    const text = JSON.stringify({ survey: "この文書は...の論文である。" });
    expect(parseSourceSurveyOutput(text)).toEqual({ survey: "この文書は...の論文である。" });
  });

  it("コードフェンス付きでもパースできる", () => {
    const text = "```json\n" + JSON.stringify({ survey: "見取り図" }) + "\n```";
    expect(parseSourceSurveyOutput(text)).toEqual({ survey: "見取り図" });
  });

  it("空文字・壊れた JSON は undefined", () => {
    expect(parseSourceSurveyOutput(JSON.stringify({ survey: "" }))).toBeUndefined();
    expect(parseSourceSurveyOutput("{not json")).toBeUndefined();
  });
});

describe("buildSourceSurveySystemPrompt", () => {
  it("結果・結論を書かないことを明記する", () => {
    const prompt = buildSourceSurveySystemPrompt("en");
    expect(prompt).toMatch(/Do NOT include results or conclusions/i);
  });

  it("推測しないことを明記する", () => {
    const prompt = buildSourceSurveySystemPrompt("en");
    expect(prompt).toMatch(/Do not guess what the rest of the document might say/i);
  });

  it("言語指定が出力言語に反映される", () => {
    expect(buildSourceSurveySystemPrompt("ja")).toContain("Japanese");
    expect(buildSourceSurveySystemPrompt("en")).toContain("English");
  });

  it("8 行以内の上限を明記する", () => {
    const prompt = buildSourceSurveySystemPrompt("en");
    expect(prompt).toMatch(/8 lines or fewer/i);
  });
});

describe("buildSourceSurveyUserMessage", () => {
  it("タイトルと冒頭の窓本文のみを渡す（全文ではない旨も明記）", () => {
    const msg = buildSourceSurveyUserMessage("資料タイトル", "冒頭の窓本文");
    expect(msg).toContain("資料タイトル");
    expect(msg).toContain("冒頭の窓本文");
    expect(msg).toContain("first window only");
  });
});

describe("buildWindowTextWithSurvey", () => {
  it("日本語のとき「見取り図」「本文の抜粋」の見出しを付ける", () => {
    const text = buildWindowTextWithSurvey("見取り図の中身", 1, 4, "窓の本文", "ja");
    expect(text).toContain("資料の見取り図");
    expect(text).toContain("見取り図の中身");
    expect(text).toContain("全 4 枚中 2 枚目");
    expect(text).toContain("窓の本文");
  });

  it("英語のとき対応する英語見出しを付ける", () => {
    const text = buildWindowTextWithSurvey("survey content", 0, 3, "window body", "en");
    expect(text).toContain("Document survey");
    expect(text).toContain("survey content");
    expect(text).toContain("window 1 of 3");
    expect(text).toContain("window body");
  });

  it("見取り図が引用の根拠にならない旨を明示する", () => {
    const ja = buildWindowTextWithSurvey("要約", 0, 2, "本文", "ja");
    expect(ja).toContain("引用の根拠にはしない");
    const en = buildWindowTextWithSurvey("summary", 0, 2, "body", "en");
    expect(en.toLowerCase()).toContain("not a citable source");
  });
});
