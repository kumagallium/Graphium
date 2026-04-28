// ストレージプロバイダーの React Hook
// ローカルファースト構成: 認証は不要、起動時に既定プロバイダーで自動初期化する

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveProvider, setActiveProvider, initProviders } from "./registry";
import type { StorageProvider } from "./types";

/** ストレージプロバイダーの初期化状態を管理する Hook */
export function useStorage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<StorageProvider | null>(null);
  // プロバイダー切り替えを検知するためのカウンター
  const [providerVersion, setProviderVersion] = useState(0);
  const initDoneRef = useRef(false);

  useEffect(() => {
    initProviders();
    const p = getActiveProvider();
    setProvider(p);
    setAuthenticated(p.getAuthState().isSignedIn);

    const unsubscribe = p.onAuthChange((state) => {
      setAuthenticated(state.isSignedIn);
    });

    p.init().then(() => {
      initDoneRef.current = true;
      setAuthenticated(p.getAuthState().isSignedIn);
      setLoading(false);
    }).catch((e) => {
      console.error("ストレージ初期化エラー:", e);
      initDoneRef.current = false;
      setLoading(false);
    });

    return unsubscribe;
  }, [providerVersion]);

  // プロバイダー切り替え（設定画面用）
  const switchProvider = useCallback((id: string) => {
    provider?.signOut();
    provider?.clearCache();
    localStorage.removeItem("graphium_last_file");
    localStorage.removeItem("graphium-recent-notes");
    setActiveProvider(id);
    setProviderVersion((v) => v + 1);
  }, [provider]);

  return { authenticated, loading, provider, switchProvider };
}
