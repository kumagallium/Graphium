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

  it("各エントリは parseTopics と同じルールでサニタイズされる（非文字列・空・重複を落とし最大 3 件）", () => {
    const text = JSON.stringify({
      topics: {
        "claim-1": ["A", "", "a", 123, "B", "C", "D"],
      },
    });
    // "a" は "A" の正規化重複として落ちる。4 件目以降（"D"）は切り詰められる。
    expect(parseTopicNamerOutput(text)).toEqual({ "claim-1": ["A", "B", "C"] });
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
