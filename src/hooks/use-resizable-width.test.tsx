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
    // 853px: 上限が下限を割り込むぶんはパネルが縮み、本文 360px を守る
    const w853 = evalWidth(RIGHT_PANEL_DEFAULT_WIDTH_CAPPED, 853, 853 - SIDEBAR);
    expect(w853).toBe(853 - SIDEBAR - RIGHT_PANEL_CONTAINER_RESERVE);
    expect(853 - SIDEBAR - RIGHT_PANEL_RAIL_WIDTH - w853).toBe(RIGHT_PANEL_BODY_RESERVE);
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
    // 本文 360px + レール 40px を残す上限が CSS にも掛かる
    expect(b.result.current.widthStyle).toBe(
      `min(600px, calc(100% - ${RIGHT_PANEL_CONTAINER_RESERVE}px))`,
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
