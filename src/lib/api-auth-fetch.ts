// セルフホストの合言葉（X-Graphium-Token）を、API への fetch すべてに足す包み。
//
// サーバーは GRAPHIUM_AUTH_TOKEN があると /api/* すべてに合言葉を要求する。
// 呼び出し側 1 つずつにヘッダーを足す代わりに、globalThis.fetch を包んで
// 宛先が API のときだけ足す。ほかのオリジンへの要求には絶対に足さない（合言葉が漏れる）。
//
// 合言葉の出どころは 2 つ:
//   - Tauri（デスクトップ版）: アプリが起動ごとに作る合言葉。Rust の `get_api_token` で受け取る
//     （sidecar へも同じ値を渡している）。利用者が入力するものではない
//   - それ以外（セルフホスト）: 利用者が設定画面で入れた合言葉（server-fs の localStorage）

import { apiBase, isTauri } from "./platform";
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

let tauriTokenPromise: Promise<string | null> | null = null;

/**
 * Tauri の合言葉。成功した値の Promise を使い回す。失敗したら null（ヘッダーなしで送る）を返し、控えは捨てて次の要求で再試行する。
 * fetch 以外で API を読むもの（pdf.js）が自分でヘッダーを付けるときにも使う。API 以外の宛先には絶対に付けないこと
 */
export function getTauriApiToken(): Promise<string | null> {
  if (!tauriTokenPromise) {
    const p: Promise<string | null> = (async () => {
      try {
        // Web 版のバンドルに入れないよう動的 import（sidecar.ts と同じ書き方）
        const { invoke } = await import("@tauri-apps/api/core");
        const token = await invoke<string>("get_api_token");
        return typeof token === "string" && token ? token : null;
      } catch (e) {
        console.warn("[api-auth] get_api_token failed; sending API requests without a token:", e);
        return null;
      }
    })();
    tauriTokenPromise = p;
    // 失敗（null）は控えない。一時的な失敗が居座らないよう、次の要求で再試行する
    void p.then((v) => {
      if (v === null && tauriTokenPromise === p) tauriTokenPromise = null;
    });
  }
  return tauriTokenPromise;
}

/** テスト用: 控えた合言葉を捨てる */
export function __resetTauriApiTokenForTest(): void {
  tauriTokenPromise = null;
}

/** fetch を包む。トークンが無い・宛先が API でないときは何も足さずに素通しする */
export function withApiAuth(baseFetch: typeof fetch): typeof fetch {
  const send = (input: RequestInfo | URL, init: RequestInit | undefined, token: string, override: boolean) => {
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined));
    // 呼び出し側が付けた合言葉は尊重する。ただしデスクトップ版は起動ごとの値を優先して上書きする
    if (headers.has(TOKEN_HEADER) && !override) return baseFetch(input, init);
    headers.set(TOKEN_HEADER, token);
    return baseFetch(input, { ...init, headers });
  };
  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isTauri()) {
      // デスクトップ版: 宛先が API のときだけ、合言葉を受け取ってから送る
      if (!isApiTarget(input)) return baseFetch(input, init);
      return getTauriApiToken().then((token) => (token ? send(input, init, token, true) : baseFetch(input, init)));
    }
    const token = serverAuthHeaders()[TOKEN_HEADER];
    if (!token || !isApiTarget(input)) return baseFetch(input, init);
    return send(input, init, token, false);
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
