import { describe, it, expect } from "vitest";
import { deriveActivityName, stripEnumeratorPrefix } from "./activity-name";

describe("deriveActivityName", () => {
  it("数字 + ピリオドの連番を除去する", () => {
    expect(deriveActivityName("1. 具材を切る")).toBe("具材を切る");
    expect(deriveActivityName("2. 炒める")).toBe("炒める");
    expect(deriveActivityName("10. 煮込む")).toBe("煮込む");
  });

  it("階層番号（1.1 / 1.2.3）を除去する", () => {
    expect(deriveActivityName("1.1 前処理")).toBe("前処理");
    expect(deriveActivityName("1.2.3 計測")).toBe("計測");
    expect(deriveActivityName("1.1. 前処理")).toBe("前処理");
  });

  it("括弧・読点・全角記号の連番を除去する", () => {
    expect(deriveActivityName("2) 炒める")).toBe("炒める");
    expect(deriveActivityName("3、煮込む")).toBe("煮込む");
    expect(deriveActivityName("4） 盛り付け")).toBe("盛り付け");
    expect(deriveActivityName("5： 配膳")).toBe("配膳");
  });

  it("アルファベットの連番を除去する", () => {
    expect(deriveActivityName("a. 炒める")).toBe("炒める");
    expect(deriveActivityName("A) 炒める")).toBe("炒める");
    expect(deriveActivityName("b） 煮込む")).toBe("煮込む");
  });

  it("丸数字・漢数字の連番を除去する", () => {
    expect(deriveActivityName("①具材を切る")).toBe("具材を切る");
    expect(deriveActivityName("② 炒める")).toBe("炒める");
    expect(deriveActivityName("一、具材を切る")).toBe("具材を切る");
    expect(deriveActivityName("二. 炒める")).toBe("炒める");
  });

  it("連番を 1 つだけ除去する（多重には適用しない）", () => {
    expect(deriveActivityName("1. 2. 炒める")).toBe("2. 炒める");
  });

  it("全角数字の連番を除去する（区切りも全角ピリオド可）", () => {
    expect(deriveActivityName("１．具材を切る")).toBe("具材を切る");
    expect(deriveActivityName("２）炒める")).toBe("炒める");
    expect(deriveActivityName("３、煮込む")).toBe("煮込む");
    expect(deriveActivityName("１．１ 前処理")).toBe("前処理");
  });

  it("先頭カッコ書式の連番を除去する", () => {
    expect(deriveActivityName("(1) 具材を切る")).toBe("具材を切る");
    expect(deriveActivityName("（１）炒める")).toBe("炒める");
    expect(deriveActivityName("(a) 煮込む")).toBe("煮込む");
    expect(deriveActivityName("(12) 盛り付け")).toBe("盛り付け");
  });

  // ── 誤除去しないケース（保守的であること）──

  it("区切りなしの数字（年・数量など）は名前として残す", () => {
    expect(deriveActivityName("2026 結果")).toBe("2026 結果");
    expect(deriveActivityName("２０２６ 結果")).toBe("２０２６ 結果");
    expect(deriveActivityName("100℃で加熱")).toBe("100℃で加熱");
  });

  it("カッコ内が数字/英字でないものは残す", () => {
    expect(deriveActivityName("(参考) 文献")).toBe("(参考) 文献");
    expect(deriveActivityName("（図1）の説明")).toBe("（図1）の説明");
  });

  it("区切りなしのアルファベットは残す", () => {
    expect(deriveActivityName("A 試料の準備")).toBe("A 試料の準備");
    expect(deriveActivityName("v1.2 リリース")).toBe("v1.2 リリース");
  });

  it("区切りなしの漢数字（一階・十回など）は残す", () => {
    expect(deriveActivityName("一階の試料")).toBe("一階の試料");
    expect(deriveActivityName("十回繰り返す")).toBe("十回繰り返す");
  });

  it("番号だけの見出しは元のテキストを保持する", () => {
    expect(deriveActivityName("1.")).toBe("1.");
    expect(deriveActivityName("①")).toBe("①");
  });

  it("連番がない通常の見出しはそのまま返す", () => {
    expect(deriveActivityName("具材を切る")).toBe("具材を切る");
    expect(deriveActivityName("  炒める  ")).toBe("炒める");
  });

  it("空文字は空文字を返す", () => {
    expect(deriveActivityName("")).toBe("");
    expect(deriveActivityName("   ")).toBe("");
  });
});

describe("stripEnumeratorPrefix", () => {
  it("番号だけの見出しでは空文字になる（生の変換）", () => {
    expect(stripEnumeratorPrefix("1.")).toBe("");
  });
});
