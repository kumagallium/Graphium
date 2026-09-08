// 一覧行の範囲選択フック（ドラッグ / Shift+クリック）
// ノート一覧・ナレッジ一覧・素材ギャラリー・メモギャラリーで共通に使う。
//
// 使い方（行全体でドラッグ範囲選択）:
//   const range = useRangeSelect(orderedIds, selectedIds, setSelectedIds);
//   <tr
//     onMouseDown={(e) => range.onRowMouseDown(e, idx)}
//     onMouseEnter={() => range.onRowMouseEnter(idx)}
//     onClick={() => { if (range.shouldSuppressClick()) return; openRow(); }}
//   >
//     <td onMouseDown={(e) => range.onCheckboxMouseDown(e, idx)}> {/* 即トグル */}
//       <input type="checkbox" readOnly className="pointer-events-none ..." />
//     </td>
//     ...
//   </tr>
//
// 仕様:
// - 行 mousedown → pending 状態に。一定距離（5px）動いたらドラッグ開始
// - クリック相当の動きならドラッグ発火せず、通常クリックがそのまま走る
// - チェックボックス td では mousedown を即座に拾い、距離ゼロでもトグル
// - ドラッグ中は baseline + 範囲 + モード を毎フレーム再計算
// - mouseup 直後の click 1 回は shouldSuppressClick() が true を返して抑制
//
// Shift+クリックの範囲選択:
// - アンカー（起点）は「チェックボックスのトグル」か「ドラッグの開始」で立つ。
//   行を普通にクリックしただけでは立たない（行クリックは開く操作なので）
// - アンカーがある状態で Shift+クリックすると、ドラッグを始めずに
//   アンカー〜クリック位置を選択に足す（Finder / Gmail と同じで、Shift 範囲は常に「選ぶ」）
// - アンカーは動かさないので、続けて Shift+クリックすると同じ起点から範囲が伸縮する。
//   縮められるように、アンカーを立てた時点の選択（shiftBaselineRef）を基準に毎回組み直す。
//   この基準はドラッグ中の伸縮に追従する（ドラッグで選んだ行が、あとの Shift+クリックで消えないように）
// - 行の Shift+クリックは「開く」ではないので、直後の click を 1 回だけ抑制する
// - 選択が空になったとき／並び順が変わったとき（index の意味が変わる）はアンカーを捨てる

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";

type DragState = {
  startIdx: number;
  mode: "add" | "remove";
};

const DRAG_THRESHOLD_PX = 5;

