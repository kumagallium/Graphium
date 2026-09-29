// @vitest-environment jsdom
// use-resizable-width のテスト
// ドラッグ計算・clamp・localStorage 永続化・リセットを検証する。
// PointerEvent は jsdom に無いので、handleProps に素のイベント風オブジェクトを渡す。

import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type React from "react";
import {
  SIDE_PEEK_DEFAULT_WIDTH,
  SIDE_PEEK_DEFAULT_WIDTH_CAPPED,
  SIDE_PEEK_CONTAINER_RESERVE,
  RIGHT_PANEL_BODY_RESERVE,
  RIGHT_PANEL_CONTAINER_RESERVE,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH_CAPPED,
  RIGHT_PANEL_BODY_MIN_WIDTH,
  RIGHT_PANEL_FLEX_MIN_WIDTH,
  RIGHT_PANEL_FLOOR_WIDTH,
  SIDE_PEEK_INLINE_MIN_WIDTH,
  shouldOverlaySidePeek,
  RIGHT_PANEL_RAIL_WIDTH,
  resolveRightPanelDefaultWidth,
  shouldAutoOpenRightPanel,
  useResizableWidth,
  useRightPanelWidth,
} from "./use-resizable-width";

// React 18 の act() 警告を抑止（テストランナーが act 環境であることを明示）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "test-resizable-width";

const OPTS = { storageKey: KEY, min: 320, max: 800, containerReserve: 0 };

/**
 * パネル（親要素）幅つきの pointerdown イベント風オブジェクト。
 * containerWidth を渡すと「パネルを収めているコンテナ」も生やす。
 * 省略した場合は親コンテナが取れないケース（window.innerWidth への fallback）を模す。
 */
function downEvent(
  clientX: number,
  panelWidth: number,
  containerWidth?: number,
): React.PointerEvent<HTMLElement> {
  return {
    pointerType: "mouse",
    button: 0,
    clientX,
    pointerId: 1,
    currentTarget: {
      parentElement: {
        getBoundingClientRect: () => ({ width: panelWidth }),
        parentElement:
          containerWidth == null
            ? null
            : { getBoundingClientRect: () => ({ width: containerWidth }) },
      },
      setPointerCapture: () => {},
    },
    preventDefault: () => {},
  } as unknown as React.PointerEvent<HTMLElement>;
}

function moveEvent(clientX: number): React.PointerEvent<HTMLElement> {
  return { clientX } as unknown as React.PointerEvent<HTMLElement>;
}

const upEvent = () => ({}) as unknown as React.PointerEvent<HTMLElement>;

beforeEach(() => {
  localStorage.clear();
});

