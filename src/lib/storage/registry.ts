// ストレージプロバイダーの登録・切り替え管理

import type { StorageProvider } from "./types";
import { LocalStorageProvider } from "./providers/local";
import { LocalFilesystemProvider } from "./providers/filesystem";
import { ServerFilesystemProvider, fetchCapabilities } from "./providers/server-fs";
import { isTauri } from "../platform";

const STORAGE_KEY = "graphium_storage_provider";

const providers = new Map<string, StorageProvider>();
let activeProvider: StorageProvider | null = null;
let serverProbeDone = false;

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

function pickActive(savedId: string | null, defaultId: string): StorageProvider {
  let id = savedId ?? defaultId;
  // 過去バージョンの遺産（v0.4 で OAuth 撤去）
  if (id === "google-drive") id = defaultId;
  // Tauri 環境では IndexedDB 版を filesystem に置き換え
  if (isTauri() && id === "local") id = "filesystem";
  // 指定された ID が利用不可なら default にフォールバック
  const provider = providers.get(id) ?? providers.get(defaultId);
  if (!provider) throw new Error("ストレージプロバイダーの初期化に失敗しました");
  // 暗黙的なフォールバックは localStorage に書かない。
  // ユーザーが明示的に選択したときだけ setActiveProvider() 経由で永続化する。
  // （ここで書くと、その後の機能検出で「ユーザーが local を選んだ」と誤認する）
  return provider;
}

/** デフォルトプロバイダーで初期化（同期、ブラウザ判定だけで決まる範囲） */
export function initProviders(): void {
  if (providers.size > 0) return;

  // ローカル（IndexedDB）はどの環境でも利用可能
  registerProvider(new LocalStorageProvider());
  // Tauri 環境では OS ファイルシステムを優先
  if (isTauri()) {
    registerProvider(new LocalFilesystemProvider());
  }

  const defaultId = isTauri() ? "filesystem" : "local";
  const savedId = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  activeProvider = pickActive(savedId, defaultId);
}

/**
 * サーバー側ストレージ（Docker / セルフホスト）の機能検出と登録。
 * Web/Docker 環境で /api/storage/capabilities を叩き、利用可能なら server-fs を登録する。
 *
 * 動作:
 * - Tauri / Vercel / 機能無効サーバー → 何もしない
 * - server-fs が利用可能 & ユーザーが明示的に local を選んでいない → server-fs を active に切り替え
 * - 既に server-fs を保存していたが今は使えない → local にフォールバック
 */
export async function probeServerProvider(): Promise<void> {
  if (serverProbeDone) return;
  serverProbeDone = true;

  // Tauri は対象外（ローカル FS で完結）
  if (isTauri()) return;
  // SSR / 非ブラウザ環境
  if (typeof fetch === "undefined") return;

  const caps = await fetchCapabilities();
  if (!caps?.serverStorage) return;

  registerProvider(new ServerFilesystemProvider());

  // 既存ユーザー（local 選択）はそのまま、未選択の新規ユーザーには server-fs を薦める
  const savedId = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (!savedId) {
    activeProvider = pickActive("server-fs", "server-fs");
  } else if (savedId === "server-fs") {
    activeProvider = pickActive("server-fs", "local");
  }
  // savedId === "local" の場合は尊重して維持（明示的に IndexedDB を選んでいるユーザー）
}

// モジュール読み込み時に即座に初期化（同期分のみ）
initProviders();
