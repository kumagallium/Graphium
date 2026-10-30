// ノートに貼った素材（画像・動画・PDF）のブロックに、その素材に付いたメモの印を重ねる層。
//
// 素材の全画面の「メモ」タブと同じメモ（filterMemosByAsset）の件数を、ブロックの絵の
// 内側の右上に出す。押すと小窓（MemoPopover）が開き、読める・その場で書ける。
// 印は絵の内側にあり、PROV ラベルの帯（ブロックの右端の外）とは場所を奪い合わない。
// ブロックに付けたメモ（¶）は今まで通りブロック側に印を出さない（NoteMemosSection）。
//
// 作り方は ProvIndicatorLayer / IndexTableIconLayer と同じ「層」方式:
// エディタの外枠（wrapperEl）の中へポータルで描き、ブロックの DOM は
// `[data-id][data-node-type="blockOuter"]` から引くだけで触らない。画像の DOM に直接ボタンを
// 差すと、同意前の外部画像の差し替え（gated-media-spec）や BlockNote の DOM 作り直しと衝突する。
//
// 出すのはメインのノート編集だけ。サイドピーク・共有ノート・テンプレート編集・印刷には
// 置かない（呼び出し側が置かないことで保つ）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, useLocaleSubscription } from "../../i18n";
import type { CaptureIndex } from "../mobile-capture";
import { filterMemosByAsset } from "./AssetMemosSection";
import { collectMaterialBlocks, resolveBlockMaterial, MEMO_ANCHOR_BLOCK_TYPES } from "./block-material";
import { MemoChip, canHoverDevice, isMemoChipVisible } from "./MemoChip";
import { setMaterialMemoOpener } from "./memo-toolbar";
import { AssetMemoPopover } from "./AssetMemoPopover";
import {
  getLatestMediaIndex,
  MEDIA_INDEX_CHANGED_EVENT,
  type MediaIndex,
  type MediaIndexEntry,
  type MediaType,
} from "./media-index";

/** 絵の矩形の右上から内側へ寄せる距離 */
export const MEMO_CHIP_INSET = 8;

type Rect = { top: number; left: number; right: number };

/**
 * 印の置き場所（外枠のローカル座標。スクロール量込み）。
 * left は絵の右端から内側 MEMO_CHIP_INSET の位置＝印の右端（描くときに左へ寄せる）。
 */
export function memoChipPosition(
  anchor: Rect,
  root: Rect,
  scroll: { top: number; left: number },
): { top: number; left: number } {
  return {
    top: anchor.top - root.top + scroll.top + MEMO_CHIP_INSET,
    left: anchor.right - root.left + scroll.left - MEMO_CHIP_INSET,
  };
}

/**
 * ブロックの中身（.bn-block-content）から、印を重ねる「絵の要素」を探す。
 * - 画像・動画: BlockNote の層 2（.bn-file-block-content-wrapper）
 * - PDF: ページの表示域（[data-memo-anchor]。ヘッダーのページ送りと重ねないため）。
 *   無ければブロックの最初の子要素
 */
export function findMemoAnchorEl(content: Element): HTMLElement | null {
  const fileWrapper = content.querySelector<HTMLElement>(":scope > .bn-file-block-content-wrapper");
  if (fileWrapper) return fileWrapper;
  const marked = content.querySelector<HTMLElement>("[data-memo-anchor]");
  if (marked) return marked;
  return (content.firstElementChild as HTMLElement | null) ?? null;
}

/**
 * 要素の縦スクロールバーの幅（出ていなければ 0）。overflow:auto の表示域（PDF）で、
 * 印がスクロールバーの上端に重ならないよう、右の基準をこの分だけ内側へ寄せる。
 * オーバーレイ式のスクロールバー（macOS）や、スクロールが無い間は 0。
 */
export function scrollbarGutter(el: HTMLElement): number {
  const gutter = el.offsetWidth - el.clientWidth - (el.clientLeft || 0) * 2;
  return gutter > 0 ? gutter : 0;
}

type Placement = {
  blockId: string;
  entry: MediaIndexEntry;
  top: number;
  left: number;
};

function samePlacements(a: Placement[], b: Placement[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (p, i) =>
      p.blockId === b[i].blockId &&
      p.entry === b[i].entry &&
      Math.abs(p.top - b[i].top) < 0.5 &&
      Math.abs(p.left - b[i].left) < 0.5,
  );
}

/** 選択範囲にかかっているブロックの ID（画像を選んだ＝NodeSelection のときもその画像） */
export function readSelectedBlockIds(editor: any): Set<string> {
  const ids = new Set<string>();
  try {
    const state = editor?._tiptapEditor?.state;
    const sel = state?.selection;
    if (!sel) return ids;
    state.doc.nodesBetween(sel.from, sel.to, (node: any) => {
      if (node.type?.name === "blockContainer" && node.attrs?.id) ids.add(node.attrs.id);
      return true;
    });
  } catch {
    // 見せ方の補助。取れなければ「選択なし」として扱う
  }
  return ids;
}

