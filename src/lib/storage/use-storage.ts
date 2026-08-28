// ストレージプロバイダーの React Hook
// ローカルファースト構成: 認証は不要、起動時に既定プロバイダーで自動初期化する

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveProvider, setActiveProvider, initProviders, probeServerProvider } from "./registry";
import type { StorageProvider } from "./types";

// 初期化 1 回あたりの上限（ミリ秒）。試行ごとに伸ばす。
//
// Tauri デスクトップの list_note_files は本来一瞬で返るが、応答が返らない事情が
// 2 つある。ひとつは起動直後の IPC 初期化競合で invoke が永久 pending 化する例
// （Rust も WebView も idle のまま固まる = 「アップデート後の再起動で止まる／
// 開き直すと直る」）。もうひとつは macOS の TCC で、書類フォルダへのアクセス許可
// ダイアログが出ている間、read_dir はユーザーが答えるまでブロックされる。
// 後者は「待てば通る」ので、回を追うごとに猶予を伸ばして答える時間を作る。
const INIT_ATTEMPT_TIMEOUT_MS = [5000, 10000, 15000];
// リトライ前の待機（ミリ秒）。IPC チャネルが確立するまでの猶予。
const INIT_RETRY_DELAY_MS = 400;

/**
 * 起動時のストレージ初期化が失敗した理由。
 *
 * 以前はこれを握り潰して「ノートフォルダを読み込めませんでした」とだけ出していた
 * ので、権限で弾かれたのか宙吊りだったのか保存先が消えたのかを、報告を受けても
 * 切り分けられなかった。分類と生エラーの両方を UI まで運ぶ。
 */
export type StorageInitFailure = {
  /** UI が t() に渡す i18n キー */
  key:
    | "startup.initFailedPermission"
    | "startup.initFailedTimeout"
    | "startup.initFailedMissing"
    | "startup.initFailed";
  /** 生のエラー文字列（詳細表示・問い合わせ用に残す） */
  raw: string;
  /** OS のフォルダアクセス許可を案内すべきか */
  needsFolderAccess: boolean;
};

/** 初期化エラーを、ユーザーが次に取れる行動で分類する */
export function classifyInitFailure(e: unknown): StorageInitFailure {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();

  // withTimeout が付ける印。宙吊りか、TCC ダイアログの応答待ちで返ってこない
  if (lower.includes("init timeout after")) {
    return { key: "startup.initFailedTimeout", raw, needsFolderAccess: false };
  }

  // EPERM(1) / EACCES(13)。macOS の書類フォルダ拒否がここに来る
  if (
    lower.includes("operation not permitted") ||
    lower.includes("permission denied") ||
    /os error (1|13)\)/.test(lower) ||
    lower.includes("アクセスが拒否されました")
  ) {
    return { key: "startup.initFailedPermission", raw, needsFolderAccess: true };
  }

  // ENOENT(2)。保存先を外部ドライブ等に変えていて、それが今は無い場合
  if (
    lower.includes("no such file or directory") ||
    /os error 2\)/.test(lower) ||
    lower.includes("が見つかりません")
  ) {
    return { key: "startup.initFailedMissing", raw, needsFolderAccess: false };
  }

  return { key: "startup.initFailed", raw, needsFolderAccess: false };
}

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
  const [initFailure, setInitFailure] = useState<StorageInitFailure | null>(null);
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
      let failure: StorageInitFailure | null = null;
      const attempts = INIT_ATTEMPT_TIMEOUT_MS.length;
      for (let attempt = 1; attempt <= attempts && !cancelled; attempt++) {
        try {
          await withTimeout(p.init(), INIT_ATTEMPT_TIMEOUT_MS[attempt - 1]);
          ok = true;
          failure = null;
          break;
        } catch (e) {
          failure = classifyInitFailure(e);
          console.warn(
            `ストレージ初期化 試行 ${attempt}/${attempts} 失敗 [${failure.key}]:`,
            failure.raw,
          );
          // 権限で弾かれている場合、同じプロセスの中では何度やっても同じところで
          // 返る（TCC の判定はプロセス単位で決まる）。粘らずに案内へ回し、
          // 起動し直してもらう。
          if (failure.needsFolderAccess) break;
          if (attempt < attempts && !cancelled) await delay(INIT_RETRY_DELAY_MS);
        }
      }
      if (cancelled) return;
      initDoneRef.current = ok;
      setInitFailure(failure);
      if (ok) {
        setAuthenticated(p.getAuthState().isSignedIn);
      } else {
        console.error("ストレージ初期化に失敗しました:", failure?.raw);
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

  return { authenticated, loading, provider, initFailure, switchProvider };
}
