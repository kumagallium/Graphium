import { describe, it, expect } from "vitest";
import { splitNumericText } from "./frame-number.js";

describe("splitNumericText - 分ける", () => {
  it.each([
    ["650 K", { value: 650, unit: "K" }],
    ["4 min", { value: 4, unit: "min" }],
    ["1.2e-3", { value: 0.0012 }],
    ["1,200", { value: 1200 }],
    ["45%", { value: 45, unit: "%" }],
    ["６５０ K", { value: 650, unit: "K" }],
    ["−3.5 ℃", { value: -3.5, unit: "℃" }],
    ["12 m²", { value: 12, unit: "m²" }],
    ["< 1", { value: 1, comparator: "lt" }],
    ["≥ 650 K", { value: 650, unit: "K", comparator: "ge" }],
    ["4", { value: 4 }],
  ])("%s", (text, expected) => {
    expect(splitNumericText(text)).toEqual(expected);
  });
});

describe("splitNumericText - 分けない", () => {
  it.each([
    "600〜650", "600-650 K", "~650", "約 650", "650 K 以上", "2024-10-01",
    "12:30", "1,2", "速くなった", "v1.2", "1.2×10⁻³", "5 " + "a".repeat(25),
    "0,500", "00,500", "01,000",
    "650 K 付近", "650 K 以内", "650 K 強", "650 K 弱", "600 K台", "650 K 以降", "650 K ごろ",
    "650 K 頃", "650 K 余り", "650 K を上回る", "650 K より高い", "650 近く", "650 K 程",
    "650 K above", "650 K higher", "650 K max", "650 K at least", "650 K roughly",
    "650 K around", "650 K minimum", "650 K ca.", "650 K (est.)", "650 above", "650 付近",
    "45% 増加", "5 回繰り返した", "650 K で測定",
    "650 と ７００", "650 K、７００ K", "５−３", "650 ∼ ７００", "650 ∼ 700",
  ])("%s", (text) => {
    expect(splitNumericText(text)).toBeNull();
  });
});

describe("splitNumericText - 千区切りと単位の追加例", () => {
  it("1,000 は分ける", () => {
    expect(splitNumericText("1,000")).toEqual({ value: 1000 });
  });
  it("短い日本語単位は通す", () => {
    expect(splitNumericText("5 秒")).toEqual({ value: 5, unit: "秒" });
    expect(splitNumericText("3 週")).toEqual({ value: 3, unit: "週" });
  });
  it("型番・グレード・同位体（数と英字が空白なしで続く）は分けない", () => {
    for (const t of ["316L", "304L", "3D", "2D", "4H", "5N", "6N", "13C", "3He", "1A"]) {
      expect(splitNumericText(t), t).toBeNull();
    }
  });
  it("空白ありの数 + 英字単位と記号の単位は分ける", () => {
    expect(splitNumericText("5 N")).toEqual({ value: 5, unit: "N" });
    expect(splitNumericText("45%")).toEqual({ value: 45, unit: "%" });
    expect(splitNumericText("20℃")).toEqual({ value: 20, unit: "℃" });
  });
  it("上付き・分数・丸数字・記号だけ・絵文字の単位は分けない", () => {
    for (const t of ["10³", "5²", "5½", "5 ½", "3 ½", "10²", "1.5 ①", "5 ^", "5 ·", "5 ©", "5 ★", "5 😀"]) {
      expect(splitNumericText(t), t).toBeNull();
    }
  });
  it("暦・時刻・序数にも読める語は分けない", () => {
    for (const t of ["2024年", "10月", "3月", "1日", "12時", "5 回", "30度"]) {
      expect(splitNumericText(t), t).toBeNull();
    }
  });
});

describe("splitNumericText - 単位は許可リスト（round 3）", () => {
  it("語・日付・時刻・時代・近似・上下限は分けない", () => {
    const words = ["plus", "odd", "ish", "some", "minus", "tops", "Oct", "October", "May", "Mon",
      "BC", "AD", "CE", "pm", "am", "N/A", "no", "yes", "not", "the", "of", "is"];
    for (const w of words) {
      expect(splitNumericText(`5 ${w}`), w).toBeNull();
    }
  });
  it("許可リストの単位と複合単位は分ける（大小文字は保つ）", () => {
    expect(splitNumericText("650 mK")).toEqual({ value: 650, unit: "mK" });
    expect(splitNumericText("3 m/s")).toEqual({ value: 3, unit: "m/s" });
    expect(splitNumericText("2 cm³")).toEqual({ value: 2, unit: "cm³" });
    expect(splitNumericText("20 °C")).toEqual({ value: 20, unit: "°C" });
    expect(splitNumericText("5 wt%")).toEqual({ value: 5, unit: "wt%" });
  });
  it("大小文字が違う綴りは許可リストに無ければ分けない", () => {
    expect(splitNumericText("5 KELVIN")).toBeNull();
  });
});

