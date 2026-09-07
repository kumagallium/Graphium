// 素材（PDF / URL 等）に紐づく AI チャット履歴の永続化。
//
// 実体は ai-assistant/app-data-chat-store.ts（appData の <key> → ScopeChat[]）で、
// ここは素材用のキー `asset-chats:<fileId>` を与えるだけの薄い入口。
// 共有ライブラリの全画面チャット（shared-chats:<sharedId>）と同じ仕組みを使う。
//
// キー書式は保存済みデータの所在そのものなので変更しない。

import type { ScopeChat } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { loadAppDataChats, saveAppDataChats } from "../ai-assistant/app-data-chat-store";

/** 素材チャットの appData キー接頭辞 */
export const ASSET_CHATS_KEY_PREFIX = "asset-chats:";

/** 素材チャットの appData キー */
export const assetChatsKey = (fileId: string) => `${ASSET_CHATS_KEY_PREFIX}${fileId}`;

/**
 * 素材のチャット履歴を返す。
 * 未保存・readAppData 非対応プロバイダ・壊れた内容ではいずれも空配列
 * （「履歴が無い」として扱い、素材ビューを開けなくはしない）。
 */
export async function loadAssetChats(
  provider: StorageProvider,
  fileId: string,
): Promise<ScopeChat[]> {
  return loadAppDataChats(provider, assetChatsKey(fileId));
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
  return saveAppDataChats(provider, assetChatsKey(fileId), chats);
}
