// 一覧の ↑↓ でサイドピークを次々に送るフック（キーボードで順に中身を覗く）
// ノート一覧で使う。ほかの一覧（知見・素材など）にも同じ形で付けられる。
//
// 使い方:
//   const peekKeys = useListPeekKeys({ orderedIds, activeId, onStep, onOpenFull });
//   <div ref={peekKeys.containerRef} tabIndex={-1} onKeyDown={peekKeys.onKeyDown} className="outline-none">
//     <tr
//       data-list-row-id={id}
//       onClick={() => { peekKeys.focusList(); openRow(id); }}
//       className={peekKeys.cursorId === id ? "..." : ""}
//     />
//   </div>
//
// 仕様:
// - 印（cursorId）は「今ピークで開いている行」。activeId（ピークのノート）が変われば追従し、
//   ピークが閉じれば消える。自前で覚えるのは、押しっぱなしで送っている間（ピークが
//   追いつくまで）だけ
// - キーは一覧の器にフォーカスがあるときだけ効く（器の onKeyDown）。ピークの本文や
//   検索欄にフォーカスがあるときは、そちらの本来の動き（カーソル移動）を奪わない。
//   行の mousedown は use-range-select が preventDefault するのでフォーカスが動かない。
//   行クリックで focusList() を呼び、器へフォーカスを移す
// - ↓ / ↑: 次・前の行へ。端では止まる（折り返さない）。印の行が一覧に無い
//   （絞り込みで外れた・知見のピーク）ときは何もせず、器のスクロールに任せる
// - 単発の押下はすぐピークを差し替える。押しっぱなし（key repeat）の間は印だけ動かし、
//   離して STEP_SETTLE_MS 経ってから差し替える（ピークは開くたびにエディタを作り直すので、
//   1 秒に何十回も作り直すとカクつく）
// - Enter: 印の行を全画面で開く（ダブルクリックと同じ）
// - 修飾キー付き・IME 変換中・文字入力欄の上では何もしない

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** 押しっぱなしで送ったあと、ピークを差し替えるまでの待ち（ms） */
export const STEP_SETTLE_MS = 150;

/** 文字を打つ要素（ここでの ↑↓ / Enter は本来の動きに任せる） */
function isTextEntry(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return type !== "checkbox" && type !== "radio" && type !== "button";
}

/** Enter で自分自身が動く要素（ボタン・リンク・チェックボックスなど） */
function activatesOnEnter(el: HTMLElement): boolean {
  return !!el.closest("button, a[href], input, select, textarea, [role='button']");
}

export function useListPeekKeys({
  orderedIds,
  activeId,
  onStep,
  onOpenFull,
  enabled = true,
}: {
  /** 表示中の並び（並べ替え・絞り込み後） */
  orderedIds: string[];
  /** 今ピークで開いているノート（閉じていれば null） */
  activeId: string | null;
  /** ↑↓ で送った先をピークで開く */
  onStep: (id: string) => void;
  /** Enter で全画面で開く */
  onOpenFull?: (id: string) => void;
  /** false の間はキーを拾わない（一覧の上にダイアログやポップアップが出ているとき） */
  enabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(activeId);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 印を動かしたのがキーのときだけ、その行を見える位置へスクロールする
  // （クリックで開いた行は見えているので動かさない）
  const scrollPendingRef = useRef(false);

  // コールバックは最新を ref で持つ（タイマーが古いクロージャを呼ばないように）
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const onOpenFullRef = useRef(onOpenFull);
  onOpenFullRef.current = onOpenFull;

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  // ピークが変わったら印を追従させる。押しっぱなしの途中でピークが外から
  // 閉じられた・切り替えられたときは、待っている差し替えを捨てて外に合わせる
  useEffect(() => {
    clearSettleTimer();
    setCursorId(activeId);
  }, [activeId, clearSettleTimer]);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  useEffect(() => {
    if (!scrollPendingRef.current || !cursorId) return;
    scrollPendingRef.current = false;
    // ID をセレクタに埋め込まない（CSS.escape が無い環境があり、ID の文字種も決め打ちしない）
    const rows = containerRef.current?.querySelectorAll<HTMLElement>("[data-list-row-id]") ?? [];
    const row = Array.from(rows).find((el) => el.dataset.listRowId === cursorId);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [cursorId]);

  const focusList = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!enabled || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      const target = e.target as HTMLElement;
      if (isTextEntry(target)) return;

      if (e.key === "Enter") {
        if (!cursorId || !onOpenFullRef.current) return;
        if (target !== containerRef.current && activatesOnEnter(target)) return;
        e.preventDefault();
        clearSettleTimer();
        onOpenFullRef.current(cursorId);
        return;
      }

      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!cursorId) return;
      const index = orderedIds.indexOf(cursorId);
      if (index < 0) return;
      // 端でも既定のスクロールは止める（印が一覧の端にあるのに器だけ動くと、印を見失う）
      e.preventDefault();
      const nextIndex = e.key === "ArrowDown" ? index + 1 : index - 1;
      const nextId = orderedIds[nextIndex];
      if (!nextId) return;

      scrollPendingRef.current = true;
      setCursorId(nextId);
      clearSettleTimer();
      if (e.repeat) {
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null;
          onStepRef.current(nextId);
        }, STEP_SETTLE_MS);
      } else {
        onStepRef.current(nextId);
      }
    },
    [enabled, cursorId, orderedIds, clearSettleTimer],
  );

  return { containerRef, cursorId, onKeyDown, focusList };
}