export function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

const CONTENT_SELECTOR = [...MEMO_ANCHOR_BLOCK_TYPES]
  .map((type) => `.bn-block-content[data-content-type="${type}"]`)
  .join(", ");

export type MemoBlockLayerProps = {
  /** ブロックを引くエディタ（まだ無い間は null） */
  editor: any | null;
  /** エディタの外枠（印のポータル先）。null の間は何も描かない */
  wrapperEl: HTMLElement | null | undefined;
  captureIndex: CaptureIndex | null | undefined;
  /** 索引の変化で測り直すための参照（判定そのものは getLatestMediaIndex の最新を使う） */
  mediaIndex?: MediaIndex | null;
  /**
   * メモを書く。渡さなければ小窓は読むだけ（アーカイブ・ゴミ箱のノート）。
   * 素材についてのメモなので sourceNote は付けない（素材の「メモ」タブの書く欄と同じ）
   */
  onCreateMemo?: (text: string, asset: { fileId: string; type: MediaType }) => void | Promise<void>;
  /** 「全画面で開く」（画像のダブルクリックと同じ着地）。無ければ見出しに出さない */
  onOpenMedia?: (fileId: string) => void;
  /** 小窓の項目を押したとき、メモのピークを開く */
  onOpenMemo?: (memoId: string) => void;
  /** モバイルで全画面オーバーレイが開いている間は描かない */
  hidden?: boolean;
};

