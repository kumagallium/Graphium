// 共有 ID 生成ユーティリティ。
// node / browser 両対応の UUID 生成。crypto.randomUUID が無い古い実行環境
// （crypto を剥がしたテスト等）では `id-<random>-<timestamp>` 形式に degrade する。
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
