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
import { SYNC_PARSE_MAX_CHARS } from "../../features/data-import/large-file";
import { parseDelimited, parseDelimitedLinesAsync, splitLines } from "../../features/data-import/parse";
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

function store(fileId: string, options: DelimitedImportOptions, data: DataTableData): DataTableData {
  parsedCache.set(cacheKey(fileId, options), data);
  notifyArrived();
  return data;
}

function parseInto(fileId: string, options: DelimitedImportOptions, text: string): DataTableData {
  const parsed = parseDelimited(text, options);
  return store(fileId, options, { headers: parsed.headers, rows: parsed.rows });
}

// 大きな表が読めたことを知らせる前に、済ませておきたい下ごしらえ（列の読み取りなど）。
// 知らせた直後に購読者が同期で重い処理を始めると、そこで固まるため、先に小分けで
// 済ませてもらう。calc 側（table-scope）が登録する — ここは calc を知らない
type LargeTablePreparer = (data: DataTableData) => Promise<void>;
const preparers = new Set<LargeTablePreparer>();

/** 大きな表の下ごしらえを登録する。戻り値で解除 */
export function registerLargeTablePreparer(preparer: LargeTablePreparer): () => void {
  preparers.add(preparer);
  return () => {
    preparers.delete(preparer);
  };
}

// 大きな本文の変換は小分けにして非同期で行う。同じ (素材, 読み方) の変換が走っている間に
// 重ねて呼ばれても 1 回で済むよう、進行中の Promise を持つ（失敗したら捨てる）
const inflight = new Map<string, Promise<DataTableData>>();

function parseIntoAsync(
  fileId: string,
  options: DelimitedImportOptions,
  text: string
): Promise<DataTableData> {
  const key = cacheKey(fileId, options);
  const running = inflight.get(key);
  if (running) return running;
  const promise = parseDelimitedLinesAsync(splitLines(text), options)
    .then(async (parsed) => {
      const data: DataTableData = { headers: parsed.headers, rows: parsed.rows };
      // 下ごしらえの失敗で表を出せなくしない（購読者が同期で読み直すだけ）
      for (const prepare of preparers) await prepare(data).catch(() => {});
      // 変換中にキャッシュが消されていたら（別の素材に切り替わった等）結果は積まない
      if (inflight.get(key) !== promise) return data;
      inflight.delete(key);
      return store(fileId, options, data);
    })
    .catch((err) => {
      if (inflight.get(key) === promise) inflight.delete(key);
      throw err;
    });
  inflight.set(key, promise);
  return promise;
}

/** ブロック（BlockNote の JSON）から同期で表を引く。dataTable でない・未読なら null */
export function peekDataTableFromBlock(block: any): DataTableData | null {
  if (!block || block.type !== "dataTable") return null;
  const source = parseDataTableSource(block.props?.source);
  return source ? peekDataTable(source) : null;
}

/**
 * 素材 ID と読み方から、本文が読めていれば同期で表を返す。まだなら null。
 * 本文が SYNC_PARSE_MAX_CHARS を超えるときは同期で変換しない（描画中に呼ばれるので
 * 固まる）。裏で変換を始めて null を返し、終われば subscribeDataTableData で知らせる。
 * チャートとデータ表が同じ素材を読むとき、結果（rows の配列）を共有するための口
 */
export function peekDelimitedAsset(fileId: string, options: DelimitedImportOptions): DataTableData | null {
  if (!fileId) return null;
  const cached = parsedCache.get(cacheKey(fileId, options));
  if (cached) return cached;
  const text = peekAssetText(fileId);
  if (text === undefined) return null;
  if (text.length > SYNC_PARSE_MAX_CHARS) {
    // 失敗しても表が出ないだけ（呼び出し側は null を「未読」として扱う）
    loadDelimitedAsset(fileId, options).catch(() => {});
    return null;
  }
  return parseInto(fileId, options, text);
}

/** データ表のソースから同期で表を引く。まだなら null（ふるまいは peekDelimitedAsset と同じ） */
export function peekDataTable(source: TableSource): DataTableData | null {
  if (!source.fileId) return null;
  return peekDelimitedAsset(source.fileId, source.options);
}

/** データ表のソースから素材を読んで表にする。素材が無い・読めないときは reject */
export async function loadDataTable(source: TableSource): Promise<DataTableData> {
  if (!source.fileId) throw new Error("data table source has no fileId");
  return loadDelimitedAsset(source.fileId, source.options);
}

/** 素材 ID と読み方から素材を読んで表にする。素材が無い・読めないときは reject */
export async function loadDelimitedAsset(
  fileId: string,
  options: DelimitedImportOptions
): Promise<DataTableData> {
  if (!fileId) throw new Error("data table source has no fileId");
  const key = cacheKey(fileId, options);
  // peekDelimitedAsset は使わない（大きな本文では peek が load を呼ぶので循環する）
  const cached = parsedCache.get(key);
  if (cached) return cached;
  const running = inflight.get(key);
  if (running) return running;
  const text = peekAssetText(fileId) ?? (await loadAssetText(fileId));
  // 本文を待つ間に、別の呼び出しが先に変換を終えた・始めたことがある
  const doneMeanwhile = parsedCache.get(key);
  if (doneMeanwhile) return doneMeanwhile;
  const startedMeanwhile = inflight.get(key);
  if (startedMeanwhile) return startedMeanwhile;
  if (text.length > SYNC_PARSE_MAX_CHARS) return parseIntoAsync(fileId, options, text);
  return parseInto(fileId, options, text);
}

/** テスト・ストーリー用 */
export function clearDataTableCache(): void {
  parsedCache.clear();
  inflight.clear();
}
