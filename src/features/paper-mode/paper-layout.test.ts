// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESK_MARGIN_PX,
  HEADING_HANDLE_SHIFT_PX,
  PAPER_BORDER_PX,
  PAPER_GUTTER_LEFT_PX,
  PAPER_HEADING_HANDLE_SHIFT_PX,
  PAPER_GUTTER_RIGHT_PX,
  PAPER_MARGIN_PX,
  PRINT_PAGE_CONTENT_HEIGHT_PX,
  PAPER_TEXT_WIDTH_PX,
  SIDE_HANDLE_WIDTH_PX,
  PAPER_MIN_FRAME_WIDTH_PX,
  PAPER_WIDTH_PX,
  estimatePageNumberWidth,
  findPaperSheetWidth,
  resolvePageNumberPlacement,
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

  it("印字の幅はちょうど 170mm（約 642.52px。A4 のノートの印刷 #graphium-print-root[data-paper=a4] と同じ）", () => {
    expect(PAPER_TEXT_WIDTH_PX).toBeCloseTo(642.52, 2);
    // 用紙 210mm - 左右の余白 20mm × 2
    expect(PAPER_TEXT_WIDTH_PX).toBeCloseTo(PAPER_WIDTH_PX - 20 * (96 / 25.4) * 2, 6);
  });

  it("左右の溝は等しく、用紙の内寸から印字の幅を引いた半分（約 74.6px）", () => {
    expect(PAPER_GUTTER_LEFT_PX).toBeCloseTo(74.6, 1);
    expect(PAPER_GUTTER_RIGHT_PX).toBe(PAPER_GUTTER_LEFT_PX);
    expect(PAPER_GUTTER_LEFT_PX + PAPER_TEXT_WIDTH_PX + PAPER_GUTTER_RIGHT_PX).toBeCloseTo(
      PAPER_WIDTH_PX - PAPER_BORDER_PX * 2,
      6,
    );
  });

  it("見出しのハンドルも用紙の内側に収まる（左の溝 >= ハンドル + 用紙の中の寄せ）", () => {
    // 見出しのハンドルの左端 = 溝 - 48 - 寄せ。0 未満なら用紙の外へはみ出す
    const headingHandleLeft =
      PAPER_GUTTER_LEFT_PX - SIDE_HANDLE_WIDTH_PX - PAPER_HEADING_HANDLE_SHIFT_PX;
    expect(headingHandleLeft).toBeGreaterThanOrEqual(0);
    // 標準の寄せ（28px）のままだと約 1.4px はみ出す（用紙の中だけ詰める理由）
    expect(PAPER_GUTTER_LEFT_PX - SIDE_HANDLE_WIDTH_PX - HEADING_HANDLE_SHIFT_PX).toBeCloseTo(-1.4, 1);
    expect(PAPER_MARGIN_PX).toBeCloseTo(56.69, 2);
  });

  it("用紙の中の見出しの寄せは paper-frame.css の値と同じ", () => {
    const css = readFileSync(resolve("src/features/paper-mode/paper-frame.css"), "utf8");
    const m = css.match(
      /\[data-paper-layout="sheet"\] \.bn-side-menu\[data-block-type="heading"\] \{([^}]*)\}/,
    );
    expect(m, "用紙の中の見出しのハンドルの規則が paper-frame.css に無い").not.toBeNull();
    expect(m![1]).toContain(`translateX(-${PAPER_HEADING_HANDLE_SHIFT_PX}px)`);
  });

  it("A4 のノートの印刷は本文 170mm（画面外の基底と @media print の両方）、標準は 180mm のまま", () => {
    const css = readFileSync(resolve("src/app.css"), "utf8");
    // 画面外の基底には、改ページの目安の測る木（.graphium-print-measure）も同じ幅で並ぶ
    const rules = [
      ...css.matchAll(/#graphium-print-root\[data-paper="a4"\](?:,\s*\.graphium-print-measure\[data-paper="a4"\])? \{([^}]*)\}/g),
    ];
    expect(rules).toHaveLength(2);
    for (const r of rules) expect(r[1]).toMatch(/width:\s*170mm/);
    expect(css).toMatch(/#graphium-print-root,\s*\.graphium-print-measure \{[^}]*width: 180mm;/);
    expect(css).toMatch(/\.graphium-print-measure\[data-paper="a4"\] \{/);
    expect(css).toMatch(/width: 180mm !important;/);
  });

  it("印刷の 1 ページの本文の高さは 297mm - 余白 15mm × 2 = 267mm（約 1009px）", () => {
    // 改ページの回避（print-note の fitContentToPage）と目安の線が同じ値を使う。以前の 1030px は 267mm とずれていた
    expect(PRINT_PAGE_CONTENT_HEIGHT_PX).toBeCloseTo(1009.13, 2);
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
  it("本文枠（[data-label-wrapper]）があれば、PaperFrame の判定と同じ offsetWidth で測る", () => {
    const row = mk('<div data-label-wrapper><div data-paper-layout="sheet"></div></div>', 969);
    const pane = row.querySelector<HTMLElement>("[data-label-wrapper]")!;
    // 縦スクロールバー（約 15px）ぶん、根の実寸より本文枠の offsetWidth が広い
    Object.defineProperty(pane, "offsetWidth", { value: 984, configurable: true });
    expect(findPaperSheetWidth(row)).toBe(984);
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

describe("改ページの番号の置き場所", () => {
  const label = estimatePageNumberWidth("2 ページ");
  it("番号の幅の見積もり: 全角は字の大きさ、それ以外は 0.6 倍", () => {
    expect(estimatePageNumberWidth("ページ")).toBe(33);
    expect(estimatePageNumberWidth("Page 2")).toBe(Math.ceil(11 * 0.6 * 6));
  });
  it("右の机が番号の幅 + 余白（8px + 4px）に足りれば机に置く", () => {
    // 右の机 = (枠 - 用紙) / 2。1280px の枠で約 243px
    expect(resolvePageNumberPlacement(1280, label)).toBe("desk");
    // ちょうど足りる幅 / 1px 足りない幅
    const need = 8 + label + 4;
    expect(resolvePageNumberPlacement(PAPER_WIDTH_PX + need * 2, label)).toBe("desk");
    expect(resolvePageNumberPlacement(PAPER_WIDTH_PX + need * 2 - 2, label)).toBe("paper");
  });
  it("用紙がぎりぎり入る枠（右の机 12px）では用紙の右の余白に置く", () => {
    expect(resolvePageNumberPlacement(PAPER_MIN_FRAME_WIDTH_PX, label)).toBe("paper");
  });
  it("枠の幅が測れていないときは机に置く", () => {
    expect(resolvePageNumberPlacement(null, label)).toBe("desk");
    expect(resolvePageNumberPlacement(0, label)).toBe("desk");
    expect(resolvePageNumberPlacement(Number.NaN, label)).toBe("desk");
  });
});
