// メモ一覧の「挿入」で渡された依頼（pending）を、ノートの本文に引用ブロックとして入れるフック。
//
// メモ一覧を開くとノートのエディタは外れ、「挿入」でエディタが作り直される。作り直し直後の
// 最初の effect パスでは、初期データの復元（memoQuoteStore.restoreSnapshot）と挿入が同じ commit に
// 並ぶ。復元は Map の「置き換え」なので、挿入が先に走ると登録した紐づけが捨てられ、本文には
// 引用ブロックが入るのに紐づけが無い状態になる。次の 2 つで順序を保証する:
//  - 呼び出し側は、このフックを初期データの復元 effect より「後ろ」に置く（effect は宣言順に走る）
//  - restored() が false の間は何もしない。復元が済んで store が変わると effect が再実行される
//
// 同じ依頼は 1 度しか入れない（依頼の参照で見分ける）。

import { useEffect, useRef } from "react";
import type { CaptureEntry } from "../mobile-capture/capture-store";
import { insertMemoQuote, registerMemoQuote } from "./insert-memo-quote";
import type { MemoQuoteStore } from "./store";

export type PendingMemoInsert = { captureId: string; text: string };

export function usePendingMemoQuoteInsert({
  pending,
  editor,
  restored,
  store,
  onInserted,
}: {
  /** メモ一覧から渡された挿入の依頼。無ければ何もしない */
  pending: PendingMemoInsert | null | undefined;
  /** 本文のエディタ（まだ無い間は null。届いたら effect が再実行される） */
  editor: any | null | undefined;
  /** 初期データの復元が済んだか（復元する文書が無いなら true）。ref を読む関数を渡す */
  restored: () => boolean;
  store: MemoQuoteStore;
  /** 入れ終えたとき（挿入できなかった場合も）。保存の依頼・メモ一覧への通知を行う */
  onInserted?: () => void;
}): void {
  const insertedRef = useRef<unknown>(null);
  useEffect(() => {
    if (!pending || !editor) return;
    if (!restored()) return;
    if (insertedRef.current === pending) return;
    insertedRef.current = pending;
    // 引用ブロック 1 個として文書の末尾に挿入し、元のメモと紐づける（/memo のピッカーと同じ関数）
    const entry: CaptureEntry = {
      id: pending.captureId,
      text: pending.text,
      createdAt: new Date().toISOString(),
    };
    const blockId = insertMemoQuote(editor, entry);
    if (blockId) registerMemoQuote(store, blockId, entry);
    onInserted?.();
    // restored は ref を読むだけの関数。store は復元で変わるので、依存に入れて再実行のきっかけにする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, editor, store, onInserted]);
}
