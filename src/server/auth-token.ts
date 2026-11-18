// セルフホストの合言葉（GRAPHIUM_AUTH_TOKEN）の照合
//
// 合言葉は node モードの /api/* すべてに効く（app.ts の共通ミドルウェア）。
// 通すのは次のどちらか:
//   - X-Graphium-Token ヘッダーが合言葉と一致
//   - Cookie graphium_auth が sha256("graphium-auth-cookie:" + 合言葉) の hex と一致
//     （<img> など、ヘッダーを付けられない同一オリジンの読み込み用。ヘッダーで通った応答で配る）
// 比較は両辺を sha256 してから timingSafeEqual（長さも漏らさない）。

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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

// デスクトップ版で、起動時に環境変数から取り込んだ合言葉（captureDesktopAuthToken）
let capturedToken: string | undefined;

/** 今効いている合言葉（未設定なら undefined）。合言葉を見るコードは必ずこれを通す */
export function getAuthToken(): string | undefined {
  return capturedToken ?? (process.env.GRAPHIUM_AUTH_TOKEN || undefined);
}

/**
 * デスクトップ版（GRAPHIUM_DESKTOP=1）の合言葉を環境変数から取り込み、環境変数からは消す。
 *
 * sidecar は Copilot CLI・claude / codex・security・ログインシェルなどを子プロセスとして起動し、
 * その多くは環境を丸ごと継ぐ。合言葉を環境に残すと、それらに渡ってしまう。
 * 起動の最初（子プロセスを起動する前）に 1 度だけ呼ぶ。セルフホストでは何もしない
 * （利用者が設定した環境変数をそのまま使う）。
 */
export function captureDesktopAuthToken(): void {
  if (process.env.GRAPHIUM_DESKTOP !== "1") return;
  const token = process.env.GRAPHIUM_AUTH_TOKEN;
  if (!token) return;
  capturedToken = token;
  delete process.env.GRAPHIUM_AUTH_TOKEN;
}

/** 証明に混ぜる前置き。画面側（src/lib/api-auth-fetch.ts）と同じ値にすること */
export const SIDECAR_PROOF_PREFIX = "graphium-sidecar-proof-v1:";

/**
 * デスクトップ版の sidecar が「起動ごとの合言葉を知っている」ことの証明。
 *
 * 画面は、合言葉を送る前に、相手が自分の sidecar かを確かめたい（3001 を別のプログラムが
 * 握っていると、合言葉つきの要求がそのままそちらへ届く）。そこで画面は乱数（challenge）だけを
 * 送り、sidecar は HMAC-SHA256(合言葉, 前置き + challenge) を返す。合言葉そのものは流れない。
 *
 * デスクトップ版に限る。セルフホストの合言葉は利用者が決めた値で、未認証の口から HMAC を
 * 返すと、弱い合言葉を手元で総当たりする材料になる。デスクトップ版の合言葉は 256 ビットの乱数。
 */
export function desktopSidecarProof(challenge: string | undefined | null): string | null {
  if (process.env.GRAPHIUM_DESKTOP !== "1") return null;
  const token = getAuthToken();
  if (!token) return null;
  if (typeof challenge !== "string" || !/^[0-9a-f]{64}$/.test(challenge)) return null;
  return createHmac("sha256", token).update(SIDECAR_PROOF_PREFIX + challenge, "utf8").digest("hex");
}

/** テスト用: 取り込んだ合言葉を捨てる */
export function __resetCapturedAuthTokenForTest(): void {
  capturedToken = undefined;
}

/**
 * 要求が合言葉を満たしているか。
 * 戻り値: "none" = 合言葉が未設定（素通し）/ "header" / "cookie" / "denied"
 */
export function checkRequestAuth(c: Context): "none" | "header" | "cookie" | "denied" {
  const expected = getAuthToken();
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
