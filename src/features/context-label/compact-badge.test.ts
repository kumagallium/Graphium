import { describe, expect, it } from "vitest";
import { compactBadgeText } from "./compact-badge";

describe("compactBadgeText", () => {
  it("角括弧を飛ばして最初の文字を返す", () => {
    expect(compactBadgeText("[ツール]")).toBe("ツ");
    expect(compactBadgeText("[材料]")).toBe("材");
    expect(compactBadgeText("[Tool]")).toBe("T");
  });

  it("括弧の無い名前は先頭の文字を返す", () => {
    expect(compactBadgeText("手順")).toBe("手");
    expect(compactBadgeText("Step")).toBe("S");
  });

  it("数字も文字として扱う", () => {
    expect(compactBadgeText("(1) 準備")).toBe("1");
  });

  it("サロゲートペアを 1 文字として扱う", () => {
    expect(compactBadgeText("[𠮷野]")).toBe("𠮷");
  });

  it("記号だけの名前・空文字でも落ちない", () => {
    expect(compactBadgeText("[#]")).toBe("[");
    expect(compactBadgeText("")).toBe("");
  });
});