describe("useResizableWidth", () => {
  it("保存値が無ければ width は null（既定 CSS にフォールバック）", () => {
    const { result } = renderHook(() => useResizableWidth(OPTS));
    expect(result.current.width).toBeNull();
    expect(result.current.widthStyle).toBeUndefined();
  });

  it("保存値を復元し、min/max に clamp する", () => {
    localStorage.setItem(KEY, "600");
    const a = renderHook(() => useResizableWidth(OPTS));
    expect(a.result.current.width).toBe(600);

    localStorage.setItem(KEY, "5000");
    const b = renderHook(() => useResizableWidth(OPTS));
    expect(b.result.current.width).toBe(800);

    localStorage.setItem(KEY, "10");
    const c = renderHook(() => useResizableWidth(OPTS));
    expect(c.result.current.width).toBe(320);
  });

  it("不正な保存値は無視して null", () => {
    localStorage.setItem(KEY, "abc");
    const { result } = renderHook(() => useResizableWidth(OPTS));
    expect(result.current.width).toBeNull();
  });

  it("左へドラッグすると拡大し、pointerup で永続化する（右側パネル）", () => {
    const { result } = renderHook(() => useResizableWidth(OPTS));

    act(() => result.current.handleProps.onPointerDown(downEvent(500, 480)));
    expect(result.current.isResizing).toBe(true);

    act(() => result.current.handleProps.onPointerMove(moveEvent(400)));
    expect(result.current.width).toBe(580); // 480 + (500 - 400)

    act(() => result.current.handleProps.onPointerUp(upEvent()));
    expect(result.current.isResizing).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("580");
  });

  it("ドラッグ中も min/max に clamp する", () => {
    const { result } = renderHook(() => useResizableWidth(OPTS));

    act(() => result.current.handleProps.onPointerDown(downEvent(500, 480)));
    act(() => result.current.handleProps.onPointerMove(moveEvent(-1000)));
    expect(result.current.width).toBe(800);

    act(() => result.current.handleProps.onPointerMove(moveEvent(2000)));
    expect(result.current.width).toBe(320);
    act(() => result.current.handleProps.onPointerUp(upEvent()));
  });

  it("containerReserve があると実効最大幅が親コンテナ幅で頭打ちになる", () => {
    // コンテナ 1000px（サイドバーを除いたレイアウト領域を模す）
    const { result } = renderHook(() => useResizableWidth({ ...OPTS, containerReserve: 600 }));
    act(() => result.current.handleProps.onPointerDown(downEvent(500, 480, 1000)));
    act(() => result.current.handleProps.onPointerMove(moveEvent(-1000)));
    expect(result.current.width).toBe(1000 - 600); // max 800 より先にコンテナ制約
    act(() => result.current.handleProps.onPointerUp(upEvent()));
  });

  it("ビューポートではなくコンテナ幅を基準にする（サイドバー分を二重に引かない）", () => {
    // ビューポート 1280 / サイドバー 256 → コンテナ 1024。reserve 360 なら 664 まで許す。
    // ビューポート基準で数えていた頃は 1280-360=920 まで許してしまい、
    // 実際のエディタ領域は 1024-920=104px しか残らなかった。
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    const { result } = renderHook(() => useResizableWidth({ ...OPTS, containerReserve: 360 }));
    act(() => result.current.handleProps.onPointerDown(downEvent(900, 480, 1024)));
    act(() => result.current.handleProps.onPointerMove(moveEvent(-2000)));
    expect(result.current.width).toBe(664); // 1024 - 360
    act(() => result.current.handleProps.onPointerUp(upEvent()));
  });

  it("position: fixed のパネルは、親（行）ではなくビューポート幅を基準にする（重ね表示のピーク）", () => {
    // 行 597px（サイドバー開き）・ビューポート 853px。fixed の CSS 幅は 100%（= 853）基準なので、
    // 親の行を基準にすると 597 - 360 = 237 → 下限 320 に飛んでしまい、それを保存していた。
    Object.defineProperty(window, "innerWidth", { value: 853, configurable: true });
    const row = document.createElement("div");
    const panel = document.createElement("div");
    const handle = document.createElement("div");
    panel.style.position = "fixed";
    row.appendChild(panel);
    panel.appendChild(handle);
    document.body.appendChild(row);
    row.getBoundingClientRect = () => ({ width: 597 }) as DOMRect;
    panel.getBoundingClientRect = () => ({ width: 469 }) as DOMRect;
    handle.setPointerCapture = () => {};
    const ev = {
      pointerType: "mouse",
      button: 0,
      clientX: 400,
      pointerId: 1,
      currentTarget: handle,
      preventDefault: () => {},
    } as unknown as React.PointerEvent<HTMLElement>;

    const { result } = renderHook(() => useResizableWidth({ ...OPTS, containerReserve: 360 }));
    act(() => result.current.handleProps.onPointerDown(ev));
    // 1px 左へ: 幅は 470（320 に飛ばない）
    act(() => result.current.handleProps.onPointerMove(moveEvent(399)));
    expect(result.current.width).toBe(470);
    // 大きく左へ: 上限は ビューポート 853 - 360 = 493（CSS の calc(100% - 360px) と同じ）
    act(() => result.current.handleProps.onPointerMove(moveEvent(-2000)));
    expect(result.current.width).toBe(493);
    act(() => result.current.handleProps.onPointerUp(upEvent()));
    expect(localStorage.getItem(KEY)).toBe("493");

    // 同じ配置でも fixed でなければ親（行）基準のまま（inline 配置の従来の挙動。
    // 行 597 - 360 = 237 は最小 320 を割るので 320 で頭打ち）
    panel.style.position = "relative";
    const { result: r2 } = renderHook(() => useResizableWidth({ ...OPTS, containerReserve: 360 }));
    act(() => r2.current.handleProps.onPointerDown(ev));
    act(() => r2.current.handleProps.onPointerMove(moveEvent(-2000)));
    expect(r2.current.width).toBe(320);
    act(() => r2.current.handleProps.onPointerUp(upEvent()));
    row.remove();
  });

  it("親コンテナが取れなければ window.innerWidth に fallback する", () => {
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    const { result } = renderHook(() => useResizableWidth({ ...OPTS, containerReserve: 600 }));
    act(() => result.current.handleProps.onPointerDown(downEvent(500, 480)));
    act(() => result.current.handleProps.onPointerMove(moveEvent(-1000)));
    expect(result.current.width).toBe(1024 - 600);
    act(() => result.current.handleProps.onPointerUp(upEvent()));
  });

  it("pointerdown していなければ pointermove は無視される", () => {
    const { result } = renderHook(() => useResizableWidth(OPTS));
    act(() => result.current.handleProps.onPointerMove(moveEvent(100)));
    expect(result.current.width).toBeNull();
  });

  it("reset（ダブルクリック）で既定に戻り、保存値も消える", () => {
    localStorage.setItem(KEY, "600");
    const { result } = renderHook(() => useResizableWidth(OPTS));
    expect(result.current.width).toBe(600);

    act(() => result.current.handleProps.onDoubleClick());
    expect(result.current.width).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("widthStyle は containerReserve 付きだと CSS min() で上限を掛ける（100% 基準）", () => {
    localStorage.setItem(KEY, "600");
    const { result } = renderHook(() => useResizableWidth({ ...OPTS, containerReserve: 360 }));
    // 100vw ではなく 100%: inline 配置なら親コンテナ、overlay（fixed）ならビューポートが基準
    expect(result.current.widthStyle).toBe("min(600px, calc(100% - 360px))");
  });

  it("containerFloor があると、上限が下限を割り込むぶんは下限で受ける", () => {
    localStorage.setItem(KEY, "600");
    const { result } = renderHook(() =>
      useResizableWidth({ ...OPTS, containerReserve: 400, containerFloor: 300 }),
    );
    expect(result.current.widthStyle).toBe("min(600px, max(300px, calc(100% - 400px)))");
  });

  it("widthStyle は containerReserve 無しだと px 単位のみ", () => {
    localStorage.setItem(KEY, "600");
    const { result } = renderHook(() => useResizableWidth(OPTS));
    expect(result.current.widthStyle).toBe("600px");
  });
});

// 幅を保存していない inline サイドピークの既定幅（E-7）。
// CSS の min / max / clamp / calc を、この式が使う範囲だけ JS に読み替えて評価する。
describe("サイドピークの既定幅", () => {
  /** viewport = ビューポート幅（vw の基準）、container = 親コンテナ幅（% の基準） */
  function evalWidth(expr: string, viewport: number, container: number): number {
    const js = expr
      .replace(/calc\(100% - (\d+)px\)/g, (_m, n) => `(${container} - ${n})`)
      .replace(/(\d+(?:\.\d+)?)vw/g, (_m, n) => `(${viewport} * ${n} / 100)`)
      .replace(/(\d+(?:\.\d+)?)px/g, "$1")
      .replace(/\bclamp\(/g, "__clamp(")
      .replace(/\bmin\(/g, "Math.min(")
      .replace(/\bmax\(/g, "Math.max(");
    const __clamp = (lo: number, v: number, hi: number) => Math.min(Math.max(lo, v), hi);
    return new Function("__clamp", `return ${js};`)(__clamp) as number;
  }
  const SIDEBAR = 256;

  it("広い画面ではノートのサイドピークと同じ幅（上限 480px）", () => {
    for (const vw of [1280, 1600, 1920]) {
      expect(evalWidth(SIDE_PEEK_DEFAULT_WIDTH_CAPPED, vw, vw - SIDEBAR)).toBe(
        evalWidth(SIDE_PEEK_DEFAULT_WIDTH, vw, vw - SIDEBAR),
      );
    }
    expect(evalWidth(SIDE_PEEK_DEFAULT_WIDTH_CAPPED, 1920, 1920 - SIDEBAR)).toBe(480);
  });

  it("狭い画面では素材一覧に 360px 近くを残す（853px で 117px まで潰れていた）", () => {
    // 960px: 一覧 = 704 - ピーク。以前は 224px、直すと 360px 前後
    const w960 = evalWidth(SIDE_PEEK_DEFAULT_WIDTH_CAPPED, 960, 960 - SIDEBAR);
    expect(960 - SIDEBAR - w960).toBeGreaterThanOrEqual(SIDE_PEEK_CONTAINER_RESERVE - 1);
    // 853px: 最小幅 320px で止まり、一覧は 597 - 320 = 277px（以前 117px）
    const w853 = evalWidth(SIDE_PEEK_DEFAULT_WIDTH_CAPPED, 853, 853 - SIDEBAR);
    expect(w853).toBe(320);
    expect(853 - SIDEBAR - w853).toBeGreaterThan(117);
  });

  it("上限が最小幅（320px）を割り込ませない", () => {
    expect(evalWidth(SIDE_PEEK_DEFAULT_WIDTH_CAPPED, 700, 700 - SIDEBAR)).toBe(320);
  });
});

// 右パネル（ステップ / グラフ / チャットなど）の既定幅と自動オープンの判定。
describe("右パネルの既定幅", () => {
  function evalWidth(expr: string, viewport: number, container: number): number {
    const js = expr
      .replace(/calc\(100% - (\d+)px\)/g, (_m, n) => `(${container} - ${n})`)
      .replace(/(\d+(?:\.\d+)?)vw/g, (_m, n) => `(${viewport} * ${n} / 100)`)
      .replace(/(\d+(?:\.\d+)?)px/g, "$1")
      .replace(/\bclamp\(/g, "__clamp(")
      .replace(/\bmin\(/g, "Math.min(")
      .replace(/\bmax\(/g, "Math.max(");
    const __clamp = (lo: number, v: number, hi: number) => Math.min(Math.max(lo, v), hi);
    return new Function("__clamp", `return ${js};`)(__clamp) as number;
  }
  const SIDEBAR = 256;

  it("1600px 幅以上は従来どおり 480px、1280px 幅（Windows 既定）で約 384px", () => {
    expect(evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 1600, 1600 - SIDEBAR)).toBe(480);
    expect(evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 1920, 1920 - SIDEBAR)).toBe(480);
    const w1280 = evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 1280, 1280 - SIDEBAR);
    expect(w1280).toBeCloseTo(384, 5);
    // 本文 = コンテナ - レール - パネル = 600px（480px 固定だった以前は 504px）
    expect(1280 - SIDEBAR - RIGHT_PANEL_RAIL_WIDTH - w1280).toBeGreaterThanOrEqual(600);
  });

  it("狭い画面でも本文（コンテナ - レール - パネル）が 360px を割らない", () => {
    // 1024px: パネルは下限 320px、本文 408px（以前は 248px）
    expect(evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 1024, 1024 - SIDEBAR)).toBe(320);
    // 900px（コンテナ 644）: 本文 360px を守れる限りパネルが縮む（上限 244px は下限 300px を割る
    // ので 300px。本文は 644 - 40 - 300 = 304px まで譲る）
    expect(evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 900, 900 - SIDEBAR)).toBe(RIGHT_PANEL_FLOOR_WIDTH);
    // 上限が下限を超えるコンテナ（700 - 400 = 300 を超える幅）では上限のとおり
    expect(evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 960, 720)).toBe(320);
    expect(evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 1000, 700)).toBe(300);
  });

  it("853px 幅（サイドバー開き・コンテナ 597）でもパネルは 300px を割らない（以前は 197px）", () => {
    const w853 = evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 853, 853 - SIDEBAR);
    expect(w853).toBe(RIGHT_PANEL_FLOOR_WIDTH);
    expect(w853).toBeGreaterThan(197);
    // 本文は 360px を割ってよい（597 - 40 - 300 = 257px）
    expect(853 - SIDEBAR - RIGHT_PANEL_RAIL_WIDTH - w853).toBe(257);
  });

  it("本文の min-width は、パネルの下限を残せない幅では 360px より譲る", () => {
    // 広いとき: 360px
    expect(evalWidth(RIGHT_PANEL_BODY_MIN_WIDTH, 1280, 1024)).toBe(RIGHT_PANEL_BODY_RESERVE);
    // 597px: 597 - 40 - 300 = 257px。本文 + パネル + レールがちょうど行に収まる（行から溢れない）
    const body = evalWidth(RIGHT_PANEL_BODY_MIN_WIDTH, 853, 597);
    expect(body).toBe(257);
    expect(body + evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 853, 597) + RIGHT_PANEL_RAIL_WIDTH).toBe(597);
  });

  it("min-width（FLEX_MIN）は width（CAPPED）を上回らない: どの幅でも絶対の下限 300px", () => {
    for (const container of [1400, 1024, 720, 700, 640, 597, 500]) {
      const min = evalWidth(RIGHT_PANEL_FLEX_MIN_WIDTH, 1280, container);
      const width = evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 1280, container);
      expect(min).toBeLessThanOrEqual(width);
      expect(min).toBeGreaterThanOrEqual(RIGHT_PANEL_FLOOR_WIDTH);
    }
    expect(evalWidth(RIGHT_PANEL_FLEX_MIN_WIDTH, 1280, 1024)).toBe(RIGHT_PANEL_FLOOR_WIDTH);
    expect(evalWidth(RIGHT_PANEL_FLEX_MIN_WIDTH, 853, 597)).toBe(RIGHT_PANEL_FLOOR_WIDTH);
  });

  it("上限なしの式は clamp(320px, 30vw, 480px)", () => {
    expect(RIGHT_PANEL_DEFAULT_WIDTH).toBe("clamp(320px, 30vw, 480px)");
    expect(resolveRightPanelDefaultWidth(1280)).toBeCloseTo(384, 5);
    expect(resolveRightPanelDefaultWidth(853)).toBe(320);
    expect(resolveRightPanelDefaultWidth(2560)).toBe(480);
  });
});

