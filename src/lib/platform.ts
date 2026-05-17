// プラットフォーム判定とデスクトップ固有機能

/**
 * Tauri デスクトップ環境かどうかを判定する。
 *
 * Tauri v2 では `__TAURI_INTERNALS__` がメインの注入ポイントだが、
 * 環境やビルド設定（特に Windows）でこのプロパティが見えないことが
 * 報告されている。フォールバックとして以下も併用する:
 *
 *   - `__TAURI__`              ... Tauri v1 と一部の v2 ビルドで残る
 *   - `__TAURI_METADATA__`     ... Tauri v2 が条件付きで注入する
 *   - `__TAURI_IPC__`          ... v2 IPC ハンドル
 *   - `location.protocol === "tauri:"` ... プロダクションビルドの origin
 *   - `navigator.userAgent` に "Tauri" を含む
 *
 * いずれかに合致すれば Tauri 環境と判定する。誤検出より取りこぼしの方が
 * 致命的（API base が `/api` に切り替わって `tauri://localhost/api` で 404）
 * なので、判定は寛容寄りに振る。
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  if ("__TAURI_INTERNALS__" in w) return true;
  if ("__TAURI__" in w) return true;
  if ("__TAURI_METADATA__" in w) return true;
  if ("__TAURI_IPC__" in w) return true;
  try {
    if (window.location && window.location.protocol === "tauri:") return true;
  } catch {
    // sandboxed iframe 等で location 参照に失敗するケース
  }
  try {
    if (typeof navigator !== "undefined" && /Tauri/i.test(navigator.userAgent)) return true;
  } catch {
    // navigator が存在しない／isolated worker
  }
  return false;
}

/**
 * 診断 UI 向けに、どの判定キーで Tauri 認定されたかを返す。
 * 何もマッチしなければ空文字。
 */
export function tauriDetectionDetail(): string {
  if (typeof window === "undefined") return "no window";
  const w = window as unknown as Record<string, unknown>;
  const hits: string[] = [];
  if ("__TAURI_INTERNALS__" in w) hits.push("__TAURI_INTERNALS__");
  if ("__TAURI__" in w) hits.push("__TAURI__");
  if ("__TAURI_METADATA__" in w) hits.push("__TAURI_METADATA__");
  if ("__TAURI_IPC__" in w) hits.push("__TAURI_IPC__");
  try {
    if (window.location?.protocol === "tauri:") hits.push("protocol=tauri:");
  } catch {}
  try {
    if (typeof navigator !== "undefined" && /Tauri/i.test(navigator.userAgent)) hits.push("ua~Tauri");
  } catch {}
  return hits.join(", ");
}

/** モバイルブラウザかどうか */
export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * API のベース URL を取得する。
 * Web 版: "/api" (Vite proxy 経由)
 * Tauri: "http://localhost:3001/api" (sidecar に直接アクセス)
 */
export function apiBase(): string {
  return isTauri() ? "http://localhost:3001/api" : "/api";
}
