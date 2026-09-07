// データ素材（区切りテキスト）の本文キャッシュ
//
// チャートの「素材から直接描く」とデータ表ブロックは、どちらも素材の実体を
// プロバイダ越しに読む。同じ素材を複数のブロック・複数回の描画で読み直さない
// ように、本文は fileId 単位でここに溜める。取り込みダイアログで読んだ本文は
// primeAssetText で先出しできる（素材登録の直後は実体がまだ無いことがある）。
//
// 素材の実体は fileId に対して不変（同じ中身は同じ素材に寄せられ、別の中身は
// 別の fileId になる）ので、一度読めた本文はアプリを閉じるまで使い回してよい。
// 失敗は溜めない — 後で読める場合がある。

import { getActiveProvider } from "../../lib/storage/registry";
import { readDataFileText } from "./read-file";

const textCache = new Map<string, Promise<string>>();
// 読み終えた本文。Markdown 書き出しのように同期でしか読めない場所のため
const resolvedText = new Map<string, string>();

/** 取り込みダイアログで読んだ本文をそのまま登録する（描画のために読み直さない） */
export function primeAssetText(fileId: string, text: string): void {
  textCache.set(fileId, Promise.resolve(text));
  resolvedText.set(fileId, text);
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
    const text = await readDataFileText(await res.blob());
    resolvedText.set(fileId, text);
    return text;
  })();
  textCache.set(fileId, loading);
  loading.catch(() => {
    if (textCache.get(fileId) === loading) textCache.delete(fileId);
  });
  return loading;
}

/** 読み終えた本文を同期で返す。まだ読んでいなければ undefined */
export function peekAssetText(fileId: string): string | undefined {
  return resolvedText.get(fileId);
}

/** テスト・ストーリー用: キャッシュを空にする */
export function clearAssetTextCache(): void {
  textCache.clear();
  resolvedText.clear();
}
