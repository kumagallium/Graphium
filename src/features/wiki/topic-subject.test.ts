import { describe, expect, it } from "vitest";

import { isChemicalFormula, splitTopicSubject } from "./topic-subject";

describe("splitTopicSubject", () => {
  it("日本語「化学式 の 物性」を割る（の の前後の空白は任意）", () => {
    expect(splitTopicSubject("Bi2Te3 の 熱伝導率", "concept")).toEqual({ material: "Bi2Te3", property: "熱伝導率" });
    expect(splitTopicSubject("PbTeの格子熱伝導率", undefined)).toEqual({ material: "PbTe", property: "格子熱伝導率" });
    // 物性側に「の」があっても最初の「の」で割る
    expect(splitTopicSubject("Bi2Te3 の 温度の依存性", "concept")).toEqual({ material: "Bi2Te3", property: "温度の依存性" });
  });

  it("英語「property of formula」を割る", () => {
    expect(splitTopicSubject("Seebeck coefficient of Bi2Te3", "concept")).toEqual({
      material: "Bi2Te3",
      property: "Seebeck coefficient",
    });
    expect(splitTopicSubject("figure of merit of PbTe", "concept")).toEqual({ material: "PbTe", property: "figure of merit" });
  });

  it("p 型・n 型の前置きと 合金・系 の後置きを外して判定し、左は原文のまま", () => {
    expect(splitTopicSubject("p型 Bi2Te3 の 電気抵抗率", "concept")).toEqual({ material: "p型 Bi2Te3", property: "電気抵抗率" });
    expect(splitTopicSubject("n-type PbTe の 移動度", "concept")).toEqual({ material: "n-type PbTe", property: "移動度" });
    expect(splitTopicSubject("Bi-Te 系 の 相図", "concept")).toEqual({ material: "Bi-Te 系", property: "相図" });
    expect(splitTopicSubject("carrier density of Bi2Te3 alloy", "concept")).toEqual({
      material: "Bi2Te3 alloy",
      property: "carrier density",
    });
  });

  it("全角・ハイフン類を統一してから判定する", () => {
    expect(splitTopicSubject("Ｂｉ２Ｔｅ３ の 熱伝導率", "concept").material).toBe("Bi2Te3");
    expect(splitTopicSubject("Bi–Te 合金 の 硬さ", "concept").material).toBe("Bi-Te 合金");
  });

  it("x・y・小数点を含む組成式も化学式", () => {
    expect(splitTopicSubject("Bi0.5Sb1.5Te3 の 熱伝導率", "concept").material).toBe("Bi0.5Sb1.5Te3");
    expect(splitTopicSubject("Mg2SixSn1-x の 熱伝導率", "concept").material).toBe("Mg2SixSn1-x");
  });

  it("割れなければ、材料の種類のときだけ題まるごとを材料にする", () => {
    expect(splitTopicSubject("熱電変換", "concept")).toEqual({ material: null, property: null });
    expect(splitTopicSubject("パン生地の発酵", "concept")).toEqual({ material: null, property: null });
    expect(splitTopicSubject("Bi2Te3", "material")).toEqual({ material: "Bi2Te3", property: null });
    expect(splitTopicSubject("ライ麦粉", "material")).toEqual({ material: "ライ麦粉", property: null });
    expect(splitTopicSubject("Bi2Te3", "concept")).toEqual({ material: null, property: null });
    expect(splitTopicSubject("熱伝導率", undefined)).toEqual({ material: null, property: null });
  });

  it("元素が 1 つだけ・元素でない語は化学式にしない", () => {
    expect(splitTopicSubject("Si の 熱伝導率", "concept")).toEqual({ material: null, property: null });
    expect(splitTopicSubject("Hot の 話", "concept")).toEqual({ material: null, property: null });
    expect(isChemicalFormula("Bi2Te3")).toBe(true);
    expect(isChemicalFormula("Si")).toBe(false);
    expect(isChemicalFormula("Xx2Yy3")).toBe(false);
  });
});

describe("略語・空白・長さ", () => {
  it("大文字の略語や B2B は化学式にしない", () => {
    for (const w of ["CPU", "ISO", "SNS", "HIV", "UV", "US", "PC", "IC", "OS", "B2B"]) {
      expect(splitTopicSubject(`${w}の性能`, "concept")).toEqual({ material: null, property: null });
      expect(isChemicalFormula(w)).toBe(false);
    }
  });

  it("教科書的な化学式は割れる（固溶体も）", () => {
    for (const f of ["PbTe", "ZnO", "SiC", "InSb", "Bi2Te3", "(Bi,Sb)2Te3"]) {
      expect(splitTopicSubject(`${f} の 硬さ`, "concept")).toEqual({ material: f, property: "硬さ" });
    }
  });

  it("種類が材料なら 3 つ目の条件を緩める（BN）。concept なら割れない", () => {
    expect(splitTopicSubject("BN の 熱伝導率", "material")).toEqual({ material: "BN", property: "熱伝導率" });
    expect(splitTopicSubject("BN の 熱伝導率", "concept")).toEqual({ material: null, property: null });
  });

  it("丸括弧の対応が悪いと割れない", () => {
    for (const f of ["(Bi,Sb2Te3", "Bi,Sb)2Te3", ")Bi2Te3(", "((Bi2Te3)"]) {
      expect(splitTopicSubject(`${f} の 硬さ`, "concept")).toEqual({ material: null, property: null });
    }
  });

  it("空白 5 万個の題でも 200 ms 以内に返る", () => {
    const t0 = performance.now();
    splitTopicSubject(`Bi2Te3${" ".repeat(50000)}x`, "concept");
    splitTopicSubject(`a${" ".repeat(50000)}の${" ".repeat(50000)}`, "material");
    splitTopicSubject(`a${" ".repeat(50000)}of${" ".repeat(50000)}`, "concept");
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("畳んだ後に 200 文字を超える題は割らない（材料の種類なら題まるごと）", () => {
    const long = "あ".repeat(201);
    expect(splitTopicSubject(`Bi2Te3 の ${long}`, "concept")).toEqual({ material: null, property: null });
    const t = `Bi2Te3 の ${long}`.replace(/\s+/g, " ");
    expect(splitTopicSubject(`Bi2Te3 の ${long}`, "material")).toEqual({ material: t, property: null });
    expect(splitTopicSubject(`Bi2Te3 の ${"あ".repeat(150)}`, "concept").material).toBe("Bi2Te3");
  });
});
