// データ表ブロック → ホスト（note-app）へのコールバック
//
// 「取り込み設定を見直す」はダイアログ（DataImportModal）と素材の読み直しを
// 伴うので、ブロック単体では完結しない。チャートの素材選択と同じく、ホストが
// エディタごとにコールバックを登録し、ブロックはそれを呼ぶだけにする。
//
// エディタごとにするのは、SidePeek のエディタに載ったブロックからも同じダイアログが
// 開けてしまうと、確定先がメインエディタになって別のノートに表が挿さるため。登録の
// 無いエディタではバッジを押せない（hasDataTableReimportCallback）。
//
// 登録は購読できる（subscribeDataTableReimport）。ページ読み込み時はブロックの描画が
// ホストの useEffect（登録）より先に走るので、描画時に一度見るだけだとバッジが無効の
// まま残る。登録の変化で描き直せるようにしておく。

import type { TableSource } from "../../lib/document-types";

type ReimportCallback = (blockId: string, source: TableSource) => void;

const callbacks = new WeakMap<object, ReimportCallback>();
const listeners = new Set<() => void>();

/** ホストが登録する。null で解除 */
export function setDataTableReimportCallback(editor: object, cb: ReimportCallback | null): void {
  if (cb) callbacks.set(editor, cb);
  else callbacks.delete(editor);
  for (const listener of listeners) listener();
}

/** 登録の変化を購読する（useSyncExternalStore 用）。戻り値で解除 */
export function subscribeDataTableReimport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** このエディタで再取り込みを受け付けるか */
export function hasDataTableReimportCallback(editor: object | null | undefined): boolean {
  return !!editor && callbacks.has(editor);
}

/** 登録済みなら再取り込みを依頼して true。未登録（Storybook・SidePeek 等）なら false */
export function requestDataTableReimport(editor: object, blockId: string, source: TableSource): boolean {
  const cb = callbacks.get(editor);
  if (!cb) return false;
  cb(blockId, source);
  return true;
}
