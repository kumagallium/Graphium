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

const OPTS = { storageKey: KEY, min: 320, max: 800, viewportReserve: 0 };

/** パネル（親要素）幅つきの pointerdown イベント風オブジェクト */
function downEvent(clientX: number, panelWidth: number): React.PointerEvent<HTMLElement> {
  return {
    pointerType: "mouse",
    button: 0,
    clientX,
    pointerId: 1,
    currentTarget: {
      parentElement: { getBoundingClientRect: () => ({ width: panelWidth }) },
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

  it("viewportReserve があると実効最大幅がビューポートで頭打ちになる", () => {
    // jsdom の window.innerWidth は既定 1024
    const { result } = renderHook(() =>
      useResizableWidth({ ...OPTS, viewportReserve: 600 }),
    );
    act(() => result.current.handleProps.onPointerDown(downEvent(500, 480)));
    act(() => result.current.handleProps.onPointerMove(moveEvent(-1000)));
    expect(result.current.width).toBe(1024 - 600); // max 800 より先に viewport 制約
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

  it("widthStyle は viewportReserve 付きだと CSS min() で上限を掛ける", () => {
    localStorage.setItem(KEY, "600");
    const { result } = renderHook(() =>
      useResizableWidth({ ...OPTS, viewportReserve: 360 }),
    );
    expect(result.current.widthStyle).toBe("min(600px, calc(100vw - 360px))");
  });

  it("widthStyle は viewportReserve 無しだと px 単位のみ", () => {
    localStorage.setItem(KEY, "600");
    const { result } = renderHook(() => useResizableWidth(OPTS));
    expect(result.current.widthStyle).toBe("600px");
  });
});
