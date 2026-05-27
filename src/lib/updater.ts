// Tauri 自動更新チェック
// アプリ起動時と 24 時間ごとに更新を確認する
// 更新が見つかると CustomEvent で UI に通知する
// 設定画面の About タブから手動でも呼べる

import { isTauri } from "./platform";
import pkg from "../../package.json";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 時間

/** 更新情報を UI に伝える CustomEvent の detail 型 */
export type UpdateAvailableDetail = {
  version: string;
  install: () => Promise<void>;
};

/** checkForUpdates の戻り値（手動チェック UI 用） */
export type CheckResult =
  | { status: "unsupported" }
  | { status: "up-to-date" }
  | { status: "available"; version: string }
  | { status: "error"; message: string };

/** Tauri 環境では実バージョン、それ以外では package.json の version を返す */
export async function getAppVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      // 取得失敗時は package.json にフォールバック
    }
  }
  return pkg.version;
}

/** 更新チェックを開始する（起動時 1 回呼び出す） */
export async function initUpdater(): Promise<void> {
  if (!isTauri()) return;

  // 起動後 5 秒待ってから初回チェック（UI の初期化を妨げない）
  setTimeout(() => {
    void checkForUpdates();
  }, 5000);

  // 定期チェック
  setInterval(() => {
    void checkForUpdates();
  }, CHECK_INTERVAL_MS);
}

/**
 * 更新を確認する。
 * Tauri 環境でない場合は "unsupported"、更新があれば CustomEvent も発火する。
 */
export async function checkForUpdates(): Promise<CheckResult> {
  if (!isTauri()) return { status: "unsupported" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      console.log(`[updater] Update available: ${update.version}`);
      const detail: UpdateAvailableDetail = {
        version: update.version,
        install: async () => {
          await update.downloadAndInstall();
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        },
      };
      window.dispatchEvent(
        new CustomEvent("graphium-update-available", { detail }),
      );
      return { status: "available", version: update.version };
    }
    console.log("[updater] App is up to date");
    return { status: "up-to-date" };
  } catch (e) {
    // updater が未設定（pubkey 未登録など）の場合や、ネットワーク失敗時
    console.debug("[updater] Check failed:", e);
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
