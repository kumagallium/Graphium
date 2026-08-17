import { describe, it, expect } from "vitest";
import {
  extractTopicText,
  buildPageRetrievalQuery,
  MAX_TOPIC_CHARS,
} from "./retrieval-topic";

// 2026-08-17 に実際に 28,836 トークンで埋め込み 400 を起こしたノートと同じ形。
// BlockNote は先頭に空ヘッダー行 + 区切り行を吐き、列名は 1 行目のデータ行に来る。
const XRD_NOTE = [
  "|        |       |       |          |",
  "| ------ | ----- | ----- | -------- |",
  "| 2theta | d     | I     | (hkl)    |",
  "| 21.34  | 4.161 | 5.0   | (0,0,2)  |",
  "| 25.87  | 3.441 | 11.5  | (1,0,1)  |",
  "| 40.07  | 2.248 | 100.0 | (1,1,2)  |",
  ...Array.from({ length: 400 }, (_, i) => `| ${(50 + i * 0.1).toFixed(2)} | 1.${i} | 0.${i % 9} | (1,1,${i}) |`),
].join("\n");

describe("extractTopicText", () => {
  it("XRD テーブルのノート: 列名は残り、数値行は全部落ちる", () => {
    const topic = extractTopicText(XRD_NOTE);
    expect(topic).toContain("2theta");
    expect(topic).toContain("hkl");
    // 数値行の値は含まれない
    expect(topic).not.toContain("21.34");
    expect(topic).not.toContain("100.0");
    // 400 行の表があっても主題は短い
    expect(topic.length).toBeLessThan(100);
  });

  it("見出しは全部残す（ノートの骨格）", () => {
    const md = [
      "# ZnSb 焼結条件の最適化",
      "",
      "本文の段落です。",
      "",
      "## SPS 条件",
      "",
      "800 ℃ 5 分で行った。",
      "",
      "### XRD 結果",
    ].join("\n");
    const topic = extractTopicText(md);
    expect(topic).toContain("ZnSb 焼結条件の最適化");
    expect(topic).toContain("SPS 条件");
    expect(topic).toContain("XRD 結果");
    expect(topic).toContain("本文の段落です");
  });

  it("コードブロックの中身は fence ごと落ちる", () => {
    const md = [
      "解析スクリプトについて",
      "",
      "```python",
      "import numpy as np",
      "peaks = find_peaks(intensity, height=5)",
      "```",
      "",
      "以上。",
    ].join("\n");
    const topic = extractTopicText(md);
    expect(topic).toContain("解析スクリプトについて");
    expect(topic).toContain("以上");
    expect(topic).not.toContain("numpy");
    expect(topic).not.toContain("find_peaks");
  });

  it("数式ブロック（$$）と画像は落ちる", () => {
    const md = [
      "熱伝導率の式",
      "",
      "$$",
      "\\kappa = \\kappa_e + \\kappa_l",
      "$$",
      "",
      "![xrd pattern](blob:abc123)",
      "",
      "図は上のとおり。",
    ].join("\n");
    const topic = extractTopicText(md);
    expect(topic).toContain("熱伝導率の式");
    expect(topic).toContain("図は上のとおり");
    expect(topic).not.toContain("kappa");
    expect(topic).not.toContain("blob:");
  });

  it("区切り行付きの通常テーブル: ヘッダー行だけ残る", () => {
    const md = [
      "| 試料 | 温度 | 密度 |",
      "| --- | --- | --- |",
      "| A | 800 | 6.1 |",
      "| B | 850 | 6.3 |",
    ].join("\n");
    const topic = extractTopicText(md);
    expect(topic).toContain("試料");
    expect(topic).toContain("温度");
    expect(topic).toContain("密度");
    expect(topic).not.toContain("6.1");
    expect(topic).not.toContain("850");
  });

  it("箇条書き・引用のマーカーは落として本文として拾う", () => {
    const md = ["- 原料は ZnSb 粉末", "- 圧力 30 MPa", "> 注意: 酸化に弱い"].join("\n");
    const topic = extractTopicText(md);
    expect(topic).toContain("原料は ZnSb 粉末");
    expect(topic).toContain("圧力 30 MPa");
    expect(topic).toContain("注意: 酸化に弱い");
    expect(topic).not.toMatch(/^- /m);
    expect(topic).not.toMatch(/^> /m);
  });

  it("長い段落は先頭だけ、全体は MAX_TOPIC_CHARS で止まる", () => {
    const longPara = "あ".repeat(5000);
    const md = ["# 見出し", "", longPara, "", "い".repeat(5000)].join("\n");
    const topic = extractTopicText(md);
    expect(topic.length).toBeLessThanOrEqual(MAX_TOPIC_CHARS + 1);
    expect(topic).toContain("見出し");
  });

  it("見出し → テーブルヘッダー → 段落 の順に優先して詰める", () => {
    // 段落だけで予算を食い潰す量を用意し、見出しとヘッダーが押し出されないことを見る
    const md = [
      "だらだらした前置き段落。".repeat(60),
      "",
      "| 組成 | Seebeck | 導電率 |",
      "| --- | --- | --- |",
      "| x=0.1 | 120 | 800 |",
      "",
      "## 測定条件",
    ].join("\n");
    const topic = extractTopicText(md, 120);
    expect(topic).toContain("測定条件");
    expect(topic).toContain("Seebeck");
  });

  it("空・空白のみは空文字", () => {
    expect(extractTopicText("")).toBe("");
    expect(extractTopicText("   \n\n  ")).toBe("");
  });

  it("最初の要素が予算を超えていても先頭を切って 1 本は返す", () => {
    const md = "# " + "長い見出し".repeat(200);
    const topic = extractTopicText(md, 50);
    expect(topic.length).toBe(50);
  });
});

describe("buildPageRetrievalQuery", () => {
  it("タイトル + 主題 + 質問 を空行区切りで返す", () => {
    const q = buildPageRetrievalQuery({
      title: "XRD 測定ノート",
      pageMarkdown: XRD_NOTE,
      question: "この内容全体について質問があります。ピークの帰属は正しいですか？",
    });
    const parts = q.split("\n\n");
    expect(parts[0]).toBe("XRD 測定ノート");
    expect(q).toContain("2theta");
    expect(q).toContain("ピークの帰属は正しいですか");
    // 数値行は入っていない
    expect(q).not.toContain("21.34");
  });

  it("本文が空なら タイトル + 質問 だけ", () => {
    const q = buildPageRetrievalQuery({ title: "T", pageMarkdown: "", question: "Q" });
    expect(q).toBe("T\n\nQ");
  });

  it("タイトルも本文も空なら質問だけ（引用チャットの挙動と揃える）", () => {
    expect(buildPageRetrievalQuery({ title: "", pageMarkdown: "", question: "Q" })).toBe("Q");
  });
});
