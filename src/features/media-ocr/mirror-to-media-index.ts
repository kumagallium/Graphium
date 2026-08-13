// ノートに貼った画像の OCR 結果を、素材インデックス側の ocrText にも写す。
//
// ブロック単位の正は `page.mediaOcr`（ノート JSON に保存される注釈）のままで、
// こちらは「素材そのものを文字で探す」ための索引。素材ギャラリーの検索と
// Cmd+K の画像検索がこれを読む。写しなので、失敗しても OCR 自体は成功扱いにする
// （読み取ったテキストはノート側に保存済み）。
//
// 既存ユーザーが v5 より前に読み取った分は、media-index の再構築時に
// `ensureMediaIndex` がノート走査で回収する。

import { getActiveProvider } from "../../lib/storage/registry";
import { persistOcrTextPatch } from "../asset-browser/media-index";

/**
 * 画像ブロックの url から fileId を解決し、素材側の ocrText を更新する。
 * fire-and-forget（呼び出し側は待たない）。
 *
 * @param imageUrl 画像ブロックの props.url（プロバイダ内部スキームのままで可）
 * @param text 抽出テキスト。空文字なら素材側のキーを落とす（読んだが文字が無かった）
 */
export function mirrorOcrToMediaIndex(imageUrl: string, text: string): void {
  if (!imageUrl) return;
  let fileId: string | null = null;
  try {
    fileId = getActiveProvider().extractFileId(imageUrl);
  } catch {
    // プロバイダ未初期化（テスト・Storybook）では何もしない
    return;
  }
  // 外部 URL の画像など、素材として登録されていないものは写す先が無い
  if (!fileId) return;
  void persistOcrTextPatch(fileId, text.trim()).catch((err) => {
    console.warn("OCR テキストの素材への写しに失敗:", err);
  });
}
