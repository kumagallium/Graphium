// プラットフォーム判定とデスクトップ固有機能

/** Tauri デスクトップ環境かどうか */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * API のベース URL を取得する。
 * Web 版: "/api" (Vite proxy 経由)
 * Tauri: "http://localhost:3001/api" (sidecar に直接アクセス)
 */
export function apiBase(): string {
  return isTauri() ? "http://localhost:3001/api" : "/api";
}