describe("shouldAutoOpenRightPanel", () => {
  it("開いた後に本文が 360px 以上残るときだけ開く（境界を含む）", () => {
    // コンテナ 1024（1280px 幅からサイドバー 256px を引いた行）・既定 384px → 本文 600px
    expect(shouldAutoOpenRightPanel(1024, 384)).toBe(true);
    // 本文がちょうど 360px
    expect(shouldAutoOpenRightPanel(360 + RIGHT_PANEL_RAIL_WIDTH + 384, 384)).toBe(true);
    expect(shouldAutoOpenRightPanel(360 + RIGHT_PANEL_RAIL_WIDTH + 384 - 1, 384)).toBe(false);
  });

  it("1024px 幅は開く（本文 408px）、853px 幅は開かない（本文 237px）", () => {
    expect(shouldAutoOpenRightPanel(1024 - 256, resolveRightPanelDefaultWidth(1024))).toBe(true);
    expect(shouldAutoOpenRightPanel(853 - 256, resolveRightPanelDefaultWidth(853))).toBe(false);
  });

  it("保存済みの広い幅なら、広い画面でも開かない", () => {
    expect(shouldAutoOpenRightPanel(1024, 700)).toBe(false);
  });

  it("サイドピークが開いているときは、その実寸も差し引く", () => {
    // 1280px 幅（行 1024）・既定 384px。ピーク 480px だと本文は 120px → 開かない
    expect(shouldAutoOpenRightPanel(1024, 384, 480)).toBe(false);
    // ピークが無い（0 / 省略 / 非有限）なら従来どおり
    expect(shouldAutoOpenRightPanel(1024, 384, 0)).toBe(true);
    expect(shouldAutoOpenRightPanel(1024, 384, Number.NaN)).toBe(true);
    // ちょうど 360px 残る境界
    expect(shouldAutoOpenRightPanel(360 + 40 + 300 + 384, 384, 300)).toBe(true);
    expect(shouldAutoOpenRightPanel(360 + 40 + 300 + 384 - 1, 384, 300)).toBe(false);
  });

  it("行の幅が測れないとき（jsdom など）は従来どおり開く", () => {
    expect(shouldAutoOpenRightPanel(0, 480)).toBe(true);
    expect(shouldAutoOpenRightPanel(Number.NaN, 480)).toBe(true);
  });
});

