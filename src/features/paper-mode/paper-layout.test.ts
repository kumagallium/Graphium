import { describe, expect, it } from "vitest";
import {
  DESK_MARGIN_PX,
  PAPER_MARGIN_PX,
  PAPER_MIN_FRAME_WIDTH_PX,
  PAPER_WIDTH_PX,
  resolvePaperLayout,
  shouldShowNarrowNotice,
} from "./paper-layout";

describe("paper-layout の寸法", () => {
  it("用紙 210mm は約 794px、余白 15mm は約 57px", () => {
    expect(PAPER_WIDTH_PX).toBe(794);
    expect(PAPER_MARGIN_PX).toBe(57);
  });

  it("余白はドラッグハンドル（⠿ と ＋ で 48px）が収まる広さ", () => {
    expect(PAPER_MARGIN_PX).toBeGreaterThanOrEqual(48);
  });

  it("紙の見た目に要る枠の幅は用紙 + 左右の机", () => {
    expect(PAPER_MIN_FRAME_WIDTH_PX).toBe(PAPER_WIDTH_PX + DESK_MARGIN_PX * 2);
  });
});

describe("resolvePaperLayout", () => {
  it("standard は枠の幅によらず流れる本文", () => {
    expect(resolvePaperLayout("standard", 2000)).toBe("flow");
    expect(resolvePaperLayout("standard", 600)).toBe("flow");
  });

  it("a4 で枠が十分に広ければ用紙", () => {
    expect(resolvePaperLayout("a4", 1280)).toBe("sheet");
  });

  it("a4 でも枠が用紙 + 机より狭ければ流れる本文に戻る", () => {
    expect(resolvePaperLayout("a4", 600)).toBe("flow");
    expect(resolvePaperLayout("a4", PAPER_WIDTH_PX)).toBe("flow");
  });

  it("境界: ちょうど用紙 + 机なら用紙、1px 足りなければ流れる本文", () => {
    expect(resolvePaperLayout("a4", PAPER_MIN_FRAME_WIDTH_PX)).toBe("sheet");
    expect(resolvePaperLayout("a4", PAPER_MIN_FRAME_WIDTH_PX - 1)).toBe("flow");
  });

  it("未計測（null）は流れる本文", () => {
    expect(resolvePaperLayout("a4", null)).toBe("flow");
  });
});

describe("shouldShowNarrowNotice", () => {
  it("a4 を選んだのに流れる本文になっているときだけ出す", () => {
    expect(shouldShowNarrowNotice("a4", "flow")).toBe(true);
    expect(shouldShowNarrowNotice("a4", "sheet")).toBe(false);
    expect(shouldShowNarrowNotice("standard", "flow")).toBe(false);
  });
});
