import { describe, it, expect } from "vitest";
import { cleanGeneratedTitle } from "./api";

describe("cleanGeneratedTitle", () => {
  it("引用符・Markdown 修飾子を外す", () => {
    expect(cleanGeneratedTitle("「バゲットの加水率 70%」")).toBe("バゲットの加水率 70%");
    expect(cleanGeneratedTitle("**Baguette hydration test**")).toBe("Baguette hydration test");
    expect(cleanGeneratedTitle("## 焼成温度の比較")).toBe("焼成温度の比較");
  });

  it("複数行で返ったら最初の空でない行だけを使う", () => {
    expect(cleanGeneratedTitle("\n焼成温度の比較\nこのノートは…")).toBe("焼成温度の比較");
  });

  it("区切り記号以降の付け足しを落とす", () => {
    expect(cleanGeneratedTitle("焼成温度の比較 | 実験ノート")).toBe("焼成温度の比較");
  });
});
