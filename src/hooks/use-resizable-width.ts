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
   * 反対側（メインコンテンツ側）に確保しておく幅 px。
   * ドラッグ中の実効最大幅 = min(max, パネルの親コンテナ幅 - containerReserve)。
   * widthStyle も CSS の min() / 100% で同じ上限を適用するため、
   * 広い画面で保存した幅が狭いウィンドウでメインを潰すことはない。
   *
   * 基準はビューポートではなく「パネルの親コンテナ」であることに注意。
   * inline 配置の SidePeek はサイドバーの隣に並ぶので、ビューポート基準だと
   * サイドバー幅（256px）が二重に使われてメイン側が想定より細る。
   * position: fixed のパネル（overlay・重ね表示のピーク）は、CSS の 100% がビューポート基準に
   * なるので、ドラッグの基準もビューポート幅にする（親要素の実寸ではない）。
   */
  containerReserve?: number;
  /**
   * 親コンテナ基準の上限（コンテナ − containerReserve）に掛ける下限 px。
   * 未指定（0）なら下限なしで、狭いコンテナでは上限がそのまま幅になる（従来どおり）。
   * 指定すると widthStyle は min(幅, max(下限, コンテナ − 予約幅)) になり、反対側（本文）を
   * 優先しつつも、パネルがこの幅より細くならない（中身が 1 文字ずつ折れる幅を避ける）。
   * ドラッグ中の実効最大幅は min（最小幅）が下限を兼ねるので、この値は widthStyle だけに効く。
   */
  containerFloor?: number;
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
  containerReserve = 0,
  containerFloor = 0,
}: ResizableWidthOptions): ResizableWidth {
  const [width, setWidth] = useState<number | null>(() => loadStoredWidth(storageKey, min, max));
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number; containerWidth: number } | null>(
    null,
  );
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
      // 実効最大幅の基準はパネルの CSS 幅（widthStyle の 100%）が基準にする箱と同じにする:
      //   - inline（flex item）: DOM 上の親＝サイドバーを除いたレイアウト領域
      //   - position: fixed（overlay / 本文の隣に並べず重ねて出すピーク）: ビューポート。
      //     fixed の 100% は DOM 上の親ではなくビューポート基準なので、親（行）の実寸を使うと
      //     JS の上限だけが CSS より狭くなり、少し動かしただけで幅が下限まで飛ぶ
      //     （行 597px・ビューポート 853px のとき 469px → 320px に飛んで、それを保存していた）。
      // 従来の portal の overlay は親が body だったので、この差は表に出なかった。
      const isFixed =
        typeof window !== "undefined" &&
        panel instanceof HTMLElement &&
        window.getComputedStyle(panel).position === "fixed";
      const containerWidth = isFixed
        ? window.innerWidth
        : panel?.parentElement?.getBoundingClientRect().width ??
          (typeof window === "undefined" ? max + containerReserve : window.innerWidth);
      dragRef.current = { startX: e.clientX, startWidth, containerWidth };
      // capture 中は pointermove/up がハンドル要素へ飛び続けるので window リスナー不要
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setIsResizing(true);
      // ネイティブのテキスト選択開始を抑止
      e.preventDefault();
    },
    [min, max, containerReserve],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // 右側パネル: 左へドラッグ（clientX 減少）で拡大
      const delta = drag.startX - e.clientX;
      const effectiveMax = Math.max(min, Math.min(max, drag.containerWidth - containerReserve));
      setWidth(clamp(Math.round(drag.startWidth + delta), min, effectiveMax));
    },
    [min, max, containerReserve],
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

  // 100vw ではなく 100% を使う。inline 配置では親コンテナ（サイドバーを除いた
  // レイアウト領域）が基準になり、overlay 配置（position: fixed）では包含ブロックが
  // ビューポートになるので、1 つの式で両方の配置に正しい上限が掛かる。
  const widthStyle =
    width == null
      ? undefined
      : containerReserve > 0
        ? containerFloor > 0
          ? `min(${width}px, max(${containerFloor}px, calc(100% - ${containerReserve}px)))`
          : `min(${width}px, calc(100% - ${containerReserve}px))`
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
/**
 * エディタ側に最低限残す幅 px。inline 表示はデスクトップ（768px〜）限定なので常に成立する。
 * 基準はパネルの親コンテナ幅なので、サイドバー（256px）はここに含めない。
 * Windows の既定スケーリング 150% では 1080p でも論理幅が 1280px しかなく、
 * ビューポート基準で数えるとエディタが 224px まで潰れていた。
 */
