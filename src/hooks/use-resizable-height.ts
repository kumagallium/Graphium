// パネル高さのドラッグリサイズ用フック（use-resizable-width の縦方向版）
// 下側パネルの上端にハンドルを置く想定: 上へドラッグ = 拡大。
// 高さは localStorage に永続化する。未カスタム時は null / undefined を返し、
// 呼び出し側が既定の CSS 高さ（% など）にフォールバックする。

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { ResizeHandleProps } from "./use-resizable-width";

export type ResizableHeightOptions = {
  /** 永続化キー（localStorage） */
  storageKey: string;
  /** 最小高さ px */
  min: number;
  /** 最大高さ px */
  max: number;
  /**
   * 反対側（グラフ側）に確保しておく高さ px。
   * ドラッグ中の実効最大高さ = min(max, 親コンテナ高さ - containerReserve)。
   * heightStyle も CSS の min() / 100% で同じ上限を適用する。
   */
  containerReserve?: number;
};

export type ResizableHeight = {
  /** カスタム高さ px。null = 未カスタム */
  height: number | null;
  isResizing: boolean;
  /** コンテナに適用する height スタイル値。未カスタム時は undefined */
  heightStyle: string | undefined;
  handleProps: ResizeHandleProps;
  reset: () => void;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function loadStored(storageKey: string, min: number, max: number): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return clamp(Math.round(parsed), min, max);
  } catch {
    return null;
  }
}

export function useResizableHeight({
  storageKey,
  min,
  max,
  containerReserve = 0,
}: ResizableHeightOptions): ResizableHeight {
  const [height, setHeight] = useState<number | null>(() => loadStored(storageKey, min, max));
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number; containerHeight: number } | null>(
    null,
  );
  const heightRef = useRef(height);
  heightRef.current = height;

  const persist = useCallback(
    (value: number | null) => {
      try {
        if (value == null) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, String(value));
      } catch {
        // localStorage が使えない環境では永続化のみ諦める
      }
    },
    [storageKey],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // ハンドルはリサイズ対象パネルの直下に置く前提（親要素の実測高さを起点にする）
      const panel = (e.currentTarget as HTMLElement).parentElement;
      const startHeight = panel?.getBoundingClientRect().height ?? heightRef.current ?? min;
      const containerHeight =
        panel?.parentElement?.getBoundingClientRect().height ??
        (typeof window === "undefined" ? max + containerReserve : window.innerHeight);
      dragRef.current = { startY: e.clientY, startHeight, containerHeight };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setIsResizing(true);
      e.preventDefault();
    },
    [min, max, containerReserve],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // 下側パネル: 上へドラッグ（clientY 減少）で拡大
      const delta = drag.startY - e.clientY;
      const effectiveMax = Math.max(min, Math.min(max, drag.containerHeight - containerReserve));
      setHeight(clamp(Math.round(drag.startHeight + delta), min, effectiveMax));
    },
    [min, max, containerReserve],
  );

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsResizing(false);
    persist(heightRef.current);
  }, [persist]);

  const onPointerUp = useCallback(() => endDrag(), [endDrag]);

  const reset = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    setHeight(null);
    persist(null);
  }, [persist]);

  useEffect(() => {
    if (!isResizing) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isResizing]);

  const heightStyle =
    height == null
      ? undefined
      : containerReserve > 0
        ? `min(${height}px, calc(100% - ${containerReserve}px))`
        : `${height}px`;

  return {
    height,
    isResizing,
    heightStyle,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: reset,
    },
    reset,
  };
}
