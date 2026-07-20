// パネル幅のドラッグリサイズ用フック
// 右側パネル（SidePeek 等）の左端にハンドルを置く想定: 左へドラッグ = 拡大。
// 幅は localStorage に永続化する。未カスタム時は null / undefined を返し、
// 呼び出し側が従来どおりの既定 CSS 幅にフォールバックする（既存挙動を壊さない）。

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

export type ResizableWidthOptions = {
  /** 永続化キー（localStorage） */
  storageKey: string;
  /** 最小幅 px */
  min: number;
  /** 最大幅 px */
  max: number;
  /**
   * ビューポートから反対側（メインコンテンツ側）に確保しておく幅 px。
   * ドラッグ中の実効最大幅 = min(max, ビューポート幅 - viewportReserve)。
   * widthStyle も CSS の min() で同じ上限を適用するため、
   * 広い画面で保存した幅が狭いウィンドウでメインを潰すことはない。
   */
  viewportReserve?: number;
};

/** ResizeHandle にそのままスプレッドするイベントハンドラ群 */
export type ResizeHandleProps = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
};

export type ResizableWidth = {
  /** カスタム幅 px。null = 未カスタム */
  width: number | null;
  /** ドラッグ中か */
  isResizing: boolean;
  /** コンテナに適用する width スタイル値。未カスタム時は undefined */
  widthStyle: string | undefined;
  handleProps: ResizeHandleProps;
  /** カスタム幅を破棄して既定に戻す（ハンドルのダブルクリックと同じ） */
  reset: () => void;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function loadStoredWidth(storageKey: string, min: number, max: number): number | null {
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

export function useResizableWidth({
  storageKey,
  min,
  max,
  viewportReserve = 0,
}: ResizableWidthOptions): ResizableWidth {
  const [width, setWidth] = useState<number | null>(() => loadStoredWidth(storageKey, min, max));
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const persist = useCallback(
    (value: number | null) => {
      try {
        if (value == null) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, String(value));
      } catch {
        // localStorage が使えない環境では永続化のみ諦める（セッション内では機能する）
      }
    },
    [storageKey],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // マウスは主ボタンのみ。タッチ / ペンはそのまま受ける
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // ハンドルはリサイズ対象パネルの直下に置く前提（親要素の実測幅を起点にする）
      const panel = (e.currentTarget as HTMLElement).parentElement;
      const startWidth = panel?.getBoundingClientRect().width ?? widthRef.current ?? min;
      dragRef.current = { startX: e.clientX, startWidth };
      // capture 中は pointermove/up がハンドル要素へ飛び続けるので window リスナー不要
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setIsResizing(true);
      // ネイティブのテキスト選択開始を抑止
      e.preventDefault();
    },
    [min],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // 右側パネル: 左へドラッグ（clientX 減少）で拡大
      const delta = drag.startX - e.clientX;
      const viewport = typeof window === "undefined" ? max + viewportReserve : window.innerWidth;
      const effectiveMax = Math.max(min, Math.min(max, viewport - viewportReserve));
      setWidth(clamp(Math.round(drag.startWidth + delta), min, effectiveMax));
    },
    [min, max, viewportReserve],
  );

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsResizing(false);
    persist(widthRef.current);
  }, [persist]);

  const onPointerUp = useCallback(() => endDrag(), [endDrag]);

  const reset = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    setWidth(null);
    persist(null);
  }, [persist]);

  // ドラッグ中はテキスト選択を止め、カーソルを列リサイズに固定
  useEffect(() => {
    if (!isResizing) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isResizing]);

  const widthStyle =
    width == null
      ? undefined
      : viewportReserve > 0
        ? `min(${width}px, calc(100vw - ${viewportReserve}px))`
        : `${width}px`;

  return {
    width,
    isResizing,
    widthStyle,
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

// ---- SidePeek（ノート / 素材）共通プリセット ------------------------------
// ノート SidePeek と MaterialSidePeek は「サイドピーク」という同じ UI 概念の
// 並行実装なので、幅の記憶も 1 つのキーで共有する（片方で広げれば次に開く方も広い）。

export const SIDE_PEEK_WIDTH_STORAGE_KEY = "graphium-sidepeek-width";
export const SIDE_PEEK_MIN_WIDTH = 320;
export const SIDE_PEEK_MAX_WIDTH = 800;
/** エディタ側に最低限残す幅 px。inline 表示はデスクトップ（768px〜）限定なので常に成立する */
export const SIDE_PEEK_VIEWPORT_RESERVE = 360;

export function useSidePeekWidth(): ResizableWidth {
  return useResizableWidth({
    storageKey: SIDE_PEEK_WIDTH_STORAGE_KEY,
    min: SIDE_PEEK_MIN_WIDTH,
    max: SIDE_PEEK_MAX_WIDTH,
    viewportReserve: SIDE_PEEK_VIEWPORT_RESERVE,
  });
}
