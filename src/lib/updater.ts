// Tauri 自動更新チェック
// アプリ起動時と 24 時間ごとに更新を確認する
// 更新が見つかると CustomEvent で UI に通知する

import { isTauri } from "./platform";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 時間

/** 更新情報を UI に伝える CustomEvent の detail 型 */
export type UpdateAvailableDetail = {
  version: string;
  install: () => Promise<void>;
};

/** 更新チェックを開始する */
export async function initUpdater(): Promise<void> {
  if (!isTauri()) return;

  // 起動後 5 秒待ってから初回チェック（UI の初期化を妨げない）
  setTimeout(() => checkForUpdates(), 5000);

  // 定期チェック
  setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
}

async function checkForUpdates(): Promise<void> {
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
    } else {
      console.log("[updater] App is up to date");
    }
  } catch (e) {
    // updater が未設定（pubkey 未登録など）の場合はスキップ
    console.debug("[updater] Check skipped:", e);
  }
}
