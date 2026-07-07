// ストレージプロバイダーの React Hook
// ローカルファースト構成: 認証は不要、起動時に既定プロバイダーで自動初期化する

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveProvider, setActiveProvider, initProviders, probeServerProvider } from "./registry";
import type { StorageProvider } from "./types";

// 初期化 1 回あたりの上限（ミリ秒）。
// Tauri デスクトップの list_note_files は本来一瞬で返るが、起動直後の IPC 初期化
// 競合で invoke が応答を返さず永久 pending 化することがある（Rust も WebView も
// idle のまま「読み込み中」で固まる = ユーザー報告の「アップデート後の再起動で
// 止まる／開き直すと直る」）。その宙吊りをこの時間で「異常」と判断してリトライに
// 回す。通常のディスク読み取りを誤って打ち切らないよう十分長めに取る。
const INIT_ATTEMPT_TIMEOUT_MS = 5000;
// 初期化の最大試行回数。宙吊りは起動タイミング依存なので、少し待って invoke を
// 再発行すれば次はたいてい通る（手動の「閉じて開き直す」をアプリ内で自動化する）。
const INIT_MAX_ATTEMPTS = 3;
// リトライ前の待機（ミリ秒）。IPC チャネルが確立するまでの猶予。
const INIT_RETRY_DELAY_MS = 400;

/**
 * Promise にタイムアウトを付ける。時間内に解決しなければ reject する。
 * 元の Promise は JS の仕様上キャンセルできず pending のまま残るが、呼び出し側は
 * 次の試行へ進む。プロバイダーの init は冪等（成功時に signedIn を立て直すだけ）な
 * ので、宙吊りが遅れて解決しても二重実行は無害。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`init timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

      // 初期化をタイムアウト付きで試行し、宙吊り（起動時 IPC 競合など）を検知したら
      // invoke を再発行してリトライする。全滅しても loading は必ず解除して UI を出し、
      // 無限「読み込み中」を根絶する。
      let ok = false;
      for (let attempt = 1; attempt <= INIT_MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          await withTimeout(p.init(), INIT_ATTEMPT_TIMEOUT_MS);
          ok = true;
          break;
        } catch (e) {
          console.warn(`ストレージ初期化 試行 ${attempt}/${INIT_MAX_ATTEMPTS} 失敗:`, e);
          if (attempt < INIT_MAX_ATTEMPTS && !cancelled) await delay(INIT_RETRY_DELAY_MS);
        }
      }
      if (cancelled) return;
      initDoneRef.current = ok;
      if (ok) {
        setAuthenticated(p.getAuthState().isSignedIn);
      } else {
        console.error("ストレージ初期化に失敗しました（リトライ上限に到達）");
      }
      setLoading(false);
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
