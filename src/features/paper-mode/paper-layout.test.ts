import { describe, expect, it } from "vitest";
import {
  DESK_MARGIN_PX,
  HEADING_HANDLE_SHIFT_PX,
  PAPER_BORDER_PX,
  PAPER_GUTTER_LEFT_PX,
  PAPER_GUTTER_RIGHT_PX,
  PAPER_MARGIN_PX,
  PAPER_TEXT_WIDTH_PX,
  SIDE_HANDLE_WIDTH_PX,
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

  it("印字の幅は 180mm（約 680px）", () => {
    expect(PAPER_TEXT_WIDTH_PX).toBe(680);
  });

  it("見出しのハンドルも用紙の内側に収まる（左の溝 >= ハンドル + 見出しの寄せ）", () => {
    // 見出しのハンドルの左端 = 溝 - 48 - 28。0 未満なら用紙の外へはみ出す
    const headingHandleLeft =
      PAPER_GUTTER_LEFT_PX - SIDE_HANDLE_WIDTH_PX - HEADING_HANDLE_SHIFT_PX;
    expect(headingHandleLeft).toBeGreaterThanOrEqual(0);
    // 15mm のままだと見出しでは -19px はみ出す（この値を溝にしない理由）
    expect(PAPER_MARGIN_PX - SIDE_HANDLE_WIDTH_PX - HEADING_HANDLE_SHIFT_PX).toBe(-19);
  });

  it("左右の溝と印字の幅で用紙の内寸ちょうどになる（印字幅は 180mm のまま）", () => {
    expect(PAPER_GUTTER_LEFT_PX + PAPER_TEXT_WIDTH_PX + PAPER_GUTTER_RIGHT_PX).toBe(
      PAPER_WIDTH_PX - PAPER_BORDER_PX * 2,
    );
    expect(PAPER_GUTTER_RIGHT_PX).toBeGreaterThan(0);
  });

  it("紙の見た目に要る枠の幅は用紙 + 左右の机", () => {
    expect(PAPER_MIN_FRAME_WIDTH_PX).toBe(PAPER_WIDTH_PX + DESK_MARGIN_PX * 2);
    expect(PAPER_MIN_FRAME_WIDTH_PX).toBe(818);
  });

  it("Windows 150% で右パネルを開いたまま 80% に縮小した本文枠（824px）でも用紙", () => {
    expect(resolvePaperLayout("a4", 824)).toBe("sheet");
    expect(resolvePaperLayout("a4", 817)).toBe("flow");
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
    expect(shouldShowNarrowNotice("a4", "flow", 600)).toBe(true);
    expect(shouldShowNarrowNotice("a4", "sheet", 1280)).toBe(false);
    expect(shouldShowNarrowNotice("standard", "flow", 600)).toBe(false);
  });

  it("幅が未計測（null）・0 のときは出さない", () => {
    expect(shouldShowNarrowNotice("a4", "flow", null)).toBe(false);
    expect(shouldShowNarrowNotice("a4", "flow", 0)).toBe(false);
  });
});
