// 本文の「紐づいた引用ブロック」の見せ方を足す層。
//
// - 紐づいた quote ブロックの左の縦線をメモの色にする（style を注入。ハイライトとは別の <style>）
// - ブロックにマウスが載っている間・選択中だけ、引用ブロックの右上の内側に印（MemoChip）を出す。
//   元のメモが更新されていれば小さな点を添える。押すと小窓（MemoQuotePopover）
//
// 作りは MemoBlockLayer と同じ「層」方式: エディタの外枠（wrapperEl）の中へポータルで描き、
// ブロックの DOM は `[data-id][data-node-type="blockOuter"]` から引くだけで触らない。
// 出すのはメインのノート編集だけ（サイドピーク・共有ノート・テンプレート編集・印刷には置かない。
// 呼び出し側が置かないことで保つ）。ブロックが本文に無い紐づけは DOM から引けないので自然に出ない。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, useLocaleSubscription } from "../../i18n";
import type { CaptureIndex } from "../mobile-capture";
import { MemoChip } from "../asset-browser/MemoChip";
import { MEMO_CHIP_INSET, memoChipPosition, readSelectedBlockIds, sameSet } from "../asset-browser/MemoBlockLayer";
import { reflectMemoQuote } from "./insert-memo-quote";
import { findQuoteMemo, memoQuoteChipInset, memoQuoteStatus, memoQuoteStyleCss } from "./memo-quote";
import { MemoQuotePopover } from "./MemoQuotePopover";
import { useMemoQuoteStoreOptional } from "./store";

type Placement = {
  blockId: string;
  top: number;
  left: number;
};

function samePlacements(a: Placement[], b: Placement[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (p, i) =>
      p.blockId === b[i].blockId &&
      Math.abs(p.top - b[i].top) < 0.5 &&
      Math.abs(p.left - b[i].left) < 0.5,
  );
}

export type MemoQuoteLayerProps = {
  /** ブロックを引くエディタ（まだ無い間は null） */
  editor: any | null;
  /** エディタの外枠（印のポータル先）。null の間は何も描かない */
  wrapperEl: HTMLElement | null | undefined;
  captureIndex: CaptureIndex | null | undefined;
  /** 編集できる画面か。false（アーカイブ・ゴミ箱）なら「本文に反映」「紐づけを外す」を出さない */
  editable: boolean;
  /** 「メモを開く」（メモのピークを開く） */
  onOpenMemo?: (memoId: string) => void;
  /** モバイルで全画面オーバーレイが開いている間は描かない */
  hidden?: boolean;
};

