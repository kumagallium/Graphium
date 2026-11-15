// セルフホストの合言葉（GRAPHIUM_AUTH_TOKEN）の照合
//
// 合言葉は node モードの /api/* すべてに効く（app.ts の共通ミドルウェア）。
// 通すのは次のどちらか:
//   - X-Graphium-Token ヘッダーが合言葉と一致
//   - Cookie graphium_auth が sha256("graphium-auth-cookie:" + 合言葉) の hex と一致
//     （<img> など、ヘッダーを付けられない同一オリジンの読み込み用。ヘッダーで通った応答で配る）
// 比較は両辺を sha256 してから timingSafeEqual（長さも漏らさない）。

import { createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export const AUTH_COOKIE_NAME = "graphium_auth";
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 定数時間で比べる（未指定は false） */
export function authTokenMatches(given: string | undefined | null, expected: string): boolean {
  if (typeof given !== "string" || given === "") return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

/** Cookie に入れる値（合言葉そのものは Cookie に載せない） */
export function authCookieValue(token: string): string {
  return createHash("sha256").update(`graphium-auth-cookie:${token}`, "utf8").digest("hex");
}

/**
 * 要求が合言葉を満たしているか。
 * 戻り値: "none" = 合言葉が未設定（素通し）/ "header" / "cookie" / "denied"
 */
export function checkRequestAuth(c: Context): "none" | "header" | "cookie" | "denied" {
  const expected = process.env.GRAPHIUM_AUTH_TOKEN;
  if (!expected) return "none";
  if (authTokenMatches(c.req.header("x-graphium-token"), expected)) return "header";
  const cookie = getCookie(c, AUTH_COOKIE_NAME);
  if (authTokenMatches(cookie, authCookieValue(expected))) return "cookie";
  return "denied";
}

/** 認証済み（または合言葉が未設定）なら true */
export function isRequestAuthorized(c: Context): boolean {
  return checkRequestAuth(c) !== "denied";
}
