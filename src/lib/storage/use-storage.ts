// ストレージプロバイダーの React Hook
// useGoogleAuth の代替として、プロバイダー非依存の認証状態管理を提供

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveProvider, setActiveProvider, initProviders } from "./registry";
import type { StorageProvider } from "./types";

const STORAGE_KEY = "provnote_storage_provider";

/** ストレージプロバイダーの認証状態を管理する Hook */
export function useStorage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<StorageProvider | null>(null);
  // プロバイダー切り替えを検知するためのカウンター
  const [providerVersion, setProviderVersion] = useState(0);
  // init 完了後に signIn を自動実行するフラグ
  const pendingSignInRef = useRef(false);

  useEffect(() => {
    // プロバイダーを初期化
    initProviders();
    const p = getActiveProvider();
    setProvider(p);

    // 認証状態の初期値
    setAuthenticated(p.getAuthState().isSignedIn);

    // 認証状態変化のリスナー
    const unsubscribe = p.onAuthChange((state) => {
      setAuthenticated(state.isSignedIn);
    });

    // プロバイダーを初期化（サイレントリフレッシュ等）
    p.init().then(() => {
      setAuthenticated(p.getAuthState().isSignedIn);
      setLoading(false);
      // 切り替えサインインが保留中なら実行
      if (pendingSignInRef.current) {
        pendingSignInRef.current = false;
        p.signIn();
      }
    });

    return unsubscribe;
  }, [providerVersion]);

  const signIn = useCallback(
    (providerId?: string) => {
      if (providerId && provider?.id !== providerId) {
        // 別プロバイダーへの切り替えサインイン（例: ログイン画面 → Google）
        // init 完了後に signIn を自動実行するようフラグを立てる
        pendingSignInRef.current = true;
        setActiveProvider(providerId);
        setLoading(true);
        setProviderVersion((v) => v + 1);
        return;
      }
      provider?.signIn();
    },
    [provider],
  );

  // サインアウト: プロバイダー設定をリセットしてログイン画面に戻す
  // last_file / recent-notes は残す（再ログイン時に自動復元するため）
  const signOut = useCallback(() => {
    provider?.signOut();
    // プロバイダー設定をクリア → ログイン画面を表示
    localStorage.removeItem(STORAGE_KEY);
    // React state をリセットして即座にログイン画面に戻す
    setAuthenticated(false);
    setLoading(false);
  }, [provider]);

  // プロバイダーを切り替え（リロードなし）
  const switchProvider = useCallback((id: string) => {
    // 現在のプロバイダーをサインアウト
    provider?.signOut();
    provider?.clearCache();
    // UI キャッシュをクリア（別プロバイダーのファイルIDは使えない）
    localStorage.removeItem("provnote_last_file");
    localStorage.removeItem("provnote-recent-notes");
    // 新しいプロバイダーに切り替え
    setActiveProvider(id);
    setProviderVersion((v) => v + 1);
  }, [provider]);

  return { authenticated, loading, signIn, signOut, provider, switchProvider };
}
