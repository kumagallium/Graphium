// 選んだ素材の出どころを、DOI からまとめて補完する（素材一覧の一括操作）
//
// 1 件ずつの「DOI から補完」と同じく、人が押したときだけ DOI を Crossref に送る。
// 自動では何も送らない。DOI 以外（ファイル名・本文・著者）は送らない。
//
//   - DOI が無い PDF は、まずファイルの中（端末内）で DOI を探す
//   - Crossref への問い合わせは 1 件ずつ順に行う（公開 API に同時に押し寄せない）
//   - 保存はまとめて行う（1 件ずつだと、素材一覧の書き直しと一覧の読み直しが件数ぶん走る）
//   - 人が手で入れた値（origin: "manual"）は上書きせず、空いている項目だけ埋める

import {
  documentKindOf,
  persistSourceInfoPatches,
  type MediaIndexEntry,
  type MediaType,
  type SourceInfo,
} from "./media-index";
import {
  CrossrefNotFoundError,
  extractPdfSourceInfo,
  fetchCrossrefSourceInfo,
  mergeSourceInfo,
} from "./source-info";

/** 出どころを持てる素材の種類（素材の詳細の「出どころ」欄と同じ） */
export const SOURCE_INFO_TYPES: ReadonlySet<MediaType> = new Set<MediaType>(["pdf", "document", "url"]);

/** この数だけ続けて Crossref に届かなければ、通信できないとみなして残りをやめる */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * 一括補完の対象か。
 *   - DOI があり、まだ Crossref で補完していない素材
 *   - DOI が無くても、ファイルの中をまだ読んでいない PDF（先に端末内で DOI を探す）
 */
export function isSourceLookupTarget(entry: MediaIndexEntry): boolean {
  if (!SOURCE_INFO_TYPES.has(entry.type)) return false;
  if (entry.sourceInfo?.doi) return entry.sourceInfo.origin !== "crossref";
  return documentKindOf(entry) === "pdf" && !entry.sourceInfoScanned;
}

/**
 * Crossref の結果を既存に重ねる（一括用）。
 * 人が手で入れた出どころは上書きせず、空いている項目だけ埋める。それ以外は Crossref を優先する。
 */
export function applyCrossrefResult(base: SourceInfo | undefined, fetched: SourceInfo): SourceInfo {
  if (base?.origin === "manual") return mergeSourceInfo(fetched, base);
  return mergeSourceInfo(base, fetched);
}

export type BulkSourceLookupProgress = {
  /** 対象の件数 */
  total: number;
  /** 終えた件数（補完できたもの・できなかったものを含む） */
  done: number;
  /** 補完できた件数 */
  filled: number;
  /** DOI が見つからなかった件数 */
  noDoi: number;
  /** Crossref に該当が無かった件数 */
  notFound: number;
  /** 問い合わせに失敗した件数（通信できない等。途中でやめた残りも含む） */
  failed: number;
};

export async function runBulkSourceLookup(
  entries: MediaIndexEntry[],
  deps: {
    /** 素材の実体を読む（DOI の無い PDF の中を探すとき） */
    readBytes: (entry: MediaIndexEntry) => Promise<Uint8Array>;
    fetchImpl?: typeof fetch;
    onProgress?: (p: BulkSourceLookupProgress) => void;
    signal?: { aborted: boolean };
    /** この件数たまったら保存する */
    flushEvery?: number;
  },
): Promise<BulkSourceLookupProgress> {
  const flushEvery = deps.flushEvery ?? 20;
  const progress: BulkSourceLookupProgress = {
    total: entries.length,
    done: 0,
    filled: 0,
    noDoi: 0,
    notFound: 0,
    failed: 0,
  };
  const pending = new Map<string, SourceInfo>();
  const flush = async () => {
    if (pending.size === 0) return;
    const batch = new Map(pending);
    pending.clear();
    await persistSourceInfoPatches(batch);
  };

  let consecutiveFailures = 0;
  try {
    for (const entry of entries) {
      if (deps.signal?.aborted) break;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // 通信できない状態で残りを 1 件ずつタイムアウトさせない
        progress.failed += entries.length - progress.done;
        progress.done = entries.length;
        break;
      }

      let base = entry.sourceInfo;
      let doi = base?.doi;
      if (!doi && documentKindOf(entry) === "pdf") {
        try {
          const fromFile = await extractPdfSourceInfo(await deps.readBytes(entry));
          if (fromFile) {
            base = mergeSourceInfo(fromFile, base);
            doi = fromFile.doi;
            // DOI が無くても著者が読めたら残す（Crossref に届かなくても無駄にしない）
            pending.set(entry.fileId, base);
          }
        } catch {
          // 読めなければ DOI 無し扱い
        }
      }

      if (!doi) {
        progress.noDoi += 1;
      } else {
        try {
          const { info } = await fetchCrossrefSourceInfo(doi, deps.fetchImpl);
          pending.set(entry.fileId, applyCrossrefResult(base, info));
          progress.filled += 1;
          consecutiveFailures = 0;
        } catch (e) {
          if (e instanceof CrossrefNotFoundError) {
            progress.notFound += 1;
            consecutiveFailures = 0;
          } else {
            progress.failed += 1;
            consecutiveFailures += 1;
            console.warn("Crossref からの補完に失敗:", entry.fileId, e);
          }
        }
      }

      progress.done += 1;
      deps.onProgress?.({ ...progress });
      if (pending.size >= flushEvery) await flush();
    }
  } finally {
    await flush();
  }
  deps.onProgress?.({ ...progress });
  return progress;
}