export const SIDE_PEEK_CONTAINER_RESERVE = 360;

/**
 * 幅を保存していないときの inline 表示の既定幅。ノート SidePeek の既定と同じ式で、
 * ビューポート幅に応じて 320〜480px の範囲で伸縮する。
 */
export const SIDE_PEEK_DEFAULT_WIDTH = "clamp(320px, 38vw, 480px)";

/**
 * 上の既定幅に、保存幅と同じ「親コンテナ幅 − SIDE_PEEK_CONTAINER_RESERVE」の上限を掛けた式。
 * 既定だけ上限が無いと、狭いウィンドウでは一緒に並ぶ側（素材一覧）が数十 px まで潰れて、
 * ヘッダーのボタンがピークの下に隠れる（853px 幅で一覧 117px）。
 * ノートの SidePeek と共有ビューの既定は上限なしのまま（素材一覧のように固定列を持つ
 * 一緒に並ぶ側が無く、差は実測で 21px 以内）。素材ピークだけがこの式を使う。
 * 上限が最小幅（320px）を割り込まないよう max で受ける（useResizableWidth の
 * effectiveMax と同じ扱い）。
 */
export const SIDE_PEEK_DEFAULT_WIDTH_CAPPED = `min(${SIDE_PEEK_DEFAULT_WIDTH}, max(${SIDE_PEEK_MIN_WIDTH}px, calc(100% - ${SIDE_PEEK_CONTAINER_RESERVE}px)))`;

export function useSidePeekWidth(): ResizableWidth {
  return useResizableWidth({
    storageKey: SIDE_PEEK_WIDTH_STORAGE_KEY,
    min: SIDE_PEEK_MIN_WIDTH,
    max: SIDE_PEEK_MAX_WIDTH,
    containerReserve: SIDE_PEEK_CONTAINER_RESERVE,
  });
}

// ---- 右パネル（ステップ / グラフ / チャット / 履歴 / メモ など）プリセット --------
// ノート編集画面の右側に開くパネル。サイドピークとは別物なので、幅の記憶も別のキーで持つ
// （ピークを広げても右パネルは広がらない）。

export const RIGHT_PANEL_WIDTH_STORAGE_KEY = "graphium-right-panel-width";
export const RIGHT_PANEL_MIN_WIDTH = 320;
export const RIGHT_PANEL_MAX_WIDTH = 800;
/** 本文（エディタ枠）に最低限残す幅 px。サイドピークの SIDE_PEEK_CONTAINER_RESERVE と同じ値。 */
export const RIGHT_PANEL_BODY_RESERVE = 360;
/**
 * 右パネルの右隣に並ぶアイコンレールの幅 px（note-app の w-10）。
 * レールはパネルと同じ親コンテナ（本文 + ピーク + パネル + レールの行）の中にいるので、
 * 「本文に 360px 残す」ためにはコンテナ幅からレールの分も引いておく必要がある。
 */
export const RIGHT_PANEL_RAIL_WIDTH = 40;
export const RIGHT_PANEL_CONTAINER_RESERVE = RIGHT_PANEL_BODY_RESERVE + RIGHT_PANEL_RAIL_WIDTH;
/**
 * 右パネルの絶対の下限 px。本文 360px を残す上限（コンテナ − 400px）がこれを割るほど狭い窓
 * （853px 幅でサイドバーを開いた状態など）でも、パネルはこの幅より細くしない（本文が 360px を
 * 割ってよい）。以前は上限だけで幅が決まり、コンテナ 597px でパネルが 197px になって、
 * グラフのタブ・チャットの中身が 1 文字ずつ折れて使えなかった。
 * 300px は、グラフのタブ・ステップのツールバー・チャットの中身が 1 文字ずつ折れない目安。
 * この極端な幅はサイドバーを畳めば解消する（本文が広がる）のでマニュアルでも案内する。
 */