describe("useRightPanelWidth", () => {
  it("右パネル専用のキーで覚え、サイドピークの幅とは別", () => {
    localStorage.setItem("graphium-sidepeek-width", "700");
    const a = renderHook(() => useRightPanelWidth());
    expect(a.result.current.width).toBeNull();
    expect(a.result.current.widthStyle).toBeUndefined();

    localStorage.setItem("graphium-right-panel-width", "600");
    const b = renderHook(() => useRightPanelWidth());
    expect(b.result.current.width).toBe(600);
    // 本文 360px + レール 40px を残す上限が CSS にも掛かる。上限が下限 300px を割るなら 300px
    expect(b.result.current.widthStyle).toBe(
      `min(600px, max(${RIGHT_PANEL_FLOOR_WIDTH}px, calc(100% - ${RIGHT_PANEL_CONTAINER_RESERVE}px)))`,
    );
  });

  it("最小 320 / 最大 800 に収まり、ドラッグで広げても本文 400px 分（360 + レール）を残す", () => {
    const { result } = renderHook(() => useRightPanelWidth());
    act(() => result.current.handleProps.onPointerDown(downEvent(1000, 384, 900)));
    // 左へ大きくドラッグ → コンテナ 900 - 400 = 500 で頭打ち
    act(() => result.current.handleProps.onPointerMove(moveEvent(0)));
    expect(result.current.width).toBe(500);
    act(() => result.current.handleProps.onPointerUp(upEvent()));
    expect(localStorage.getItem("graphium-right-panel-width")).toBe("500");
    // ダブルクリックで既定に戻る
    act(() => result.current.handleProps.onDoubleClick());
    expect(result.current.width).toBeNull();
    expect(localStorage.getItem("graphium-right-panel-width")).toBeNull();
  });
});

