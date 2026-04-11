// ストレージプロバイダーの登録・切り替え管理

import type { StorageProvider } from "./types";
import { GoogleDriveProvider } from "./providers/google-drive";
import { LocalStorageProvider } from "./providers/local";
import { LocalFilesystemProvider } from "./providers/filesystem";
import { isTauri } from "../platform";

const STORAGE_KEY = "graphium_storage_provider";

const providers = new Map<string, StorageProvider>();
let activeProvider: StorageProvider | null = null;

/** プロバイダーを登録 */
export function registerProvider(provider: StorageProvider): void {
  providers.set(provider.id, provider);
}

/** アクティブなプロバイダーを設定 */
export function setActiveProvider(id: string): StorageProvider {
  const provider = providers.get(id);
  if (!provider) throw new Error(`未知のストレージプロバイダー: ${id}`);
  activeProvider = provider;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, id);
  }
  return provider;
}

/** 現在のアクティブプロバイダーを取得 */
export function getActiveProvider(): StorageProvider {
  if (!activeProvider) throw new Error("ストレージプロバイダーが未設定です");
  return activeProvider;
}

/** 利用可能なプロバイダー一覧を取得 */
export function getAvailableProviders(): StorageProvider[] {
  return Array.from(providers.values());
}

/** デフォルトプロバイダーで初期化 */
export function initProviders(): void {
  // 既に初期化済みならスキップ
  if (providers.size > 0) return;

  // プロバイダーを登録
  registerProvider(new GoogleDriveProvider());
  registerProvider(new LocalStorageProvider());
  if (isTauri()) {
    registerProvider(new LocalFilesystemProvider());
  }

  // 保存された設定を復元。Tauri 環境ではデフォルトを filesystem に
  const defaultProvider = isTauri() ? "filesystem" : "google-drive";
  let savedId = (typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null) ?? defaultProvider;

  // Tauri 環境で IndexedDB 版（local）が保存されていたら filesystem へマイグレーション
  if (isTauri() && savedId === "local") {
    savedId = "filesystem";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "filesystem");
    }
  }
  const provider = providers.get(savedId);
  if (provider) {
    activeProvider = provider;
  } else {
    // 不明なプロバイダーが保存されていた場合はフォールバック
    activeProvider = providers.get(defaultProvider)!;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, defaultProvider);
    }
  }
}

// モジュール読み込み時に即座に初期化（getActiveProvider() が常に使えるようにする）
initProviders();
