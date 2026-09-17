// wiki-ingester の Tier 1 unit test（LLM 呼び出しなし）
//
// 話題（topic）関連の 2 点を中心に検証する:
//   1. parseTopics: 非文字列 / 空文字 / 重複を落とす（件数の上限は無い）
//   2. parseIngesterOutput: claim のみ topics を残し、summary は要素ごと捨てる（PR3）
//   3. buildIngesterSystemPrompt: 既存話題一覧がプロンプトに反映される

import { describe, it, expect, vi } from "vitest";
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

  it("件数の上限は設けない（切り詰めない）", () => {
    expect(parseTopics(["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("結果が 0 件なら undefined（空配列を保存しない）", () => {
    expect(parseTopics([])).toBeUndefined();
    expect(parseTopics(["", "  "])).toBeUndefined();
  });
});

describe("parseIngesterOutput - topics", () => {
  const wrap = (wikis: unknown) => JSON.stringify({ wikis });

  it("LLM が topics を返しても無視する（トピックはもう知見から作らない）", () => {
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
    expect(out.topics).toBeUndefined();
  });

  it("summary は要素ごと捨てる（PR3: 新規生成停止。LLM が指示に反して出しても無視）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      {
        kind: "claim",
        title: "同時に出た知見",
        sections: [{ heading: "", content: "本文" }],
        suggestedAction: "create",
        confidence: 0.8,
        relatedClaims: [],
        externalReferences: [],
      },
    ]);
    const out = parseIngesterOutput(text);
    // summary は捨てられ、claim だけが残る
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("claim");
    expect(out.some((w) => w.kind === "summary")).toBe(false);
    // 捨てた件数（1件）を警告として出す
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("1"));
    warnSpy.mockRestore();
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

describe("buildIngesterSystemPrompt - 話題（topic）はもう ingester の材料にしない", () => {
  it("既存の topic kind エントリは Existing Wikis の一覧にだけ現れ、専用の Topics セクションは無い", () => {
    const existingWikis: ExistingWikiInfo[] = [
      { id: "topic-1", title: "還元の反応速度", kind: "topic" },
      { id: "claim-1", title: "ある知見", kind: "claim" },
    ];
    const prompt = buildIngesterSystemPrompt("ja", existingWikis);
    // 既存 wiki 一覧（[kind] title (id: ...)）には出る
    expect(prompt).toContain("[topic] 還元の反応速度 (id: topic-1)");
    // 話題を振り分けさせる専用セクションはもう無い（トピックは資料を直接読む Topic Router が担う）
    expect(prompt).not.toMatch(/## Topics\b/);
    expect(prompt).not.toMatch(/Topics \(existing\)/);
  });

  it("Claim の出力スキーマから topics フィールドが消えている", () => {
    const prompt = buildIngesterSystemPrompt("en", []);
    expect(prompt).not.toContain('"topics"');
  });
});