export function MemoBlockLayer({
  editor,
  wrapperEl,
  captureIndex,
  mediaIndex,
  onCreateMemo,
  onOpenMedia,
  onOpenMemo,
  hidden = false,
}: MemoBlockLayerProps) {
  // 言語切替でラベルを引き直す（モジュールスコープの t() は自前で購読しないと古いまま）
  useLocaleSubscription();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<{ blockId: string; anchor: HTMLElement } | null>(null);
  const [canHover] = useState(canHoverDevice);

  const compute = useCallback(() => {
    if (!wrapperEl || !editor) {
      setPlacements((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    // 判定は画像のサイドピークと同じ源（React state の mediaIndex は更新が遅れる窓がある）
    const index = getLatestMediaIndex() ?? mediaIndex ?? null;
    const rootRect = wrapperEl.getBoundingClientRect();
    // 文書は 1 回だけ走査する（ブロックごとの getBlock は毎回先頭から探すため）
    const materialBlocks = collectMaterialBlocks(editor);
    const next: Placement[] = [];
    wrapperEl.querySelectorAll<HTMLElement>(CONTENT_SELECTOR).forEach((content) => {
      const outer = content.closest<HTMLElement>('[data-node-type="blockOuter"]');
      const blockId = outer?.getAttribute("data-id");
      if (!blockId) return;
      // 走査で引けなければ（想定外の形）従来どおり getBlock に戻す
      const block = materialBlocks?.get(blockId) ?? editor.getBlock?.(blockId);
      const entry = resolveBlockMaterial(block, index);
      if (!entry) return;
      const anchorEl = findMemoAnchorEl(content);
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      // DOMRect はスプレッドできない（getter）。右だけ縦スクロールバーの幅ぶん内側へ
      const pos = memoChipPosition(
        { top: rect.top, left: rect.left, right: rect.right - scrollbarGutter(anchorEl) },
        rootRect,
        { top: wrapperEl.scrollTop, left: wrapperEl.scrollLeft },
      );
      next.push({ blockId, entry, ...pos });
    });
    setPlacements((prev) => (samePlacements(prev, next) ? prev : next));
  }, [wrapperEl, editor, mediaIndex]);

  // 位置の測り直し: 本文の変化・リサイズ・画像の読み込み・素材の索引の変化。
  // 印は外枠の中身として一緒にスクロールするので、スクロール自体では動かさない。
  // 連続した変化は 1 フレームにまとめる
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
      // 自分の印の出し入れ（外枠直下の追加・削除、印の中身の変化）では測り直さない。
      // 0 件の印は hover のたびに出入りするので、これを除かないと hover のたびに測り直しが走る
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
      // class は見た目の切り替え（hover の強調・選択の枠など）で頻繁に変わるので観測しない。
      // 大きさの変化は style / width / height（画像のリサイズ）と ResizeObserver・load で拾う
      attributeFilter: ["style", "src", "width", "height", "data-content-type"],
    });
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(wrapperEl);
    }
    window.addEventListener("resize", schedule);
    // load は bubble しない。画像・動画の読み込みで高さが変わるので捕まえる
    wrapperEl.addEventListener("load", schedule, true);
    window.addEventListener(MEDIA_INDEX_CHANGED_EVENT, schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      wrapperEl.removeEventListener("load", schedule, true);
      window.removeEventListener(MEDIA_INDEX_CHANGED_EVENT, schedule);
    };
  }, [wrapperEl, compute]);

  // マウスが載っているブロック（0 件の印を hover で出す）。
  // 印の上にいる間も「そのブロックの上」として扱う（印は本文の DOM の外にあるため）
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

  // 選択中のブロック（0 件の印を選択中も出す）
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

  // 素材ごとのメモ（素材の「メモ」タブと同じ集合）。メモの追加・削除は captureIndex の変化で即反映。
  // 位置がずれるたび（文字入力・リサイズ）に全メモを走査し直さないよう、依存は「素材の集合」と
  // captureIndex だけにする（素材の名前が変われば名前一致の判定が変わるので鍵に含める）
  const entriesKey = placements.map((p) => `${p.entry.fileId}\u0000${p.entry.name}`).join("\u0001");
  const memosByFileId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof filterMemosByAsset>>();
    for (const p of placements) {
      if (!map.has(p.entry.fileId)) map.set(p.entry.fileId, filterMemosByAsset(captureIndex, p.entry));
    }
    return map;
    // placements は entriesKey が変わったときだけ読み直す（位置の変化では走らせない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesKey, captureIndex]);

  // 書式ツールバーの「メモ」ボタン（素材ブロックを選んだとき）から小窓を開く口。
  // 起点は、そのブロックの印（あれば）か、無ければ絵の要素。印は 0 件だと選択中だけ出るので、
  // 選択を外した後（タッチ端末など）でも小窓の起点が残るようにする
  const placementsRef = useRef<Placement[]>(placements);
  placementsRef.current = placements;
  useEffect(() => {
    if (!editor || !wrapperEl || hidden) return;
    setMaterialMemoOpener(editor, (blockId) => {
      if (!placementsRef.current.some((p) => p.blockId === blockId)) return false;
      const chip = Array.from(wrapperEl.querySelectorAll<HTMLElement>("[data-memo-chip]")).find(
        (el) => el.getAttribute("data-memo-chip") === blockId,
      );
      let anchor: HTMLElement | null = chip ?? null;
      if (!anchor) {
        const outer = Array.from(wrapperEl.querySelectorAll<HTMLElement>('[data-node-type="blockOuter"]')).find(
          (el) => el.getAttribute("data-id") === blockId,
        );
        const content = outer?.querySelector<HTMLElement>(".bn-block-content");
        anchor = content ? findMemoAnchorEl(content) : null;
      }
      if (!anchor) return false;
      setOpen({ blockId, anchor });
      return true;
    });
    return () => setMaterialMemoOpener(editor, null);
  }, [editor, wrapperEl, hidden]);

  // ブロックが消えた・素材に引けなくなったら小窓も閉じる
  const openPlacement = open ? placements.find((p) => p.blockId === open.blockId) : undefined;
  useEffect(() => {
    if (open && !openPlacement) setOpen(null);
  }, [open, openPlacement]);

  if (!wrapperEl || hidden) return null;

  const popoverMemos = openPlacement ? (memosByFileId.get(openPlacement.entry.fileId) ?? []) : [];

  return (
    <>
      {createPortal(
        placements.map((p) => {
          const count = memosByFileId.get(p.entry.fileId)?.length ?? 0;
          // 読むだけ（アーカイブ・ゴミ箱）で 0 件なら、読むものも書く欄も無いので印を出さない
          if (count === 0 && !onCreateMemo) return null;
          const active = open?.blockId === p.blockId;
          const visible = isMemoChipVisible({
            count,
            hovered: hoveredId === p.blockId,
            selected: selectedIds.has(p.blockId),
            active,
            canHover,
          });
          return (
            <MemoChip
              key={p.blockId}
              chipId={p.blockId}
              count={count}
              visible={visible}
              active={active}
              label={count > 0 ? t("memoAnchor.chipCount", { count: String(count) }) : t("memoAnchor.chipWrite")}
              usage={t("memoAnchor.chipUsage")}
              onClick={(e) => {
                const anchor = e.currentTarget;
                setOpen((prev) => (prev?.blockId === p.blockId ? null : { blockId: p.blockId, anchor }));
              }}
              style={{
                position: "absolute",
                top: p.top,
                left: p.left,
                // 左は印の右端の位置。印の幅ぶん左へ寄せて、絵の内側の右上に収める
                transform: "translateX(-100%)",
                zIndex: 6,
              }}
            />
          );
        }),
        wrapperEl,
      )}
      {open && openPlacement && (
        <AssetMemoPopover
          anchor={open.anchor}
          entry={openPlacement.entry}
          memos={popoverMemos}
          onCreate={
            onCreateMemo
              ? (text) =>
                  onCreateMemo(text, {
                    fileId: openPlacement.entry.fileId,
                    type: openPlacement.entry.type,
                  })
              : undefined
          }
          onOpenFull={onOpenMedia ? () => onOpenMedia(openPlacement.entry.fileId) : undefined}
          onOpenMemo={onOpenMemo}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
