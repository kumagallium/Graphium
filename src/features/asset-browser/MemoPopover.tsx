// メモの小窓
// 印（MemoChip）に付けて開き、メモを読む・その場で書く。付け先に依存しない汎用の部品で、
// ノートの素材ブロック・素材一覧・つながり（辺）で同じ形に揃える。
//
// - 浮く部品なので body へ出す（AnchoredPortal。z は小窓の帯 9999）
// - Esc・外側クリックで閉じる。開いた直後は書く欄にフォーカス
// - 一覧の描画は素材の「Memos」タブと共通（MemoList）。小窓では削除させない
//   （削除は全画面のメモタブで）。項目を押すとメモのピークを開く（onOpenMemo）
// - onCreate が無いときは書く欄を出さず、読むだけ（アーカイブ・ゴミ箱のノートなど）

import { useEffect, useRef, type ReactNode } from "react";
import { AnchoredPortal } from "../../ui/anchored-portal";
import type { Rect } from "../../ui/floating-position";
import type { CaptureEntry } from "../mobile-capture";
import { MemoComposer } from "./MemoComposer";
import { MemoList } from "./MemoList";

export const MEMO_POPOVER_WIDTH = 320;

export type MemoPopoverProps = {
  /** 起点（印の要素、または矩形） */
  anchor: Element | Rect | null;
  /** 見出し。長いときは切り詰めて title 属性に全文を持つ */
  title: string;
  /** 見出しの右に置く操作（例: 全画面で開くアイコン） */
  headerAction?: ReactNode;
  /** 表示するメモ（並びは呼び出し側が決める。新しい順を想定） */
  memos: CaptureEntry[];
  /** メモを書く。渡さなければ書く欄を出さない（読むだけ） */
  onCreate?: (text: string) => void | Promise<void>;
  placeholder?: string;
  /** メモの項目を押したとき（メモのピークを開く等）。小窓は閉じる */
  onOpenMemo?: (memoId: string) => void;
  /** メモが 0 件のときの文言 */
  emptyText?: ReactNode;
  onClose: () => void;
  /** 見出しの下に差し込む領域（状態表示など） */
  children?: ReactNode;
};

export function MemoPopover({
  anchor,
  title,
  headerAction,
  memos,
  onCreate,
  placeholder,
  onOpenMemo,
  emptyText,
  onClose,
  children,
}: MemoPopoverProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 開いている間は最新の onClose を使う（リスナーの付け直しを避ける）
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // IME の変換確定の Esc では閉じない
      if (e.key !== "Escape" || e.isComposing) return;
      onCloseRef.current();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (boxRef.current?.contains(target)) return;
      // 起点（印）を押したときは、印の onClick が開閉を決める（ここで閉じると再び開いてしまう）
      const a = anchorRef.current;
      if (a instanceof Element && a.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  return (
    <AnchoredPortal
      anchor={anchor}
      placement="bottom-end"
      containerRef={boxRef}
      role="dialog"
      aria-label={title}
      data-test="memoPopover"
      className="rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ width: MEMO_POPOVER_WIDTH }}
      deps={[memos.length, Boolean(onCreate)]}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle"
        style={{ minHeight: 36 }}
      >
        <span
          className="flex-1 min-w-0 truncate text-xs font-medium text-foreground"
          title={title}
        >
          {title}
        </span>
        {headerAction}
      </div>
      {children}
      {onCreate && <MemoComposer onSubmit={onCreate} placeholder={placeholder} autoFocus />}
      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        <MemoList
          memos={memos}
          onOpenMemo={
            onOpenMemo
              ? (id) => {
                  onOpenMemo(id);
                  onClose();
                }
              : undefined
          }
          emptyContent={emptyText}
        />
      </div>
    </AnchoredPortal>
  );
}
