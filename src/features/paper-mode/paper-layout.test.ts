// @vitest-environment jsdom
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
  findPaperSheetWidth,
  resolvePaperLayout,
  shouldAutoOpenProvPanel,
  shouldShowNarrowNotice,
  wouldHidePaperSheet,
} from "./paper-layout";

describe("paper-layout の寸法", () => {
  it("用紙 210mm は約 793.7px、余白 15mm は約 56.7px（丸めない）", () => {
    expect(PAPER_WIDTH_PX).toBeCloseTo(793.7, 1);
    expect(PAPER_MARGIN_PX).toBeCloseTo(56.69, 2);
  });

  it("印字の幅はちょうど 180mm（約 680.31px。印刷の #graphium-print-root と同じ）", () => {
    expect(PAPER_TEXT_WIDTH_PX).toBeCloseTo(680.31, 2);
    expect(PAPER_TEXT_WIDTH_PX).toBeCloseTo(PAPER_WIDTH_PX - PAPER_MARGIN_PX * 2, 6);
  });

  it("見出しのハンドルも用紙の内側に収まる（左の溝 >= ハンドル + 見出しの寄せ）", () => {
    // 見出しのハンドルの左端 = 溝 - 48 - 28。0 未満なら用紙の外へはみ出す
    const headingHandleLeft =
      PAPER_GUTTER_LEFT_PX - SIDE_HANDLE_WIDTH_PX - HEADING_HANDLE_SHIFT_PX;
    expect(headingHandleLeft).toBeGreaterThanOrEqual(0);
    // 15mm のままだと見出しでは -19px はみ出す（この値を溝にしない理由）
    expect(PAPER_MARGIN_PX - SIDE_HANDLE_WIDTH_PX - HEADING_HANDLE_SHIFT_PX).toBeCloseTo(-19.31, 2);
  });

  it("左右の溝と印字の幅で用紙の内寸ちょうどになる（印字幅は 180mm のまま）", () => {
    expect(PAPER_GUTTER_LEFT_PX + PAPER_TEXT_WIDTH_PX + PAPER_GUTTER_RIGHT_PX).toBeCloseTo(
      PAPER_WIDTH_PX - PAPER_BORDER_PX * 2,
      6,
    );
    expect(PAPER_GUTTER_RIGHT_PX).toBeCloseTo(35.39, 2);
  });

  it("紙の見た目に要る枠の幅は用紙 + 左右の机", () => {
    expect(PAPER_MIN_FRAME_WIDTH_PX).toBe(Math.ceil(PAPER_WIDTH_PX + DESK_MARGIN_PX * 2));
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
    expect(resolvePaperLayout("a4", Math.ceil(PAPER_WIDTH_PX))).toBe("flow");
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

describe("wouldHidePaperSheet", () => {
  it("開いたあとの枠が 818px を割るなら隠れる", () => {
    expect(wouldHidePaperSheet(984, 384)).toBe(true);
    expect(wouldHidePaperSheet(PAPER_MIN_FRAME_WIDTH_PX + 384, 384)).toBe(false);
    expect(wouldHidePaperSheet(PAPER_MIN_FRAME_WIDTH_PX + 384 - 1, 384)).toBe(true);
  });

  it("十分に広ければ隠れない", () => {
    expect(wouldHidePaperSheet(1600, 384)).toBe(false);
  });

  it("測れない値は隠れないと見なす", () => {
    expect(wouldHidePaperSheet(0, 384)).toBe(false);
    expect(wouldHidePaperSheet(Number.NaN, 384)).toBe(false);
  });
});

describe("findPaperSheetWidth", () => {
  const mk = (html: string, width: number) => {
    const row = document.createElement("div");
    row.innerHTML = html;
    const sheet = row.querySelector<HTMLElement>('[data-paper-layout="sheet"]');
    if (sheet) sheet.getBoundingClientRect = () => ({ width }) as DOMRect;
    return row;
  };
  it("sheet の用紙があれば根の実寸を返す", () => {
    expect(findPaperSheetWidth(mk('<div data-paper-layout="sheet"></div>', 984))).toBe(984);
  });
  it("flow・用紙なし・row なしは null", () => {
    expect(findPaperSheetWidth(mk('<div data-paper-layout="flow"></div>', 500))).toBeNull();
    expect(findPaperSheetWidth(mk("<div></div>", 500))).toBeNull();
    expect(findPaperSheetWidth(null)).toBeNull();
  });
});

describe("shouldAutoOpenProvPanel", () => {
  const base = { isDesktop: true, fitsByWidth: true, panelWidth: 384 };
  it("用紙が出ていて隠れるなら開かない", () => {
    expect(shouldAutoOpenProvPanel({ ...base, paperFrameWidth: 984 })).toBe(false);
  });
  it("用紙が出ていても隠れないなら従来の幅判定で開く", () => {
    expect(shouldAutoOpenProvPanel({ ...base, paperFrameWidth: 1600 })).toBe(true);
    expect(shouldAutoOpenProvPanel({ ...base, paperFrameWidth: 1600, fitsByWidth: false })).toBe(false);
  });
  it("用紙が出ていない（標準ノート）なら従来どおり開く", () => {
    expect(shouldAutoOpenProvPanel({ ...base, paperFrameWidth: null })).toBe(true);
    expect(shouldAutoOpenProvPanel({ ...base, paperFrameWidth: null, fitsByWidth: false })).toBe(false);
  });
  it("モバイルは用紙の有無によらず開く", () => {
    expect(shouldAutoOpenProvPanel({ ...base, isDesktop: false, fitsByWidth: false, paperFrameWidth: 984 })).toBe(true);
  });
});
