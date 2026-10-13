import { describe, it, expect } from "vitest";
import { splitStateText } from "./frame-state.ts";

describe("splitStateText - 寄せる", () => {
  const cases: Array<[string, string, "present" | "absent"]> = [
    ["分解する", "分解", "present"],
    ["分解した", "分解", "present"],
    ["分解している", "分解", "present"],
    ["分解された", "分解", "present"],
    ["分解しない", "分解", "absent"],
    ["分解しなかった", "分解", "absent"],
    ["分解していない", "分解", "absent"],
    ["分解しなくなった", "分解", "absent"],
    ["析出が見られた", "析出", "present"],
    ["析出は見られなかった", "析出", "absent"],
    ["変化あり", "変化", "present"],
    ["変化なし", "変化", "absent"],
    ["亀裂が生じた", "亀裂", "present"],
    ["亀裂は生じなかった", "亀裂", "absent"],
    ["相変態が確認された", "相変態", "present"],
  ];
  for (const [text, stem, polarity] of cases) {
    it(text, () => {
      expect(splitStateText(text)).toEqual({ stem, polarity });
    });
  }
});

describe("splitStateText - 寄せない", () => {
  const cases = [
    "一部分解した", "やや分解した", "ほぼ分解しない", "未分解", "割れた", "割れない", "溶ける",
    "下がった", "速くなった", "分解する場合がある", "分解するかもしれない", "分解するが遅い",
    "分解しやすい", "分解しにくい", "分解すると色が変わる", "2 回分解した", "decomposed", "",
  ];
  for (const text of cases) {
    it(JSON.stringify(text), () => {
      expect(splitStateText(text)).toBeNull();
    });
  }
});

describe("splitStateText - 寄せない（レビュー指摘の入力）", () => {
  const cases = [
    // 丁寧な否定過去を肯定に取り違えない
    "確認されませんでした", "観察されませんでした",
    // する型以外の動詞・丁寧形（語尾の断片が語幹に残る）
    "割れました", "壊れました", "下がりました", "速くなりました", "溶けていました",
    "粉末が崩れていました", "変色でした", "出した", "示した", "落とした", "冷やした", "減らした", "増した", "試した",
    // 二重否定・否定を含む名詞句
    "分解しないことはない", "分解しないわけではない", "分解しなくはない", "分解しないはずがない",
    "分解しないことがある", "分解しない/する",
    // ではない・わけではない
    "分解しなかったわけではない", "変化がないわけではない", "変化があるわけではない", "分解ではない", "異常ではない",
    // 条件・時間・伝聞の節
    "温度が上がると分解する", "水に溶けると分解した", "変色が見られた後に退色した",
    "亀裂が見られた箇所が確認された", "変化があるとされる", "変化があったとされる",
    // 程度・頻度・可能性
    "たまに分解した", "しばしば分解する", "常に分解する", "まれに分解する", "稀に分解する", "一度分解した",
    "特に変化なし", "大きな変化なし", "顕著な変化は見られなかった", "軽微な亀裂がある", "通常は変化なし",
    "亀裂の可能性がある", "劣化の疑いがある", "亀裂が見られる可能性がある", "時折分解する", "ときどき分解する",
    // 形式名詞
    "反応が起きたことはない", "分解したことはない",
  ];
  for (const text of cases) {
    it(JSON.stringify(text), () => {
      expect(splitStateText(text)).toBeNull();
    });
  }
});

describe("splitStateText - 丁寧形で寄せる（否定を肯定に取り違えない）", () => {
  const cases: Array<[string, string, "present" | "absent"]> = [
    ["分解しました", "分解", "present"],
    ["分解しませんでした", "分解", "absent"],
    ["変色が生じました", "変色", "present"],
    ["変色が生じませんでした", "変色", "absent"],
    ["変色が見られませんでした", "変色", "absent"],
    ["変色は起きませんでした", "変色", "absent"],
    ["変色がありませんでした", "変色", "absent"],
    ["亀裂がありませんでした", "亀裂", "absent"],
  ];
  for (const [text, stem, polarity] of cases) {
    it(text, () => {
      expect(splitStateText(text)).toEqual({ stem, polarity });
    });
  }
});
