// wiki-ingester の Tier 1 unit test（LLM 呼び出しなし）
//
// 話題（topic）関連の 2 点を中心に検証する:
//   1. parseTopics: 非文字列 / 空文字 / 重複を落とし、最大 3 件に切り詰める
//   2. parseIngesterOutput: claim のみ topics を残し、summary では剥がす
//   3. buildIngesterSystemPrompt: 既存話題一覧がプロンプトに反映される

import { describe, it, expect } from "vitest";
import {
  parseTopics,
  parseIngesterOutput,
  buildIngesterSystemPrompt,
  type ExistingWikiInfo,
} from "./wiki-ingester.ts";

describe("parseTopics", () => {
  it("非配列・undefined は undefined を返す", () => {
    expect(parseTopics(undefined)).toBeUndefined();
    expect(parseTopics(null)).toBeUndefined();
    expect(parseTopics("not-an-array")).toBeUndefined();
  });

  it("非文字列要素・空文字（trim 後）を落とす", () => {
    expect(parseTopics(["有効な話題", 123, null, "  ", ""])).toEqual(["有効な話題"]);
  });

  it("前後空白を trim する", () => {
    expect(parseTopics(["  話題A  "])).toEqual(["話題A"]);
  });

  it("NFC 正規化・大小文字違いの重複を落とす（最初の表記を残す）", () => {
    const composed = "が"; // NFC 合成済み
    const decomposed = "が"; // か + 濁点結合文字（NFC で "が" と同じ）
    expect(parseTopics([composed, decomposed])).toEqual([composed]);
    expect(parseTopics(["SPS Sintering", "sps sintering"])).toEqual(["SPS Sintering"]);
  });

  it("最大 3 件に切り詰める", () => {
    expect(parseTopics(["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c"]);
  });

  it("結果が 0 件なら undefined（空配列を保存しない）", () => {
    expect(parseTopics([])).toBeUndefined();
    expect(parseTopics(["", "  "])).toBeUndefined();
  });
});

describe("parseIngesterOutput - topics", () => {
  const wrap = (wikis: unknown) => JSON.stringify({ wikis });

  it("claim では topics を残す", () => {
    const text = wrap([
      {
        kind: "claim",
        title: "還元反応が加速する",
        topics: ["還元の反応速度", "還元の反応速度", "  pH 依存性  "],
        sections: [{ heading: "", content: "本文" }],
        suggestedAction: "create",
        confidence: 0.8,
        relatedClaims: [],
        externalReferences: [],
      },
    ]);
    const [out] = parseIngesterOutput(text);
    expect(out.kind).toBe("claim");
    expect(out.topics).toEqual(["還元の反応速度", "pH 依存性"]);
  });

  it("summary では topics を剥がす（LLM が誤って出しても無視）", () => {
    const text = wrap([
      {
        kind: "summary",
        title: "ノート要約",
        topics: ["混入した話題名"],
        sections: [{ heading: "", content: "本文" }],
        suggestedAction: "create",
        confidence: 0.5,
        relatedClaims: [],
        externalReferences: [],
      },
    ]);
    const [out] = parseIngesterOutput(text);
    expect(out.kind).toBe("summary");
    expect(out.topics).toBeUndefined();
  });

  it("topics 未出力の claim では undefined のまま（従来通り動作）", () => {
    const text = wrap([
      {
        kind: "claim",
        title: "話題を出さない claim",
        sections: [{ heading: "", content: "本文" }],
        suggestedAction: "create",
        confidence: 0.8,
        relatedClaims: [],
        externalReferences: [],
      },
    ]);
    const [out] = parseIngesterOutput(text);
    expect(out.topics).toBeUndefined();
  });
});

describe("buildIngesterSystemPrompt - 既存話題一覧の注入", () => {
  it("既存の topic kind エントリがプロンプトに列挙される", () => {
    const existingWikis: ExistingWikiInfo[] = [
      { id: "topic-1", title: "還元の反応速度", kind: "topic" },
      { id: "claim-1", title: "ある知見", kind: "claim" },
    ];
    const prompt = buildIngesterSystemPrompt("ja", existingWikis);
    expect(prompt).toContain("還元の反応速度");
    // claim 側の id ではなく話題名だけの列挙であることを確認（既存 wiki 一覧の書式と混同していない）
    expect(prompt).toMatch(/Topics \(existing\)/);
  });

  it("既存話題が無ければ (none yet) を出す", () => {
    const prompt = buildIngesterSystemPrompt("en", []);
    const topicsSection = prompt.slice(prompt.indexOf("### Topics (existing)"));
    expect(topicsSection).toContain("(none yet)");
  });
});