export function MemoQuoteLayer({
  editor,
  wrapperEl,
  captureIndex,
  editable,
  onOpenMemo,
  hidden = false,
}: MemoQuoteLayerProps) {
  // 言語切替でラベルを引き直す（モジュールスコープの t() は自前で購読しないと古いまま）
  useLocaleSubscription();
  const store = useMemoQuoteStoreOptional();
  const quotes = store?.quotes;
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<{ blockId: string; anchor: HTMLElement } | null>(null);

  const compute = useCallback(() => {
    if (!wrapperEl || !quotes || quotes.size === 0) {
      setPlacements((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const rootRect = wrapperEl.getBoundingClientRect();
    const next: Placement[] = [];
    wrapperEl.querySelectorAll<HTMLElement>('[data-node-type="blockOuter"]').forEach((outer) => {
      const blockId = outer.getAttribute("data-id");
      if (!blockId || !quotes.has(blockId)) return;
      // 外枠の最初の .bn-block-content が自分の中身（子ブロックの中身は DOM 上その後ろに並ぶ）
      const content = outer.querySelector<HTMLElement>(".bn-block-content");
      // 引用ブロックでなくなったもの（段落や見出しに変えた）には、紐づけが残っていても印を出さない
      if (!content || content.getAttribute("data-content-type") !== "quote") return;
      const anchorEl = content.querySelector<HTMLElement>("blockquote") ?? content;
      const rect = anchorEl.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const pos = memoChipPosition(
        { top: rect.top, left: rect.left, right: rect.right },
        rootRect,
        { top: wrapperEl.scrollTop, left: wrapperEl.scrollLeft },
      );
      // 1 行の引用は印が下へはみ出すので、ブロックの高さに合わせて上の余白を詰める
      pos.top -= MEMO_CHIP_INSET - memoQuoteChipInset(rect.height, MEMO_CHIP_INSET);
      next.push({ blockId, ...pos });
    });
    setPlacements((prev) => (samePlacements(prev, next) ? prev : next));
  }, [wrapperEl, quotes]);

  // 位置の測り直し: 本文の変化・リサイズ。連続した変化は 1 フレームにまとめる
  useEffect(() => {
    if (!wrapperEl) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    schedule();
    const isChipNode = (n: Node) => n instanceof Element && n.hasAttribute("data-memo-chip");
    const observer = new MutationObserver((records) => {
      // 自分の印の出し入れでは測り直さない（hover のたびに出入りするため）
      const mine = records.every((r) => {
        if (r.target instanceof Element && r.target.closest("[data-memo-chip]")) return true;
        if (r.type !== "childList") return false;
        const touched = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
        return touched.length > 0 && touched.every(isChipNode);
      });
      if (!mine) schedule();
    });
    observer.observe(wrapperEl, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "data-content-type"],
    });
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(wrapperEl);
    }
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [wrapperEl, compute]);

  // マウスが載っているブロック。印の上にいる間も「そのブロックの上」として扱う
  // （印は本文の DOM の外にあるため）
  useEffect(() => {
    if (!wrapperEl) return;
    const onOver = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest) return;
      const id =
        el.closest("[data-memo-chip]")?.getAttribute("data-memo-chip") ??
        el.closest('[data-node-type="blockOuter"]')?.getAttribute("data-id") ??
        null;
      setHoveredId(id);
    };
    const onLeave = () => setHoveredId(null);
    wrapperEl.addEventListener("mouseover", onOver);
    wrapperEl.addEventListener("mouseleave", onLeave);
    return () => {
      wrapperEl.removeEventListener("mouseover", onOver);
      wrapperEl.removeEventListener("mouseleave", onLeave);
    };
  }, [wrapperEl]);

  // 選択中のブロック
  useEffect(() => {
    const tiptap = editor?._tiptapEditor;
    if (!tiptap?.on) return;
    const update = () => {
      const next = readSelectedBlockIds(editor);
      setSelectedIds((prev) => (sameSet(prev, next) ? prev : next));
    };
    update();
    tiptap.on("selectionUpdate", update);
    return () => tiptap.off?.("selectionUpdate", update);
  }, [editor]);

  // ブロックが消えた・紐づけを外したら小窓も閉じる
  const openPlacement = open ? placements.find((p) => p.blockId === open.blockId) : undefined;
  useEffect(() => {
    if (open && !openPlacement) setOpen(null);
  }, [open, openPlacement]);

  // 縦線の style は、本文に実在する紐づけのブロックだけに当てる
  const styleCss = useMemo(() => memoQuoteStyleCss(placements.map((p) => p.blockId)), [placements]);

  if (!wrapperEl || hidden || !store) return null;

  const openRef = open ? quotes?.get(open.blockId) : undefined;
  const openMemo = openRef ? findQuoteMemo(captureIndex, openRef.captureId) : undefined;
  const openStatus = openRef ? memoQuoteStatus(openRef, openMemo) : "synced";

  return (
    <>
      {styleCss && <style id="memo-quote-style" data-graphium-memo-quote>{styleCss}</style>}
      {createPortal(
        placements.map((p) => {
          const ref = quotes?.get(p.blockId);
          if (!ref) return null;
          const active = open?.blockId === p.blockId;
          const visible = active || hoveredId === p.blockId || selectedIds.has(p.blockId);
          const status = memoQuoteStatus(ref, findQuoteMemo(captureIndex, ref.captureId));
          const updated = status === "updated";
          return (
            <MemoChip
              key={p.blockId}
              chipId={p.blockId}
              count={1}
              hideCount
              dot={updated}
              visible={visible}
              active={active}
              label={updated ? t("memoQuote.chipNameUpdated") : t("memoQuote.chipName")}
              usage={t("memoQuote.chipUsage")}
              onClick={(e) => {
                const anchor = e.currentTarget;
                setOpen((prev) => (prev?.blockId === p.blockId ? null : { blockId: p.blockId, anchor }));
              }}
              style={{
                position: "absolute",
                top: p.top,
                left: p.left,
                // 左は印の右端の位置。印の幅ぶん左へ寄せて、引用ブロックの内側の右上に収める
                transform: "translateX(-100%)",
                zIndex: 6,
              }}
            />
          );
        }),
        wrapperEl,
      )}
      {open && openPlacement && openRef && (
        <MemoQuotePopover
          anchor={open.anchor}
          quoteRef={openRef}
          status={openStatus}
          memo={openMemo}
          editable={editable}
          onOpenMemo={onOpenMemo}
          onReflect={
            editable && openMemo && openStatus === "updated"
              ? () => reflectMemoQuote(editor, store, open.blockId, openMemo)
              : undefined
          }
          onUnlink={editable ? () => store.setQuote(open.blockId, null) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