export const RIGHT_PANEL_FLOOR_WIDTH = 300;

/**
 * 幅を保存していないときの既定幅。サイドピーク（38vw）より細い 30vw にする:
 * 右パネルは常に本文の隣に開きっぱなしで使うので、Windows 既定（150% 表示）の
 * 1280px 幅で約 384px（本文が 504 → 約 600px に広がる）に収める。
 * 1600px 幅以上は従来どおり 480px。
 */
export const RIGHT_PANEL_DEFAULT_WIDTH = "clamp(320px, 30vw, 480px)";

/**
 * 上の既定幅に、保存幅と同じ「親コンテナ幅 − 予約幅」の上限を掛けた式。
 * 狭いウィンドウでは本文側を優先する（手で開いた場合も、本文は 360px を保つ）。ただし
 * 上限が絶対の下限（RIGHT_PANEL_FLOOR_WIDTH = 300px）を割るほど狭いときは、本文が 360px を
 * 割ってもパネルを 300px に保つ（ドラッグの最小 320px ではなく 300px で受ける。本文を先に譲らせる
 * 幅の帯を狭くするための値で、320px にするとコンテナ 597px のような幅でもう 20px 本文が削れる）。
 */
export const RIGHT_PANEL_DEFAULT_WIDTH_CAPPED = `min(${RIGHT_PANEL_DEFAULT_WIDTH}, max(${RIGHT_PANEL_FLOOR_WIDTH}px, calc(100% - ${RIGHT_PANEL_CONTAINER_RESERVE}px)))`;

/** 既定幅の式 clamp(320px, 30vw, 480px) を px に評価する（自動オープンの判定用）。 */
export function resolveRightPanelDefaultWidth(viewportWidth: number): number {
  return clamp(viewportWidth * 0.3, RIGHT_PANEL_MIN_WIDTH, 480);
}

/**
 * 右パネルの min-width。サイドピーク（inline）と並んだとき、パネルが縮める下限になる。
 * 絶対の下限（RIGHT_PANEL_FLOOR_WIDTH = 300px）をそのまま使う。幅（width）の式は
 * max(300px, コンテナ − 400px) で 300px を割らないので、min-width が width を上回ることはない。
 *
 * flex の縮み方に注意: 本文が 360px で止まったあとの不足は、ピークとパネルが「基準幅 × 縮み率」に
 * 比例して分け合う（パネルが最小幅まで縮んでからピークが縮むのではない）。利用者がパネルを
 * 広げて覚えていると、パネルの側が大きく縮み、ピークも縮む。だから inline で並べるかの判定
 * （shouldOverlaySidePeek）は「パネル・ピークとも下限まで縮んだ最悪の場合」でも下限を保てる幅
 * だけを inline にし、ピーク側にも同じ下限（SIDE_PEEK_INLINE_MIN_WIDTH）の min-width を付ける。
 */
export const RIGHT_PANEL_FLEX_MIN_WIDTH = `${RIGHT_PANEL_FLOOR_WIDTH}px`;

/**
 * 右パネルが開いているときの本文（エディタ枠）の min-width。通常は 360px を保つ（右パネルと
 * サイドピークが縮んで先に譲る）。行が狭くて「本文 360px + パネルの下限 300px + レール」が
 * 収まらない幅では、本文が譲る（行の幅 − レール − パネルの下限）。これが無いと、行が
 * overflow-hidden なのでパネルの右側とレールが行の外へ押し出されて切れる。
 */
export const RIGHT_PANEL_BODY_MIN_WIDTH = `min(${RIGHT_PANEL_BODY_RESERVE}px, calc(100% - ${RIGHT_PANEL_RAIL_WIDTH + RIGHT_PANEL_FLOOR_WIDTH}px))`;

