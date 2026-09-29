// 拡大縮小の表示用部品の固定（キーキャップの字・元に戻すの表記）

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatZoomPercent, zoomKeycapLabel, zoomResetShortcut } from "./format";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("zoomKeycapLabel", () => {
  it("縮小の - だけ表示を − (U+2212) にする", () => {
    expect(zoomKeycapLabel("-")).toBe("−");
    expect(zoomKeycapLabel("+")).toBe("+");
    expect(zoomKeycapLabel("0")).toBe("0");
    expect(zoomKeycapLabel("Ctrl")).toBe("Ctrl");
  });
});

describe("zoomResetShortcut", () => {
  it("OS に合わせて ⌘+0 / Ctrl+0", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(zoomResetShortcut()).toBe("⌘+0");
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(zoomResetShortcut()).toBe("Ctrl+0");
  });
});

describe("formatZoomPercent", () => {
  it("四捨五入して % を付ける", () => {
    expect(formatZoomPercent(0.9)).toBe("90%");
    expect(formatZoomPercent(0.67)).toBe("67%");
  });
});
