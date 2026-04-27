// ストレージプロバイダーの登録・切り替え管理

import type { StorageProvider } from "./types";
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
  if (providers.size > 0) return;

  // ローカル（IndexedDB）はどの環境でも利用可能
  registerProvider(new LocalStorageProvider());
  // Tauri 環境では OS ファイルシステムを優先
  if (isTauri()) {
    registerProvider(new LocalFilesystemProvider());
  }

  // デフォルト: Tauri なら filesystem、Web/Docker なら local（IndexedDB）
  const defaultId = isTauri() ? "filesystem" : "local";
  let savedId = (typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null) ?? defaultId;

  // 過去バージョンの遺産（v0.4 で OAuth 撤去）: google-drive が保存されていたら現環境のデフォルトに置き換える
  if (savedId === "google-drive") {
    savedId = defaultId;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, savedId);
    }
  }

  // Tauri 環境で IndexedDB 版（local）が保存されていたら filesystem へ移行
  if (isTauri() && savedId === "local") {
    savedId = "filesystem";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "filesystem");
    }
  }

  const provider = providers.get(savedId) ?? providers.get(defaultId);
  if (!provider) throw new Error("ストレージプロバイダーの初期化に失敗しました");
  activeProvider = provider;
}

// モジュール読み込み時に即座に初期化
initProviders();