/**
 * サイドピークを inline（本文の隣に並べる）で出すときの、ピークの最小幅 px。
 * ノートのサイドピークのドラッグの最小（320px）より 20px 甘くしてある。inline のピークには
 * この値の min-width を付ける（付けないと、パネルの実幅が広い場合の縮み配分でピークが割り込む）。
 * 320px にしない理由: Windows 既定（150% 表示）の 1280px 幅（行 1024px）で、
 * 本文 360 + レール 40 + パネル下限 300 + ピーク下限 300 = 1000px なので 24px の余裕を持って
 * 収まる（320px だと 1020px で、余裕が 4px になり、行の実寸のわずかな差で重ね表示に落ちる）。
 * 実際の幅は縮み配分で決まり、ピーク既定 480 / パネル既定 384 なら 1280px 幅でパネル 300・
 * ピーク 324 程度（どちらも実用幅）。
 */
export const SIDE_PEEK_INLINE_MIN_WIDTH = 300;

/**
 * サイドピークを本文の隣に並べず、重ねて（overlay・position: fixed）出すべきか。
 * containerWidth は本文・ピーク・右パネル・レールが並ぶ行の実寸（サイドバーを除く）。
 * 「本文 360px + レール + （右パネルが開いていれば）パネルの下限 300px + ピークの下限 300px」が
 * 収まらないとき true。inline のときは note-app が本文に 360px の min-width、ピークとパネルに
 * それぞれの下限の min-width を付けるので、この式が false の行では 3 者とも下限を割らない
 * （右パネルが閉じていても、本文 360px は保たれる）。
 * 例（サイドバー 256px 開き）:
 *   1280px 幅（行 1024）・パネル開: 1024 − 40 − 360 − 300 = 324 → inline
 *   1164px 幅（行 908）・パネル開:  908 − 40 − 360 − 300 = 208 → overlay
 *   960px 幅（行 704）・パネル閉:   704 − 40 − 360       = 304 → inline（ピーク 304〜365px）
 *   853px 幅（行 597）・パネル閉:   597 − 40 − 360       = 197 → overlay
 * パネルの幅は保存幅や既定幅ではなく下限で数える（最悪の場合の保証）。判定にピーク自身の
 * 幅を使わないので、切り替えで行の幅が変わって判定が揺れることはない。
 * 行の幅が測れない（0 以下・非有限。jsdom など）ときは false（従来どおり inline）。
 * 重ね表示中はピークが右パネルとレールを覆う（ピークを閉じるまで、パネルの切り替えはできない）。
 */
export function shouldOverlaySidePeek(containerWidth: number, rightPanelOpen: boolean): boolean {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return false;
  const panel = rightPanelOpen ? RIGHT_PANEL_FLOOR_WIDTH : 0;
  return (
    containerWidth - RIGHT_PANEL_RAIL_WIDTH - RIGHT_PANEL_BODY_RESERVE - panel <
    SIDE_PEEK_INLINE_MIN_WIDTH
  );
}

/**
 * 手順（Activity）のあるノートで右パネルを自動で開いてよいか。
 * 開いた後に本文（コンテナ − レール − サイドピーク − パネル）が 360px 以上残るときだけ true。
 * containerWidth が測れない（0 以下・非有限）ときは従来どおり開く。
 * panelWidth は保存済みの幅があればそれ、無ければ既定幅（resolveRightPanelDefaultWidth）。
 * 保存済みの幅は CSS の上限（コンテナ − 400px）で切らずに判定する: 利用者が広げて覚えた幅では
 * 本文が 360px きりになるので、何もしないうちに開くのは控える（手で開けばその上限で開く）。
 * peekWidth は同じ行に開いているサイドピーク（inline）の実寸。無ければ 0。
 */
export function shouldAutoOpenRightPanel(
  containerWidth: number,
  panelWidth: number,
  peekWidth = 0,
): boolean {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return true;
  const peek = Number.isFinite(peekWidth) && peekWidth > 0 ? peekWidth : 0;
  return (
    containerWidth - RIGHT_PANEL_RAIL_WIDTH - peek - panelWidth >= RIGHT_PANEL_BODY_RESERVE
  );
}

export function useRightPanelWidth(): ResizableWidth {
  return useResizableWidth({
    storageKey: RIGHT_PANEL_WIDTH_STORAGE_KEY,
    min: RIGHT_PANEL_MIN_WIDTH,
    max: RIGHT_PANEL_MAX_WIDTH,
    containerReserve: RIGHT_PANEL_CONTAINER_RESERVE,
    containerFloor: RIGHT_PANEL_FLOOR_WIDTH,
  });
}
