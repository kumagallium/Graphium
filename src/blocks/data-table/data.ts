// データ表ブロックのデータ読み込み
//
// 行の実体は素材（区切りテキスト）にある。本文はプロバイダ越しに読む
// （features/data-import/asset-text のキャッシュ）ので非同期になる。ここでは
// 「本文 + 読み方 → headers / rows」の結果を、素材と読み方の組ごとに溜める。
// 同じ素材を同じ読み方で見せるブロックが複数あっても、パースは 1 回で済む。
//
// Markdown 書き出しのように同期でしか呼べない場所のため、本文が既に読めていれば
// 同期で結果を返す peekDataTable も持つ。

import { loadAssetText, peekAssetText } from "../../features/data-import/asset-text";
import { parseDelimited } from "../../features/data-import/parse";
import type { DelimitedImportOptions } from "../../features/data-import/types";
import type { TableSource } from "../../lib/document-types";
import { parseDataTableSource } from "./source";

export type DataTableData = {
  headers: string[];
  rows: string[][];
};

const parsedCache = new Map<string, DataTableData>();

// 表が新しく読めたことを知りたい側（計算列の配布・チャートの再描画）。
// 通知は非同期にする — peekDataTable は描画中にも呼ばれるので、その場で他の
// コンポーネントの setState を走らせると React が警告する
const listeners = new Set<() => void>();
function notifyArrived(): void {
  if (listeners.size === 0) return;
  setTimeout(() => {
    for (const listener of listeners) listener();
  }, 0);
}

/** 素材の表が新しく読めたときに呼ばれる。戻り値で解除 */
export function subscribeDataTableData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function cacheKey(fileId: string, options: DelimitedImportOptions): string {
  return `${fileId}\n${JSON.stringify(options)}`;
}

function parseInto(fileId: string, options: DelimitedImportOptions, text: string): DataTableData {
  const parsed = parseDelimited(text, options);
  const data = { headers: parsed.headers, rows: parsed.rows };
  parsedCache.set(cacheKey(fileId, options), data);
  notifyArrived();
  return data;
}

/** ブロック（BlockNote の JSON）から同期で表を引く。dataTable でない・未読なら null */
export function peekDataTableFromBlock(block: any): DataTableData | null {
  if (!block || block.type !== "dataTable") return null;
  const source = parseDataTableSource(block.props?.source);
  return source ? peekDataTable(source) : null;
}

/** 本文が読めていれば同期で表を返す。まだなら null */
export function peekDataTable(source: TableSource): DataTableData | null {
  if (!source.fileId) return null;
  const cached = parsedCache.get(cacheKey(source.fileId, source.options));
  if (cached) return cached;
  const text = peekAssetText(source.fileId);
  if (text === undefined) return null;
  return parseInto(source.fileId, source.options, text);
}

/** 素材を読んで表にする。素材が無い・読めないときは reject */
export async function loadDataTable(source: TableSource): Promise<DataTableData> {
  if (!source.fileId) throw new Error("data table source has no fileId");
  const cached = peekDataTable(source);
  if (cached) return cached;
  const text = await loadAssetText(source.fileId);
  return parseInto(source.fileId, source.options, text);
}

/** テスト・ストーリー用 */
export function clearDataTableCache(): void {
  parsedCache.clear();
}
