// チャートの素材ソース（データ素材）を表にする
//
// 系列が `asset:<fileId>` を指すとき、素材の実体（区切りテキスト）を読んで
// headers / rows にする。ノート内のテーブルと違って実体はプロバイダの向こうに
// あるので読み込みは非同期 — 「まだ読めていない」状態がある。ここではその読み込みと、
// 同じ素材を複数のチャート・複数回の描画で読み直さないためのキャッシュを持つ。
//
// 表への変換は取り込みダイアログと同じ parseDelimited を、系列側が持つ読み方
// （ChartAssetSource.options）で呼ぶだけ。ノートに表として取り込んだときと同じ
// 列・同じ行が出るので、「表にしてから描く」のと「素材から直接描く」で図が変わらない。

import { getActiveProvider } from "../../lib/storage/registry";
// 取り込みダイアログ本体（React）を巻き込まないよう、純関数のモジュールを直接読む
import { parseDelimited } from "../../features/data-import/parse";
import { readDataFileText } from "../../features/data-import/read-file";
import type { DelimitedImportOptions } from "../../features/data-import/types";
import type { ChartAssetSource } from "./chart-config";
import type { TableData } from "./chart-data";

/**
 * 素材テキストのキャッシュ（fileId → 本文）。
 * 素材の実体は fileId に対して不変（同じ中身は同じ素材に寄せられ、別の中身は
 * 別の fileId になる）ので、一度読めた本文はアプリを閉じるまで使い回してよい。
 * 失敗は溜めない — 素材登録の直後で実体がまだ無い等、後で読める場合がある。
 */
const textCache = new Map<string, Promise<string>>();

/** 取り込みダイアログで読んだ本文をそのまま登録する（描画のために読み直さない） */
export function primeAssetText(fileId: string, text: string): void {
  textCache.set(fileId, Promise.resolve(text));
}

/** 素材の本文を読む（キャッシュ付き）。素材が無い・読めないときは reject */
export function loadAssetText(fileId: string): Promise<string> {
  const cached = textCache.get(fileId);
  if (cached) return cached;
  const loading = (async () => {
    const provider = getActiveProvider();
    const blobUrl = await provider.getMediaBlobUrl(fileId);
    const res = await fetch(blobUrl);
    if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
    return readDataFileText(await res.blob());
  })();
  textCache.set(fileId, loading);
  loading.catch(() => {
    if (textCache.get(fileId) === loading) textCache.delete(fileId);
  });
  return loading;
}

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

/** テスト・ストーリー用: キャッシュを空にする */
export function clearAssetTextCache(): void {
  textCache.clear();
}
