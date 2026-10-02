import { describe, it, expect } from "vitest";
// BlockNote を読み込むと MultipleNodeSelection が "multiple-node" で登録される（実アプリと同じ状態）
import "@blocknote/core";
import {
  autoScrollStep,
  getMultipleNodeSelectionClass,
  pickMarqueeRange,
  rectFromPoints,
} from "./marquee-selection";

const block = (id: string, top: number, bottom: number, left = 100, right = 500) => ({
  id,
  rect: { left, right, top, bottom },
});

describe("rectFromPoints", () => {
  it("ドラッグの向きを問わず正規化する", () => {
    expect(rectFromPoints(50, 80, 10, 20)).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
  });
});

describe("pickMarqueeRange", () => {
  const blocks = [
    block("a", 0, 30),
    block("img", 30, 300, 100, 340),
    block("b", 300, 330),
    block("c", 330, 360),
  ];

  it("矩形にかかったブロックを文書順で返す", () => {
    expect(pickMarqueeRange(rectFromPoints(80, 100, 200, 310), blocks)).toEqual(["img", "b"]);
  });

  it("中身の左にある余白だけをなぞっても選ばない", () => {
    expect(pickMarqueeRange(rectFromPoints(40, 0, 90, 360), blocks)).toEqual([]);
  });

  it("かかった最初と最後の間は、矩形に入っていないブロックも含めて連続範囲にする", () => {
    // 画像の右（x 400〜450）は画像にかからないが、上下の a と b にはかかる
    expect(pickMarqueeRange(rectFromPoints(400, 10, 450, 310), blocks)).toEqual(["a", "img", "b"]);
  });
});

describe("autoScrollStep", () => {
  it("上下端の近くだけスクロールし、端に寄るほど速い", () => {
    expect(autoScrollStep(300, 0, 600)).toBe(0);
    expect(autoScrollStep(30, 0, 600)).toBeLessThan(0);
    expect(autoScrollStep(-50, 0, 600)).toBe(-16);
    expect(autoScrollStep(590, 0, 600)).toBeGreaterThan(0);
  });
});

describe("getMultipleNodeSelectionClass", () => {
  // BlockNote の更新でクラス名・登録名が変わると ⠿ でのまとめ移動が黙って効かなくなるので、ここで気づく
  it("BlockNote の MultipleNodeSelection を取り出せる", () => {
    const cls = getMultipleNodeSelectionClass();
    expect(cls).not.toBeNull();
    expect((cls!.prototype as any).jsonID).toBe("multiple-node");
  });
});