// 本文・サイドピーク・右パネル・レールが同じ行に並んだときの幅の配分。
// flex の縮み（基準幅に比例・min-width で止まったら残りへ再配分）を、この配置が使う範囲だけ再現する。
describe("右パネルとサイドピークの同時表示", () => {
  const BODY_MIN = RIGHT_PANEL_BODY_RESERVE;
  const RAIL = RIGHT_PANEL_RAIL_WIDTH;
  const PANEL_MIN = RIGHT_PANEL_FLOOR_WIDTH;
  const PEEK_MIN = SIDE_PEEK_INLINE_MIN_WIDTH;

  /**
   * 本文（min 360・伸びるだけ）とレール（固定 40）を除いた残りを、ピークとパネルが縮んで分ける。
   * flex-shrink: 各項目は「基準幅 × 縮み率（どちらも 1）」に比例して縮み、min-width を割った項目は
   * そこで止まって、不足を残りの項目が引き受ける（CSS Flexbox の解決を 2 項目に簡略化したもの）。
   */
  function share(row: number, peekBasis: number, panelBasis: number) {
    const free = row - BODY_MIN - RAIL;
    const overflow = peekBasis + panelBasis - free;
    if (overflow <= 0) return { peek: peekBasis, panel: panelBasis };
    let peek = peekBasis - (overflow * peekBasis) / (peekBasis + panelBasis);
    let panel = panelBasis - (overflow * panelBasis) / (peekBasis + panelBasis);
    if (panel < PANEL_MIN) {
      panel = PANEL_MIN;
      peek = free - panel;
    } else if (peek < PEEK_MIN) {
      peek = PEEK_MIN;
      panel = free - peek;
    }
    return { peek, panel };
  }

  it("min-width はパネルもピークも 300px（0 に潰れない）", () => {
    expect(RIGHT_PANEL_FLEX_MIN_WIDTH).toBe("300px");
    expect(SIDE_PEEK_INLINE_MIN_WIDTH).toBe(300);
  });

  it("パネルを広げて覚えていても、inline と判定された行ではどちらも 300px を割らない", () => {
    // 行 1024（1280px 幅）: 指摘の再現。パネル保存幅 600・ピーク既定 480 → 比例だけだとピーク約 277px
    // だったが、ピークに下限を付けたので 300px で止まる
    for (const [peekBasis, panelBasis] of [
      [480, 384],
      [480, 600],
      [320, 624],
      [800, 800],
    ]) {
      const { peek, panel } = share(1024, peekBasis, panelBasis);
      expect(peek).toBeGreaterThanOrEqual(PEEK_MIN);
      expect(panel).toBeGreaterThanOrEqual(PANEL_MIN);
      expect(BODY_MIN + peek + panel + RAIL).toBe(1024);
    }
    // 判定の境界（行 1000px = 360 + 40 + 300 + 300）でも収まる
    const edge = share(1000, 800, 800);
    expect(edge).toEqual({ peek: 300, panel: 300 });
  });

  it("1280px 幅の既定（ピーク 480・パネル 384）は、パネル 300 / ピーク 324 で余裕を持って収まる", () => {
    const { peek, panel } = share(1024, 480, 384);
    expect(panel).toBe(300);
    expect(peek).toBe(324);
    expect(shouldOverlaySidePeek(1024, true)).toBe(false);
    // 行の実寸が 20px 削れても（縦スクロールバーや境界線）inline のまま
    expect(shouldOverlaySidePeek(1024 - 20, true)).toBe(false);
  });

  it("行 597px（853px 幅でサイドバー開き）では、ピークは重ねて出すのでパネルが 300px を保つ", () => {
    expect(shouldOverlaySidePeek(597, true)).toBe(true);
    // 重ねて出すとピークは行の幅を取らない。本文は 597 - 40 - 300 = 257px まで譲る
    expect(597 - RAIL - RIGHT_PANEL_FLOOR_WIDTH).toBe(257);
  });

  it("余裕があれば（行 1400px）どちらも縮まない", () => {
    expect(share(1400, 480, 384)).toEqual({ peek: 480, panel: 384 });
  });
});

