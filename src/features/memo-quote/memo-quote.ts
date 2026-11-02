// 「メモの引用」ブロックの純関数（React 非依存）。
//
// 引用の本文は標準の quote ブロック、紐づけはページの memoQuotes（blockId → MemoQuoteRef）。
// ここは「紐づけが今どういう状態か」「どの紐づけが本文に生きているか」「見た目の CSS」を
// 決めるだけで、ストアやエディタは触らない。

import type { MemoQuoteRef } from "../../lib/document-types";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture/capture-store";

/**
 * メモの色（黄土系）。引用ブロックの左の縦線と、素材一覧・詳細のメモの型バッジ
 * （MaterialListItem / material-detail-header / material-metadata-section の TYPE_HEX.memo）が
 * ここを参照する。色トークンは持たないので、メモの色はここ 1 か所で定義する。
 */
export const MEMO_QUOTE_COLOR = "#b08d3a";

/** 右上の印（アイコンだけのピル）が本文に重ならないよう、引用ブロックの右に空ける幅 */
export const MEMO_QUOTE_CHIP_GUTTER = 40;

/**
 * 紐づけの状態。
 * - synced: 元のメモが引用したときのまま
 * - updated: 元のメモが引用後に書き換わっている（本文は書き手のものなので自動では変えない）
 * - deleted: 元のメモがゴミ箱にある・完全に削除された（本文はそのまま）
 */
export type MemoQuoteStatus = "synced" | "updated" | "deleted";

/** 元のメモを引く。完全削除されていれば undefined（ゴミ箱のメモは deletedAt 付きで返す） */
export function findQuoteMemo(
  captureIndex: CaptureIndex | null | undefined,
  captureId: string,
): CaptureEntry | undefined {
  return captureIndex?.captures.find((c) => c.id === captureId);
}

/** 紐づけの状態を決める */
export function memoQuoteStatus(
  ref: MemoQuoteRef,
  memo: CaptureEntry | null | undefined,
): MemoQuoteStatus {
  if (!memo || memo.deletedAt) return "deleted";
  return memo.text === ref.quotedText ? "synced" : "updated";
}

/** 引用した時点の紐づけを作る（挿入・「本文に反映」で使う） */
export function buildMemoQuoteRef(
  entry: Pick<CaptureEntry, "id" | "text">,
  now: string = new Date().toISOString(),
): MemoQuoteRef {
  return { captureId: entry.id, quotedAt: now, quotedText: entry.text };
}

/** ブロック木のうち、種別が quote のブロックの ID（子ブロックを含む）。紐づけが生きているかの判定に使う */
export function collectQuoteBlockIds(blocks: readonly any[] | null | undefined): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly any[]) => {
    for (const block of list) {
      if (block?.id && block.type === "quote") ids.add(block.id);
      if (Array.isArray(block?.children) && block.children.length > 0) walk(block.children);
    }
  };
  walk(blocks ?? []);
  return ids;
}

/**
 * 保存に書く紐づけを、本文に実在する quote ブロックのものだけにする。
 * 消したブロックの項目（メモの全文を quotedText に持つ）をファイルに残さないため。
 * ストアの項目は消さない — Undo でブロックが戻れば、次の保存で紐づけごと戻る。
 * 残る項目が無ければ undefined（項目ごと省く）。
 */
export function pruneMemoQuotes(
  snapshot: Record<string, MemoQuoteRef>,
  blocks: readonly any[] | null | undefined,
): Record<string, MemoQuoteRef> | undefined {
  const live = collectQuoteBlockIds(blocks);
  const kept: Record<string, MemoQuoteRef> = {};
  for (const [blockId, ref] of Object.entries(snapshot)) {
    if (live.has(blockId)) kept[blockId] = ref;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** 印の高さ（MemoChip の height と同じ） */
const MEMO_QUOTE_CHIP_HEIGHT = 22;

/**
 * 印を置く上からの余白。通常は画像用と同じ 8px だが、1 行の引用ブロックは印の高さに
 * 8px の余白が収まらず下へはみ出すので、ブロックの高さに合わせて縦中央に寄せる。
 */
export function memoQuoteChipInset(blockHeight: number, defaultInset: number): number {
  const centered = (blockHeight - MEMO_QUOTE_CHIP_HEIGHT) / 2;
  return Math.max(0, Math.min(defaultInset, centered));
}

/**
 * 本文に生きている紐づけだけを返す（ブロックが無くなったものは無視する）。
 * 層・グラフ・書き出しはいずれもこれを通す — 掃除し損ねた紐づけが表に出ないように。
 */
export function liveMemoQuoteEntries(
  memoQuotes: Record<string, MemoQuoteRef> | Map<string, MemoQuoteRef> | undefined | null,
  liveBlockIds: ReadonlySet<string>,
): Array<[blockId: string, ref: MemoQuoteRef]> {
  if (!memoQuotes) return [];
  const entries = memoQuotes instanceof Map ? [...memoQuotes.entries()] : Object.entries(memoQuotes);
  return entries.filter(([blockId, ref]) => liveBlockIds.has(blockId) && Boolean(ref?.captureId));
}

/**
 * 紐づいた引用ブロックの左の縦線をメモの色にする CSS。
 * BlockNote の再描画で DOM 属性が消えるため、AlignmentStyleLayer と同じく blockId 指定の
 * CSS を <style> で注入する。ハイライト（doc-provenance-highlight）とは別の style に置く。
 * 子結合子（>）で「そのブロック自身の中身」に限る — 子孫結合子だと、紐づいたブロックの子に
 * インデントした通常の quote にも縦線が付いてしまう
 * （DOM は blockOuter > blockContainer > .bn-block-content、子ブロックはその後ろの blockGroup 内）。
 */
export function memoQuoteStyleCss(blockIds: readonly string[]): string {
  const safe = blockIds.filter((id) => typeof id === "string" && id.length > 0);
  if (safe.length === 0) return "";
  const escape = (id: string) => id.replace(/["\\]/g, "\\$&");
  return safe
    .map(
      (id) =>
        `[data-id="${escape(id)}"][data-node-type="blockOuter"] > [data-node-type="blockContainer"] > [data-content-type="quote"] blockquote { border-left-color: ${MEMO_QUOTE_COLOR}; padding-right: ${MEMO_QUOTE_CHIP_GUTTER}px; }`,
    )
    .join("\n");
}
