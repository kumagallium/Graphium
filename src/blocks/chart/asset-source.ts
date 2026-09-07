// チャートの素材ソース（データ素材）を表にする
//
// 系列が `asset:<fileId>` を指すとき、素材の実体（区切りテキスト）を読んで
// headers / rows にする。ノート内のテーブルと違って実体はプロバイダの向こうに
// あるので読み込みは非同期 — 「まだ読めていない」状態がある。
//
// 本文の読み込みとキャッシュは features/data-import/asset-text に置いてあり、
// データ表ブロックと共用する（同じ素材を図と表で 2 回読まない）。ここに残すのは
// 「本文 + 読み方 → チャートが読む表」の変換だけ。
//
// 表への変換は取り込みダイアログと同じ parseDelimited を、系列側が持つ読み方
// （ChartAssetSource.options）で呼ぶだけ。ノートに表として取り込んだときと同じ
// 列・同じ行が出るので、「表にしてから描く」のと「素材から直接描く」で図が変わらない。

import { loadAssetText, primeAssetText, clearAssetTextCache } from "../../features/data-import/asset-text";
// 取り込みダイアログ本体（React）を巻き込まないよう、純関数のモジュールを直接読む
import { parseDelimited } from "../../features/data-import/parse";
import type { DelimitedImportOptions } from "../../features/data-import/types";
import type { ChartAssetSource } from "./chart-config";
import type { TableData } from "./chart-data";

// 既存の呼び出し元（view / stories / tests）は従来どおりここから読める
export { loadAssetText, primeAssetText, clearAssetTextCache };

/** 本文 + 読み方 → チャートが読む表 */
export function tableFromAssetText(text: string, options: DelimitedImportOptions): TableData {
  const parsed = parseDelimited(text, options);
  return { headers: parsed.headers, rows: parsed.rows };
}

/** 素材ソース → 表。読めなければ reject（呼び出し側は参照切れとして扱う） */
export async function loadAssetTable(source: ChartAssetSource): Promise<TableData> {
  const text = await loadAssetText(source.fileId);
  return tableFromAssetText(text, source.options);
}