export function useRangeSelect(
  orderedIds: string[],
  selectedIds: Set<string>,
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>,
) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const baselineRef = useRef<Set<string> | null>(null);
  const idsRef = useRef(orderedIds);
  idsRef.current = orderedIds;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  // mousedown したが閾値未満で待機している状態
  const pendingRef = useRef<{ idx: number; x: number; y: number } | null>(null);
  // mouseup 直後の click を一度だけ抑制するフラグ
  const justDraggedRef = useRef(false);
  // Shift 範囲の起点。最後にトグル／ドラッグ開始した位置
  const anchorRef = useRef<number | null>(null);
  // アンカーを立てた時点の選択（ドラッグ中はその伸縮に追従する）。
  // Shift 範囲は毎回「これ ∪ [lo, hi]」で組む（現在の選択に足していくと範囲を縮められないため）
  const shiftBaselineRef = useRef<Set<string> | null>(null);
  // 直近の選択の変化が、このフック自身によるものか（外からの差し替えか）。
  // 「すべて選択」のように外から選択を丸ごと差し替えられたら、古い基準で
  // Shift 範囲を組むと選択が縮むので、アンカーごと捨てる
  const internalChangeRef = useRef(false);
  const setSelectedIdsInternal = useCallback(
    (v: SetStateAction<Set<string>>) => {
      internalChangeRef.current = true;
      setSelectedIds(v);
    },
    [setSelectedIds],
  );

  // 次の click を 1 回だけ握りつぶす（mousedown / mouseup と同じフレームの click 対策）
  const suppressNextClick = useCallback(() => {
    justDraggedRef.current = true;
    requestAnimationFrame(() => {
      justDraggedRef.current = false;
    });
  }, []);

  /** Shift+クリック。アンカーが無ければ何もせず false を返す */
  const applyShiftRange = useCallback(
    (index: number) => {
      const anchor = anchorRef.current;
      if (anchor == null) return false;
      const ids = idsRef.current;
      const lo = Math.min(anchor, index);
      const hi = Math.max(anchor, index);
      const next = new Set(shiftBaselineRef.current ?? selectedRef.current);
      for (let i = lo; i <= hi; i++) {
        const id = ids[i];
        if (id) next.add(id);
      }
      setSelectedIdsInternal(next);
      return true;
    },
    [setSelectedIdsInternal],
  );

  const beginDrag = useCallback(
    (index: number) => {
      const id = idsRef.current[index];
      if (!id) return;
      const mode: "add" | "remove" = selectedRef.current.has(id) ? "remove" : "add";
      baselineRef.current = new Set(selectedRef.current);
      // ここが Shift 範囲の起点になる。基準の選択は「このトグルを当てたあと」の状態
      anchorRef.current = index;
      const shiftBaseline = new Set(selectedRef.current);
      if (mode === "add") shiftBaseline.add(id);
      else shiftBaseline.delete(id);
      shiftBaselineRef.current = shiftBaseline;
      setDrag({ startIdx: index, mode });
      setSelectedIdsInternal((prev) => {
        const next = new Set(prev);
        if (mode === "add") next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [setSelectedIdsInternal],
  );

  // 行 mousedown — 閾値を超えるまで待つ
  const onRowMouseDown = useCallback(
    (e: ReactMouseEvent, index: number) => {
      if (e.button !== 0) return;
      // ボタン・リンク・入力など対話要素の上では発火させない
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, a, input, select, textarea, label, [data-no-drag]")) {
        return;
      }
      // ネイティブのテキスト選択（mousedown→ドラッグ）を始まる前に抑止する。
      // userSelect="none" は選択開始後では進行中の選択を止められないため、
      // ここで preventDefault して選択そのものを発生させない。click は引き続き発火する。
      e.preventDefault();
      // Shift 範囲はドラッグを待たずにその場で確定する。
      // 行クリック（開く）と両立しないので、直後の click は抑制する
      if (e.shiftKey && applyShiftRange(index)) {
        suppressNextClick();
        return;
      }
      pendingRef.current = { idx: index, x: e.clientX, y: e.clientY };
    },
    [applyShiftRange, suppressNextClick],
  );

  // チェックボックス td — 距離ゼロでも即トグル開始
  const onCheckboxMouseDown = useCallback(
    (e: ReactMouseEvent, index: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pendingRef.current = null;
      // Shift 範囲はドラッグを始めずにその場で確定する
      if (e.shiftKey && applyShiftRange(index)) return;
      beginDrag(index);
    },
    [applyShiftRange, beginDrag],
  );

  const onRowMouseEnter = useCallback(
    (index: number) => {
      if (!drag || !baselineRef.current) return;
      const ids = idsRef.current;
      const lo = Math.min(drag.startIdx, index);
      const hi = Math.max(drag.startIdx, index);
      const next = new Set(baselineRef.current);
      for (let i = lo; i <= hi; i++) {
        const id = ids[i];
        if (!id) continue;
        if (drag.mode === "add") next.add(id);
        else next.delete(id);
      }
      // ドラッグで伸ばした分も Shift 範囲の基準にする。
      // 反映しないと、ドラッグ確定後の Shift+クリックが古い基準から組み直してしまい、
      // ドラッグで選んだ行が黙って選択から外れる
      shiftBaselineRef.current = next;
      setSelectedIdsInternal(next);
    },
    [drag, setSelectedIdsInternal],
  );

  // 閾値判定の mousemove と、共通 mouseup
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const p = pendingRef.current;
      if (!p || drag) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      pendingRef.current = null;
      beginDrag(p.idx);
    };
    const onUp = () => {
      const wasDragging = drag !== null;
      pendingRef.current = null;
      if (wasDragging) {
        setDrag(null);
        baselineRef.current = null;
        // mouseup → click は同じフレームで続くので、次フレームで解除
        suppressNextClick();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, beginDrag, suppressNextClick]);

  // 選択が外から変えられた（空にされた・丸ごと差し替えられた）らアンカーも捨てる
  // （次の Shift+クリックは単独トグルに戻る）。フック自身の変更なら基準は追従済み
  useEffect(() => {
    const internal = internalChangeRef.current;
    internalChangeRef.current = false;
    if (internal && selectedIds.size > 0) return;
    anchorRef.current = null;
    shiftBaselineRef.current = null;
  }, [selectedIds]);

  // 並び替え・絞り込みで並びが変わったら index の意味が変わるのでアンカーを捨てる
  useEffect(() => {
    anchorRef.current = null;
    shiftBaselineRef.current = null;
  }, [orderedIds]);

  // ドラッグ中はテキスト選択を抑制
  useEffect(() => {
    if (!drag) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [drag]);

  return {
    onRowMouseDown,
    onRowMouseEnter,
    onCheckboxMouseDown,
    isDragging: drag !== null,
    /** mouseup 直後の click を抑制したいときに参照する */
    shouldSuppressClick: () => drag !== null || justDraggedRef.current,
  };
}
