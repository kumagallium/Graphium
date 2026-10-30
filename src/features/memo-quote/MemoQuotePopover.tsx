// 引用したメモの小窓。引用ブロック右上の印（MemoChip）に付けて開く。
//
// MemoPopover（流用）に、元のメモの今の本文と日時、紐づけの状態、操作を並べる。
// - 元のメモが引用後に変わっている → 「元のメモが更新されています」＋「本文に反映」
//   （自動では書き換えない。本文は書き手のもの）
// - 元のメモがゴミ箱・完全削除 →「元のメモは削除されました」（本文はそのまま）
// - 「メモを開く」「紐づけを外す」（本文は残る）
// 書く欄は出さない。編集できない画面（アーカイブ・ゴミ箱）では「本文に反映」「紐づけを外す」を出さない。

import { AlertCircle, ExternalLink } from "lucide-react";
import { useT } from "../../i18n";
import type { MemoQuoteRef } from "../../lib/document-types";
import { formatDateTime } from "../../lib/format-datetime";
import type { Rect } from "../../ui/floating-position";
import { MemoPopover } from "../asset-browser/MemoPopover";
import type { CaptureEntry } from "../mobile-capture";
import { MEMO_QUOTE_COLOR, type MemoQuoteStatus } from "./memo-quote";

export type MemoQuotePopoverProps = {
  anchor: Element | Rect | null;
  /** 紐づけ（引用した日時を見せる） */
  quoteRef: MemoQuoteRef;
  status: MemoQuoteStatus;
  /** 元のメモ（削除済みのときは undefined でもよい） */
  memo: CaptureEntry | undefined;
  /** 編集できる画面か。false なら「本文に反映」「紐づけを外す」を出さない */
  editable: boolean;
  onOpenMemo?: (memoId: string) => void;
  onReflect?: () => void;
  onUnlink?: () => void;
  onClose: () => void;
};

const actionClass =
  "inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs " +
  "text-foreground hover:bg-black/5 transition-colors cursor-pointer";

export function MemoQuotePopover({
  anchor,
  quoteRef,
  status,
  memo,
  editable,
  onOpenMemo,
  onReflect,
  onUnlink,
  onClose,
}: MemoQuotePopoverProps) {
  const t = useT();
  const deleted = status === "deleted";
  return (
    <MemoPopover
      anchor={anchor}
      title={t("memoQuote.title")}
      // 書く欄は出さない（onCreate なし）。削除済みのメモは一覧に出さない
      memos={deleted || !memo ? [] : [memo]}
      onOpenMemo={onOpenMemo}
      onClose={onClose}
    >
      <div className="px-3 py-2 border-b border-border-subtle flex flex-col gap-2" data-test="memoQuoteStatus">
        {status === "updated" && (
          <div className="flex items-start gap-1.5 text-xs text-foreground" role="status">
            <AlertCircle size={13} style={{ color: MEMO_QUOTE_COLOR, marginTop: 1 }} aria-hidden />
            <span>{t("memoQuote.updated")}</span>
          </div>
        )}
        {deleted && (
          <div className="flex flex-col gap-0.5 text-xs" role="status">
            <span className="flex items-start gap-1.5 text-foreground">
              <AlertCircle size={13} style={{ color: MEMO_QUOTE_COLOR, marginTop: 1 }} aria-hidden />
              {t("memoQuote.deleted")}
            </span>
            <span className="text-muted-foreground" style={{ paddingLeft: 19 }}>
              {t("memoQuote.deletedHint")}
            </span>
          </div>
        )}
        <div className="text-[11px] text-muted-foreground">
          {t("memoQuote.quotedAt", { date: formatDateTime(quoteRef.quotedAt) })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {status === "updated" && editable && onReflect && (
            <button
              type="button"
              onClick={() => {
                onReflect();
                onClose();
              }}
              data-tooltip={t("memoQuote.reflect")}
              data-tooltip-usage={t("memoQuote.reflectUsage")}
              className={actionClass}
              data-test="memoQuoteReflect"
            >
              {t("memoQuote.reflect")}
            </button>
          )}
          {!deleted && memo && onOpenMemo && (
            <button
              type="button"
              onClick={() => {
                onOpenMemo(memo.id);
                onClose();
              }}
              data-tooltip={t("memoQuote.open")}
              data-tooltip-usage={t("memoQuote.openUsage")}
              className={actionClass}
              data-test="memoQuoteOpen"
            >
              <ExternalLink size={12} aria-hidden />
              {t("memoQuote.open")}
            </button>
          )}
          {editable && onUnlink && (
            <button
              type="button"
              onClick={() => {
                onUnlink();
                onClose();
              }}
              data-tooltip={t("memoQuote.unlink")}
              data-tooltip-usage={t("memoQuote.unlinkUsage")}
              className={actionClass}
              data-test="memoQuoteUnlink"
            >
              {t("memoQuote.unlink")}
            </button>
          )}
        </div>
      </div>
    </MemoPopover>
  );
}
