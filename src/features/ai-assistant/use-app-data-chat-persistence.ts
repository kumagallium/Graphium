// AI チャット履歴を appData（<key> → ScopeChat[]）に出し入れするフック。
//
// 素材ビュー（MaterialFullView）と共有ライブラリの全画面のように、ノート本文へ
// 書き戻せない対象のチャットで共有する。ノートと違って明示的な「保存」操作が無い
// ビューなので、ストアの変化そのものを保存トリガーにする（送信・分岐・編集&再実行の
// どの経路でも取りこぼさない）。
//
// 3 つの effect の役割:
//   1. 読込  — 対象が変わったら履歴を読み、あれば restoreChats で流し込む
//   2. 保存  — chats の変化を 600ms debounce して書き出す（読込完了までは書かない。
//              空の初期状態で既存履歴を潰さないため）
//   3. flush — unmount 時に debounce 待ちを書き切る（閉じる瞬間の取りこぼし防止）
//
// 呼び出し側は対象ごとに AiAssistantProvider を作り直す（key={対象 id}）想定。
// それが外れても前の対象のファイルへ書かないよう、保存先キーは ref 経由で読む。

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScopeChat } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { loadAppDataChats, saveAppDataChats } from "./app-data-chat-store";
import { useAiAssistant, upsertChat } from "./store";

/** 保存 debounce（ミリ秒）。テストからも参照する */
export const APP_DATA_CHAT_SAVE_DEBOUNCE_MS = 600;

/**
 * 保存先プロバイダ。`getActiveProvider` のように「使う瞬間に解決したい」ものは
 * 関数のまま渡せる（レンダー中に解決すると未設定時に描画ごと落ちるため）。
 */
export type AppDataChatProviderSource = StorageProvider | (() => StorageProvider);

export type UseAppDataChatPersistenceOptions = {
  /** 保存先のストレージプロバイダ（または解決関数） */
  provider: AppDataChatProviderSource;
  /** appData キー。例: `asset-chats:<fileId>` / `shared-chats:<sharedId>` */
  key: string;
  /** false の間は読みも書きもしない（AI が使えない画面など）。既定 true */
  enabled?: boolean;
};

export function useAppDataChatPersistence({
  provider,
  key,
  enabled = true,
}: UseAppDataChatPersistenceOptions): void {
  const { restoreChats, getCurrentChat, chats } = useAiAssistant();

  // 読み込みが終わるまでは書き出さない（空の初期状態で既存履歴を潰さないため）
  const [chatsLoaded, setChatsLoaded] = useState(false);
  // debounce 待ちの内容。閉じる瞬間に取りこぼさないよう unmount 時に書き切る
  const pendingChatsRef = useRef<ScopeChat[] | null>(null);
  // 保存先。Provider の作り直しが外れても前の対象のファイルへ書かないための保険
  const keyRef = useRef(key);
  keyRef.current = key;
  // provider は毎レンダー同一とは限らないので effect の依存に載せず ref で持つ
  const providerRef = useRef(provider);
  providerRef.current = provider;

  const resolveProvider = useCallback((): StorageProvider => {
    const source = providerRef.current;
    return typeof source === "function" ? source() : source;
  }, []);

  const flush = useCallback(
    (target: ScopeChat[]) => {
      saveAppDataChats(resolveProvider(), keyRef.current, target).catch((err) =>
        console.warn("チャット履歴の保存失敗:", keyRef.current, err),
      );
    },
    [resolveProvider],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadAppDataChats(resolveProvider(), key)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.length > 0) restoreChats(loaded);
        setChatsLoaded(true);
      })
      .catch((err) => {
        console.warn("チャット履歴の読み込み失敗:", key, err);
        // 読めなくても以降の会話は保存できるようにする
        if (!cancelled) setChatsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, restoreChats, resolveProvider]);

  useEffect(() => {
    if (!enabled || !chatsLoaded) return;
    // 表示中の会話（messages）はまだ chats に退避されていないので合流させる
    const next = upsertChat(chats, getCurrentChat());
    if (next.length === 0) return;
    pendingChatsRef.current = next;
    const timer = setTimeout(() => {
      pendingChatsRef.current = null;
      flush(next);
    }, APP_DATA_CHAT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, chatsLoaded, chats, getCurrentChat, flush]);

  useEffect(
    () => () => {
      const pending = pendingChatsRef.current;
      if (!pending) return;
      pendingChatsRef.current = null;
      flush(pending);
    },
    // flush は安定なので、この effect は unmount 時にだけ走る
    [flush],
  );
}
