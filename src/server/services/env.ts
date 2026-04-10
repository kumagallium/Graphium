// 環境設定のヘルパー
// リクエストヘッダー → 環境変数の優先順で値を取得する

import type { Context } from "hono";

/**
 * Crucible Registry URL を取得する
 * 優先順: X-Registry-URL ヘッダー → CRUCIBLE_API_URL 環境変数
 */
export function getRegistryUrl(c: Context): string {
  return c.req.header("X-Registry-URL") || process.env.CRUCIBLE_API_URL || "";
}

/**
 * Crucible Registry API Key を取得する
 */
export function getRegistryKey(): string {
  return process.env.CRUCIBLE_API_KEY || "";
}
