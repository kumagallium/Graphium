// ──────────────────────────────────────────────
// MemoIndicatorLayer
//
// ブロック紐付きメモ（CaptureEntry.sourceNote.blockId）を持つブロックの右端に
// 付箋バッジを表示するオーバーレイ。ProvIndicatorLayer と同じ流儀
// （position:fixed + createPortal + scroll/resize/MutationObserver 再計算）。
// クリックで右パネル「Memos」タブを開き、該当ブロックのメモにフォーカスする。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { StickyNote } from "lucide-react";
import type { CaptureIndex } from "./capture-store";
import { useT } from "../../i18n";

// 付箋バッジの色（amber 系。PROV ラベルバッジと同じ「色 + 透過 hex」書式で塗る）
const MEMO_BADGE_COLOR = "#d97706";

type IndicatorInfo = {
  blockId: string;
  top: number;
  left: number;
  count: number;
};

// エディタラッパーの表示範囲（バッジをクリップするため）
type ClipBounds = { top: number; bottom: number };

/**
 * ノート `noteFileId` のブロック紐付きメモを blockId ごとに数える。
 * archive / trash 済みメモは除外（NoteMemosSection のフィルタと同じ基準）。
 */
export function countBlockMemos(
  captureIndex: CaptureIndex | null | undefined,
  noteFileId: string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!captureIndex || !noteFileId) return counts;
  for (const c of captureIndex.captures) {
    if (c.archivedAt || c.deletedAt) continue;
    if (c.sourceNote?.fileId !== noteFileId) continue;
    const blockId = c.sourceNote.blockId;
    if (!blockId) continue;
    counts.set(blockId, (counts.get(blockId) ?? 0) + 1);
  }
  return counts;
}

export function MemoIndicatorLayer({
  noteFileId,
  captureIndex,
  hidden = false,
  bottomInset = 0,
  onOpenMemos,
}: {
  /** 現在開いているノートの fileId。null なら何も描かない */
  noteFileId: string | null;
  /** 全メモのインデックス */
  captureIndex: CaptureIndex | null;
  /** モバイルで全画面オーバーレイ（右パネル）が開いている間はバッジを描画しない */
  hidden?: boolean;
  /** 画面下端からの予約領域（モバイルのボトムバー高さ等） */
  bottomInset?: number;
  /** バッジクリックで右パネル「Memos」タブを開く（対象ブロック ID 付き） */
  onOpenMemos: (blockId: string) => void;
}) {
  const [indicators, setIndicators] = useState<IndicatorInfo[]>([]);
  const [clipBounds, setClipBounds] = useState<ClipBounds>({ top: 0, bottom: 9999 });
  const t = useT();

  const blockCounts = useMemo(
    () => countBlockMemos(captureIndex, noteFileId),
    [captureIndex, noteFileId],
  );

  // メモ付きブロックの位置を計算（ProvIndicatorLayer.compute と同じ手順）
  const compute = useCallback(() => {
    if (blockCounts.size === 0) {
      setIndicators([]);
      return;
    }
    const wrapper = document.querySelector("[data-label-wrapper]");
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();

    // SidePeek が開いているときはその左端より内側に収める
    let effectiveRight = wrapperRect.right;
    const sidePeek = document.querySelector("[data-side-peek]");
    if (sidePeek && !sidePeek.contains(wrapper)) {
      const peekRect = sidePeek.getBoundingClientRect();
      if (peekRect.left < effectiveRight) {
        effectiveRight = peekRect.left;
      }
    }
    const baseLeft = effectiveRight - 8;
    const clipBottom =
      bottomInset > 0
        ? Math.min(wrapperRect.bottom, window.innerHeight - bottomInset)
        : wrapperRect.bottom;
    setClipBounds({ top: wrapperRect.top, bottom: clipBottom });

    const next: IndicatorInfo[] = [];
    blockCounts.forEach((count, blockId) => {
      const outer = wrapper.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      ) as HTMLElement | null;
      // ブロックが削除された場合はバッジを出さない（メモはノート単位に degrade）
      if (!outer) return;

      const content = outer.querySelector(".bn-block-content") as HTMLElement | null;
      const rect = content ? content.getBoundingClientRect() : outer.getBoundingClientRect();
      if (rect.height === 0) return;

      // 同じブロックに PROV ラベルバッジがある場合は、その左に退避して重なりを防ぐ
      // （# ホバーヒントは一時表示なので対象外）
      const labelEl = document.querySelector(
        `[data-prov-label-anchor="${blockId}"]:not([data-prov-hover-hint])`
      );
      const extraOffset = labelEl
        ? labelEl.getBoundingClientRect().width + 6
        : 0;

      next.push({
        blockId,
        top: rect.top + rect.height / 2,
        left: baseLeft - extraOffset,
        count,
      });
    });
    setIndicators(next);
  }, [blockCounts, bottomInset]);

  useEffect(() => {
    const raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [compute]);

  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    const wrapper = document.querySelector("[data-label-wrapper]");
    let ro: ResizeObserver | undefined;
    let mo: MutationObserver | undefined;
    if (wrapper) {
      ro = new ResizeObserver(compute);
      ro.observe(wrapper);
      mo = new MutationObserver(() => {
        requestAnimationFrame(compute);
      });
      mo.observe(wrapper, { childList: true, subtree: true });
    }
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [compute]);

  if (hidden || indicators.length === 0) return null;

  return createPortal(
    <>
      {indicators.map(({ blockId, top, left, count }) => {
        // エディタラッパーの表示範囲外はスキップ（ヘッダーに重ならないよう）
        if (top < clipBounds.top || top > clipBounds.bottom) return null;

        return (
          <button
            key={blockId}
            onClick={() => onOpenMemos(blockId)}
            data-memo-indicator={blockId}
            title={t("memo.indicatorTooltip")}
            className="fixed z-[9996] inline-flex items-center gap-0.5 rounded-full text-xs font-semibold cursor-pointer select-none whitespace-nowrap pointer-events-auto"
            style={{
              top,
              right: window.innerWidth - left,
              transform: "translateY(-50%)",
              padding: "1px 6px",
              backgroundColor: MEMO_BADGE_COLOR + "18",
              color: MEMO_BADGE_COLOR,
              border: `1px solid ${MEMO_BADGE_COLOR}38`,
              lineHeight: 1.6,
            }}
          >
            <StickyNote size={11} />
            {count > 1 && <span>{count}</span>}
          </button>
        );
      })}
    </>,
    document.body
  );
}
