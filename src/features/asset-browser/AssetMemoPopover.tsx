// 素材のメモの小窓（見出し＝素材名・全画面で開く・書く欄・メモの一覧）と、
// 素材のサイドピークのヘッダーに置く印つきの入口。
//
// 付け先が「素材」のメモを読む・書く入口が複数ある（ノートに貼った素材のブロック・
// 素材一覧のカードと行・素材のサイドピーク）。どこから開いても同じ小窓にするため、
// 見出しと「全画面で開く」の組み立てをここに集める。メモの集合は呼び出し側が決める
// （filterMemosByAsset ＝ 素材の「メモ」タブと必ず同じ）。

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { Maximize2 } from "lucide-react";
import { useT } from "../../i18n";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture";
import { filterMemosByAsset } from "./AssetMemosSection";
import { MemoChip } from "./MemoChip";
import { MemoPopover } from "./MemoPopover";
import type { MediaIndexEntry } from "./media-index";
import type { Rect } from "../../ui/floating-position";

export type AssetMemoPopoverProps = {
  /** 小窓の起点（印の要素、または矩形） */
  anchor: Element | Rect | null;
  entry: MediaIndexEntry;
  /** 素材のメモ（filterMemosByAsset の結果。新しい順） */
  memos: CaptureEntry[];
  /**
   * メモを書く。渡さなければ読むだけ。素材についてのメモなので、呼び出し側が
   * sourceAsset を付けて保存する（sourceNote は付けない）。保存に失敗したら reject する
   * （書く欄が文を残す）
   */
  onCreate?: (text: string) => void | Promise<void>;
  /** 「全画面で開く」。無ければ見出しに出さない。押すと小窓は閉じる */
  onOpenFull?: () => void;
  /** 一覧の項目を押したとき（メモのピークを開く）。小窓は閉じる */
  onOpenMemo?: (memoId: string) => void;
  onClose: () => void;
};

export function AssetMemoPopover({
  anchor,
  entry,
  memos,
  onCreate,
  onOpenFull,
  onOpenMemo,
  onClose,
}: AssetMemoPopoverProps) {
  const t = useT();
  return (
    <MemoPopover
      anchor={anchor}
      title={entry.name}
      headerAction={
        onOpenFull ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFull();
            }}
            data-tooltip={t("memoAnchor.openFull")}
            data-tooltip-usage={t("memoAnchor.openFullUsage")}
            aria-label={t("memoAnchor.openFull")}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground transition-colors"
          >
            <Maximize2 size={13} />
          </button>
        ) : undefined
      }
      memos={memos}
      onCreate={onCreate}
      onOpenMemo={onOpenMemo}
      emptyText={onCreate ? t("memoAnchor.emptyWritable") : t("memo.emptyForAsset")}
      onClose={onClose}
    />
  );
}

export type AssetMemoButtonProps = {
  entry: MediaIndexEntry;
  captureIndex: CaptureIndex | null | undefined;
  /** メモを書く（素材の sourceAsset 付きで保存する）。無ければ小窓は読むだけ */
  onCreateMemo?: (entry: MediaIndexEntry, text: string) => void | Promise<void>;
  onOpenFull?: () => void;
  onOpenMemo?: (memoId: string) => void;
  /** 配置の調整（ヘッダーの並びに合わせる） */
  style?: CSSProperties;
  className?: string;
};

/**
 * 素材のサイドピークのヘッダーに置く、メモの印つきの入口。押すと素材の小窓が開く。
 * ヘッダーの操作なので 0 件でも常に出す（「対象に載ったときだけ」の印とは別。見つけやすさを優先）。
 * 読むだけ（onCreateMemo 無し）で 0 件のときは、読むものも書く欄も無いので出さない。
 */
export function AssetMemoButton({
  entry,
  captureIndex,
  onCreateMemo,
  onOpenFull,
  onOpenMemo,
  style,
  className,
}: AssetMemoButtonProps) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const memos = useMemo(() => filterMemosByAsset(captureIndex, entry), [captureIndex, entry]);
  const close = useCallback(() => setAnchor(null), []);
  if (memos.length === 0 && !onCreateMemo) return null;
  const count = memos.length;
  return (
    <>
      <MemoChip
        count={count}
        visible
        active={anchor !== null}
        label={count > 0 ? t("memoAnchor.chipCount", { count: String(count) }) : t("memoAnchor.chipWrite")}
        usage={t("memoAnchor.chipUsage")}
        onClick={(e) => {
          const el = e.currentTarget;
          setAnchor((prev) => (prev ? null : el));
        }}
        chipId={`peek:${entry.fileId}`}
        className={className}
        style={style}
      />
      {anchor && (
        <AssetMemoPopover
          anchor={anchor}
          entry={entry}
          memos={memos}
          onCreate={onCreateMemo ? (text) => onCreateMemo(entry, text) : undefined}
          onOpenFull={onOpenFull}
          onOpenMemo={onOpenMemo}
          onClose={close}
        />
      )}
    </>
  );
}
