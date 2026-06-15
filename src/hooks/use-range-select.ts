// 一覧行のドラッグ範囲選択フック
// ノート一覧・Wiki 一覧で共通に使う。
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

  const beginDrag = useCallback(
    (index: number) => {
      const id = idsRef.current[index];
      if (!id) return;
      const mode: "add" | "remove" = selectedRef.current.has(id) ? "remove" : "add";
      baselineRef.current = new Set(selectedRef.current);
      setDrag({ startIdx: index, mode });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (mode === "add") next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [setSelectedIds],
  );

  // 行 mousedown — 閾値を超えるまで待つ
  const onRowMouseDown = useCallback((e: ReactMouseEvent, index: number) => {
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
    pendingRef.current = { idx: index, x: e.clientX, y: e.clientY };
  }, []);

  // チェックボックス td — 距離ゼロでも即トグル開始
  const onCheckboxMouseDown = useCallback(
    (e: ReactMouseEvent, index: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pendingRef.current = null;
      beginDrag(index);
    },
    [beginDrag],
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
      setSelectedIds(next);
    },
    [drag, setSelectedIds],
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
        justDraggedRef.current = true;
        setDrag(null);
        baselineRef.current = null;
        // mouseup → click は同じフレームで続くので、次フレームで解除
        requestAnimationFrame(() => {
          justDraggedRef.current = false;
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, beginDrag]);

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
