// メモをノートへ「引用ブロック」として挿入する、3 つの挿入経路（メモ一覧の「挿入」・
// `/memo` のピッカー（メイン／サイドピーク））に共通の関数。
//
// 本文は常に quote ブロック 1 個（buildMemoInsertBlock）。挿入のあと、呼び出し側が
//  - ページの memoQuotes に紐づけを書く（registerMemoQuote）
//  - 変更を保存に回す（markDirty 相当）
//  - メモの usedIn を記録する
// を行う。この関数はブロックを置くところまで（エディタの外へ副作用を出さない）。

import type { CaptureEntry } from "../mobile-capture/capture-store";
import { buildMemoInsertBlock } from "../mobile-capture/memo-insert";
import { buildMemoQuoteRef } from "./memo-quote";
import type { MemoQuoteStore } from "./store";

export type InsertMemoQuoteOptions = {
  /**
   * このブロックの後ろに挿入する。省略すると文書の末尾。
   * ピッカーはカーソルのあるブロック、メモ一覧は末尾（省略）を渡す
   */
  after?: string;
  /**
   * 挿入後、このブロックが空（または `/memo` だけ）なら取り除く。
   * スラッシュメニューで `/memo` と打った行が残らないようにするため
   */
  replaceIfEmpty?: string;
  /** replaceIfEmpty のブロックを取り除く直前に呼ぶ（ラベル・リンクの掃除など） */
  onRemoveBlock?: (blockId: string) => void;
};

/** 空、または `/memo` だけのブロックか（スラッシュメニューを開いた行） */
export function isEmptyOrMemoSlashBlock(block: { content?: unknown } | null | undefined): boolean {
  const content = block?.content;
  if (!Array.isArray(content)) return false;
  if (content.length > 1) return false;
  const first = content[0] as { text?: string } | undefined;
  const text = first?.text?.trim() ?? "";
  return text === "" || text === "/memo";
}

/**
 * メモ 1 件を quote ブロックとして挿入し、新しいブロックの id を返す。
 * 空のメモ・挿入先が引けないときは何も挿入せず null を返す。
 */
export function insertMemoQuote(
  editor: any,
  entry: CaptureEntry,
  opts: InsertMemoQuoteOptions = {},
): string | null {
  if (!editor) return null;
  const block = buildMemoInsertBlock(entry);
  if (!block) return null;

  const doc: any[] = editor.document ?? [];
  const reference = opts.after ? editor.getBlock?.(opts.after) : doc[doc.length - 1];
  if (!reference) return null;

  const inserted = editor.insertBlocks([block], reference, "after");
  const newId: string | undefined = inserted?.[0]?.id;
  if (!newId) return null;

  if (opts.replaceIfEmpty) {
    const target = editor.getBlock?.(opts.replaceIfEmpty);
    // 新しく入れたブロック自身は取り除かない（カーソルのブロック＝挿入先が自分になる経路の保険）
    if (target && target.id !== newId && isEmptyOrMemoSlashBlock(target)) {
      opts.onRemoveBlock?.(target.id);
      editor.removeBlocks([target]);
    }
  }
  return newId;
}

/** 挿入したブロックとメモの紐づけをストアへ書く */
export function registerMemoQuote(
  store: Pick<MemoQuoteStore, "setQuote">,
  blockId: string,
  entry: Pick<CaptureEntry, "id" | "text">,
  now?: string,
): void {
  store.setQuote(blockId, buildMemoQuoteRef(entry, now));
}

/**
 * 「本文に反映」: 引用ブロックの中身を、いまのメモの本文で置き換える。
 * 元のメモが変わっても本文は書き手のものなので、利用者が押したときだけ呼ぶ（自動では呼ばない）。
 * 紐づけの quotedText / quotedAt も更新する。空のメモ・ブロックが引けないときは何もせず false。
 */
export function reflectMemoQuote(
  editor: any,
  store: Pick<MemoQuoteStore, "setQuote">,
  blockId: string,
  entry: CaptureEntry,
  now?: string,
): boolean {
  if (!editor?.getBlock?.(blockId)) return false;
  const block = buildMemoInsertBlock(entry);
  if (!block) return false;
  editor.updateBlock(blockId, { content: block.content });
  store.setQuote(blockId, buildMemoQuoteRef(entry, now));
  return true;
}
