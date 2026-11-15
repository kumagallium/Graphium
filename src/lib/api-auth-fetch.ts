// セルフホストの合言葉（X-Graphium-Token）を、API への fetch すべてに足す包み。
//
// サーバーは GRAPHIUM_AUTH_TOKEN があると /api/* すべてに合言葉を要求する。
// 呼び出し側 1 つずつにヘッダーを足す代わりに、globalThis.fetch を包んで
// 宛先が API のときだけ足す。ほかのオリジンへの要求には絶対に足さない（合言葉が漏れる）。

import { apiBase } from "./platform";
import { serverAuthHeaders } from "./storage/providers/server-fs";

const TOKEN_HEADER = "X-Graphium-Token";

function currentOrigin(): string | null {
  try {
    return typeof location !== "undefined" && location.origin && location.origin !== "null" ? location.origin : null;
  } catch {
    return null;
  }
}

/** 宛先が API か（同一オリジンの /api/ 配下、または apiBase() で始まる絶対 URL） */
export function isApiTarget(input: RequestInfo | URL): boolean {
  let raw: string;
  if (typeof input === "string") raw = input;
  else if (input instanceof URL) raw = input.href;
  else if (typeof Request !== "undefined" && input instanceof Request) raw = input.url;
  else return false;

  const base = apiBase();
  // 絶対 URL の apiBase（Tauri）: 前方一致。"/api" の直後が区切りであること
  if (/^https?:\/\//i.test(base)) {
    try {
      const target = new URL(raw);
      const b = new URL(base);
      if (target.origin === b.origin && (target.pathname === b.pathname || target.pathname.startsWith(b.pathname + "/"))) {
        return true;
      }
    } catch {
      // 続けて同一オリジンの判定へ
    }
  }
  const origin = currentOrigin();
  try {
    const u = origin ? new URL(raw, origin) : new URL(raw);
    if (origin && u.origin !== origin) return false;
    return u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** fetch を包む。トークンが無い・宛先が API でないときは何も足さずに素通しする */
export function withApiAuth(baseFetch: typeof fetch): typeof fetch {
  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    const auth = serverAuthHeaders();
    const token = auth[TOKEN_HEADER];
    if (!token || !isApiTarget(input)) return baseFetch(input, init);

    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined));
    if (headers.has(TOKEN_HEADER)) return baseFetch(input, init);
    headers.set(TOKEN_HEADER, token);
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
  return wrapped;
}

let installed = false;

/** 描画前に 1 度呼ぶ（何度呼んでも 1 回だけ包む） */
export function installApiAuthFetch(): void {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  globalThis.fetch = withApiAuth(globalThis.fetch.bind(globalThis));
}
