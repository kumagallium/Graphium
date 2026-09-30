import { describe, it, expect } from "vitest";
import { computeSelectionToolbarPosition } from "./toolbar-position";

const rect = (top: number, left: number, w: number, h: number) => ({
  top,
  left,
  bottom: top + h,
  right: left + w,
});
const viewport = { width: 1280, height: 660 };
const toolbarSize = { width: 200, height: 36 };

describe("computeSelectionToolbarPosition", () => {
  it("枠の上に空きがあれば、先頭ブロックの上に置く", () => {
    const p = computeSelectionToolbarPosition({
      firstRect: rect(300, 320, 400, 40),
      lastRect: rect(400, 320, 400, 40),
      frameTop: 45,
      toolbarSize,
      viewport,
    });
    expect(p.side).toBe("above");
    expect(p.top).toBe(300 - 8 - 36);
    expect(p.left).toBe(320);
  });

  it("枠の上端までに空きが無ければ、最後のブロックの下に置く", () => {
    const p = computeSelectionToolbarPosition({
      firstRect: rect(60, 320, 400, 40),
      lastRect: rect(160, 320, 400, 40),
      frameTop: 45,
      toolbarSize,
      viewport,
    });
    expect(p.side).toBe("below");
    expect(p.top).toBe(200 + 8);
  });

  it("右端では画面の内側へ押し戻す", () => {
    const p = computeSelectionToolbarPosition({
      firstRect: rect(300, 1200, 60, 40),
      lastRect: rect(400, 1200, 60, 40),
      frameTop: 0,
      toolbarSize,
      viewport,
    });
    expect(p.left).toBe(1280 - 200 - 8);
  });
});
