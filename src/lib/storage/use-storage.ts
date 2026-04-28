// ストレージプロバイダーの React Hook
// ローカルファースト構成: 認証は不要、起動時に既定プロバイダーで自動初期化する

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveProvider, setActiveProvider, initProviders, probeServerProvider } from "./registry";
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
    let cancelled = false;
    initProviders();
    let unsubscribe: (() => void) | null = null;

    (async () => {
      // サーバー側ストレージ機能を検出して必要なら active を切り替える
      await probeServerProvider();
      if (cancelled) return;

      const p = getActiveProvider();
      setProvider(p);
      setAuthenticated(p.getAuthState().isSignedIn);

      unsubscribe = p.onAuthChange((state) => {
        setAuthenticated(state.isSignedIn);
      });

      try {
        await p.init();
        if (cancelled) return;
        initDoneRef.current = true;
        setAuthenticated(p.getAuthState().isSignedIn);
        setLoading(false);
      } catch (e) {
        console.error("ストレージ初期化エラー:", e);
        initDoneRef.current = false;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
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