// サイドピークを並べる（inline）か重ねる（overlay）かの判定。
describe("shouldOverlaySidePeek", () => {
  const SIDEBAR = 256;
  const row = (viewport: number) => viewport - SIDEBAR;

  it("1280px 幅（Windows 既定）で右パネルを開いたままでも inline のまま（余裕 24px）", () => {
    // 1024 - レール 40 - 本文 360 - パネル下限 300 = 324px ≥ ピーク下限 300px
    expect(row(1280) - RIGHT_PANEL_RAIL_WIDTH - RIGHT_PANEL_BODY_RESERVE - RIGHT_PANEL_FLOOR_WIDTH).toBe(324);
    expect(shouldOverlaySidePeek(row(1280), true)).toBe(false);
  });

  it("1164px 幅で右パネルを開いているときは重ねて出す（ピークが 208px まで潰れる）", () => {
    expect(shouldOverlaySidePeek(row(1164), true)).toBe(true);
  });

  it("右パネルを閉じているときは 1164px 幅でも 1024px 幅でも inline", () => {
    expect(shouldOverlaySidePeek(row(1164), false)).toBe(false);
    expect(shouldOverlaySidePeek(row(1024), false)).toBe(false);
  });

  it("右パネルを閉じていても、853px 幅（行 597）では重ねて出す（本文が 197px になる）", () => {
    expect(shouldOverlaySidePeek(row(853), false)).toBe(true);
  });

  it("パネル閉でも本文 360px を保証する: 960px 幅（行 704）は inline、行 699 は重ねる", () => {
    // 指摘の再現: ピーク既定 365px だと本文 299px になるが、inline のピークは 300px まで縮み、
    // 本文の min-width が 360px を守る（note-app）。だから 704 で inline にしてよい
    expect(shouldOverlaySidePeek(row(960), false)).toBe(false);
    expect(shouldOverlaySidePeek(699, false)).toBe(true);
    expect(shouldOverlaySidePeek(700, false)).toBe(false);
  });

  it("境界: 行の幅がちょうど 本文 + レール + パネルの下限 + ピークの下限 のとき inline", () => {
    const need =
      RIGHT_PANEL_BODY_RESERVE + RIGHT_PANEL_RAIL_WIDTH + RIGHT_PANEL_FLOOR_WIDTH + SIDE_PEEK_INLINE_MIN_WIDTH;
    expect(need).toBe(1000);
    expect(shouldOverlaySidePeek(need, true)).toBe(false);
    expect(shouldOverlaySidePeek(need - 1, true)).toBe(true);
    const needNoPanel = need - RIGHT_PANEL_FLOOR_WIDTH;
    expect(shouldOverlaySidePeek(needNoPanel, false)).toBe(false);
    expect(shouldOverlaySidePeek(needNoPanel - 1, false)).toBe(true);
  });

  it("行の幅が測れない（0・NaN。jsdom など）ときは inline のまま", () => {
    expect(shouldOverlaySidePeek(0, true)).toBe(false);
    expect(shouldOverlaySidePeek(Number.NaN, true)).toBe(false);
  });
});
