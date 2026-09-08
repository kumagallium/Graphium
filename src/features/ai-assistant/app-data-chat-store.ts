// ノート本文の外にある「対象」に紐づく AI チャット履歴の永続化（appData 版）。
//
// ノートのチャットは GraphiumDocument.chats としてノート JSON に同梱されるが、
// 素材ビュー（MaterialFullView の「AI に質問」）や共有ライブラリの全画面のように
// 書き戻す本文が手元に無い／書き戻してはいけない対象には受け皿が無い。
// ここでは版スナップショット（version-snapshots/snapshot-store.ts）と同じく
// StorageProvider.readAppData / writeAppData（3 プロバイダ全実装済みの内部チャネル）を
// 使い、
//   <key> → ScopeChat[]
// の 1 対象 1 ファイルで持つ。key は呼び出し側が決める
//   - 素材:   asset-chats:<fileId>   （asset-chat-store.ts）
//   - 共有:   shared-chats:<sharedId>（sharing/shared-chat.ts）
//
// 一覧インデックス（media-index 等）に相乗りさせないのは、あちらが頻繁に再構築される
// ため（会話本文を毎回運ばせたくない）。対象ごとに分けておけば、会話の寿命はその対象の
// 寿命に自然と一致する。

import type { ScopeChat } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";

/**
 * 指定キーのチャット履歴を返す。
 * 未保存・readAppData 非対応プロバイダ・壊れた内容ではいずれも空配列
 * （「履歴が無い」として扱い、対象のビューを開けなくはしない）。
 */
export async function loadAppDataChats(
  provider: StorageProvider,
  key: string,
): Promise<ScopeChat[]> {
  const raw = await provider.readAppData?.(key);
  if (!Array.isArray(raw)) return [];
  return raw as ScopeChat[];
}

/**
 * 指定キーのチャット履歴を丸ごと書き出す。
 *
 * 空配列は null で上書きする（appData に delete API が無いため、deleteSnapshot と
 * 同じ論理削除。loadAppDataChats は null を「無い」として読む）。
 */
export async function saveAppDataChats(
  provider: StorageProvider,
  key: string,
  chats: ScopeChat[],
): Promise<void> {
  if (!provider.writeAppData) return;
  await provider.writeAppData(key, chats.length > 0 ? chats : null);
}
