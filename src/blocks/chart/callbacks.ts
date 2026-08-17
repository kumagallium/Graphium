// チャートブロックのコールバックレジストリ
//
// 「素材のデータから系列を足す」には素材ピッカーと取り込みダイアログが要るが、
// どちらもアプリ側（note-app / SidePeek）が持つモーダルで、ブロックの中からは
// 直接開けない。bookmark や shared-citation と同じく、エディタ単位で登録した
// コールバックを引く形にして view.tsx との循環 import を避ける。
//
// 結果は「どの素材を・どう読んで・どんな表になったか」を丸ごと返す。ブロック側は
// それを系列と素材ソース（config.assetSources）に写すだけで、読み直しはしない。

import type { DelimitedImportOptions, ParsedDelimited } from "../../features/data-import/types";

export type ChartAssetSourceResult = {
  /** 素材の fileId（既存素材ならその ID、新規ファイルなら登録後の ID） */
  fileId: string;
  fileName: string;
  /** 取り込みダイアログで確定した読み方 */
  options: DelimitedImportOptions;
  /** その読み方で読んだ結果（描画をすぐ始めるために持ち回る） */
  parsed: ParsedDelimited;
  /** 素材の本文（キャッシュに登録して読み直しを避ける） */
  text: string;
};

export type ChartAssetSourceRequest = (onDone: (result: ChartAssetSourceResult) => void) => void;

const requestCallbacks = new WeakMap<object, ChartAssetSourceRequest>();

/** ホスト（note-app / SidePeek）が、そのエディタ用の素材ピッカー経路を登録する */
export function setChartAssetSourceCallback(
  editor: object | null | undefined,
  fn: ChartAssetSourceRequest | null,
): void {
  if (!editor) return;
  if (fn) requestCallbacks.set(editor, fn);
  else requestCallbacks.delete(editor);
}

/** このエディタで素材から系列を足せるか（登録が無ければ UI の入口を出さない） */
export function canPickChartAssetSource(editor: object | null | undefined): boolean {
  return !!editor && requestCallbacks.has(editor);
}

/** 素材ピッカー → 取り込みダイアログを開き、確定したら onDone を呼ぶ */
export function requestChartAssetSource(
  editor: object | null | undefined,
  onDone: (result: ChartAssetSourceResult) => void,
): boolean {
  if (!editor) return false;
  const fn = requestCallbacks.get(editor);
  if (!fn) return false;
  fn(onDone);
  return true;
}
