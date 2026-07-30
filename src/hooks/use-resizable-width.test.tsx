// @vitest-environment jsdom
// use-resizable-width のテスト
// ドラッグ計算・clamp・localStorage 永続化・リセットを検証する。
// PointerEvent は jsdom に無いので、handleProps に素のイベント風オブジェクトを渡す。

import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type React from "react";
import { useResizableWidth } from "./use-resizable-width";

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
