// 素材（PDF / URL 等）に紐づく AI チャット履歴の永続化。
//
// ノートのチャットは GraphiumDocument.chats としてノート JSON に同梱されるが、
// 素材ビュー（MaterialFullView の「AI に質問」）の会話には受け皿が無く、ビューを
// 閉じた時点で消えていた。ここでは版スナップショット（version-snapshots/
// snapshot-store.ts）と同じく StorageProvider.readAppData / writeAppData
// （3 プロバイダ全実装済みの内部チャネル）を使い、
//   asset-chats:<fileId> → ScopeChat[]
// の 1 素材 1 ファイルで持つ。
//
// media-index に相乗りさせないのは、あちらが全素材の一覧として頻繁に再構築される
// ため（会話本文を毎回運ばせたくない）。素材ごとに分けておけば、会話の寿命は
// その素材の寿命に自然と一致する。

import type { ScopeChat } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";

const chatsKey = (fileId: string) => `asset-chats:${fileId}`;

/**
 * 素材のチャット履歴を返す。
 * 未保存・readAppData 非対応プロバイダ・壊れた内容ではいずれも空配列
 * （「履歴が無い」として扱い、素材ビューを開けなくはしない）。
 */
export async function loadAssetChats(
  provider: StorageProvider,
  fileId: string,
): Promise<ScopeChat[]> {
  const raw = await provider.readAppData?.(chatsKey(fileId));
  if (!Array.isArray(raw)) return [];
  return raw as ScopeChat[];
}

/**
 * 素材のチャット履歴を丸ごと書き出す。
 *
 * 空配列は null で上書きする（appData に delete API が無いため、deleteSnapshot と
 * 同じ論理削除。loadAssetChats は null を「無い」として読む）。
 */
export async function saveAssetChats(
  provider: StorageProvider,
  fileId: string,
  chats: ScopeChat[],
): Promise<void> {
  if (!provider.writeAppData) return;
  await provider.writeAppData(chatsKey(fileId), chats.length > 0 ? chats : null);
}
