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
 * API 以外の宛先には絶対に付けないこと。API に付けるときも、相手が自分の sidecar だと確かめてから
 * （getVerifiedTauriApiToken を使う）
 */
function getTauriApiToken(): Promise<string | null> {
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

// ---- デスクトップ版: 合言葉を送る前に、相手が自分の sidecar かを確かめる ----
//
// sidecar は 127.0.0.1:3001 の決まった口で待つ。別のプログラム（同じパソコンのほかの利用者など）が
// 先にその口を握っていると、合言葉つきの要求がそのままそちらへ届く。合言葉を知られると、あとで
// 本物の sidecar を操作される。そこで、合言葉を付ける前に「相手が合言葉を知っている」ことを
// 確かめる: 乱数（challenge）だけを送り、相手が HMAC-SHA256(合言葉, 前置き + challenge) を返せたら
// 自分の sidecar とみなす。合言葉そのものは流さない。確かめられない間は、API への要求を送らない。

/** 証明に混ぜる前置き。サーバー側（src/server/auth-token.ts の SIDECAR_PROOF_PREFIX）と同じ値 */
const SIDECAR_PROOF_PREFIX = "graphium-sidecar-proof-v1:";

/** 包む前の fetch。installApiAuthFetch が控える（確認の要求は包みを通さない） */
let rawFetchRef: typeof fetch | null = null;

function rawFetch(): typeof fetch {
  return rawFetchRef ?? globalThis.fetch.bind(globalThis);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message))));
}

/** 長さと全文字を見てから結果を返す（途中で打ち切らない） */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SidecarProbe = {
  /** 3001 に何かが応答した */
  reachable: boolean;
  /** 応答が 2xx だった */
  ok: boolean;
  /** 相手が起動ごとの合言葉を知っていた（= 自分の sidecar） */
  own: boolean;
  /** health の応答（未認証の最小の形）。own でない相手の中身は信用しないこと */
  body: unknown;
};

/**
 * 確かめた結果を使い回す時間。確かめた相手が落ちて、別のプログラムが 3001 を握り直すことが
 * ありうる（`sidecar-closed` を受け取れない場合）。短く切って、合言葉を付ける前に確かめ直す。
 * 確認は手元への 1 往復なので、短くしても重くならない
 */
const VERIFIED_TTL_MS = 5000;

/** 確かめた時刻（確かめていない・捨てたときは null） */
let verifiedAt: number | null = null;
/** 捨てるたびに進む。確認の途中で捨てられたら、その確認の結果は控えない */
let verificationEpoch = 0;
let verifyInFlight: Promise<boolean> | null = null;

function isSidecarVerified(): boolean {
  if (verifiedAt === null) return false;
  const age = Date.now() - verifiedAt;
  // 時計が戻ったとき（負の差）は期限切れとして扱う
  return age >= 0 && age < VERIFIED_TTL_MS;
}

/** 確認の要求を待つ上限。応答しない相手が 3001 を握っていても、起動と API 要求を待たせ続けない */
const PROBE_TIMEOUT_MS = 3000;

/**
 * 3001 の相手が自分の sidecar かを、合言葉を送らずに確かめる。
 * 結果は控える（own なら以後の API 要求に合言葉を付ける）。
 */
export async function probeTauriSidecar(baseFetch: typeof fetch = rawFetch()): Promise<SidecarProbe> {
  const none: SidecarProbe = { reachable: false, ok: false, own: false, body: null };
  const epoch = verificationEpoch;
  // 結果を控える。確認の途中で捨てられていたら（止めた・入れ替えた）、古い結果で上書きしない
  const record = (own: boolean) => {
    if (epoch !== verificationEpoch) return;
    verifiedAt = own ? Date.now() : null;
  };
  let challenge: string;
  try {
    challenge = toHex(crypto.getRandomValues(new Uint8Array(32)));
  } catch (e) {
    console.error("[api-auth] cannot create a challenge (no Web Crypto?); API requests will not be sent:", e);
    record(false);
    return none;
  }
  let res: Response;
  let body: unknown;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    // 合言葉は付けない。包みを通さない fetch で送る
    res = await baseFetch(`${apiBase()}/health?challenge=${challenge}`, { signal: ac.signal });
    body = await res.json().catch(() => null);
  } catch {
    record(false);
    return none;
  } finally {
    clearTimeout(timer);
  }
  let own = false;
  if (res.ok) {
    const proof = (body as { proof?: unknown } | null | undefined)?.proof;
    const token = await getTauriApiToken();
    if (token && typeof proof === "string") {
      try {
        own = sameText(proof, await hmacSha256Hex(token, SIDECAR_PROOF_PREFIX + challenge));
      } catch (e) {
        // crypto.subtle が使えない環境では確かめられない。黙って全滅させず、理由を残す
        console.error("[api-auth] cannot verify the sidecar proof (no Web Crypto?); API requests will not be sent:", e);
        own = false;
      }
    }
  }
  record(own);
  return { reachable: true, ok: res.ok, own, body };
}

/** 確かめ済みなら true。まだなら 1 度だけ確かめる（同時に来た要求は同じ結果を待つ） */
function ensureTauriSidecarVerified(baseFetch: typeof fetch): Promise<boolean> {
  if (isSidecarVerified()) return Promise.resolve(true);
  if (!verifyInFlight) {
    const epoch = verificationEpoch;
    const p = probeTauriSidecar(baseFetch)
      // 確認の途中で捨てられていたら（止めた・入れ替えた）、その結果では合言葉を付けない
      .then((r) => r.own && epoch === verificationEpoch)
      .finally(() => {
        if (verifyInFlight === p) verifyInFlight = null;
      });
    verifyInFlight = p;
  }
  return verifyInFlight;
}

/** sidecar が止まった・入れ替わるときに呼ぶ。次の要求で確かめ直す */
export function invalidateTauriSidecarVerification(): void {
  verifiedAt = null;
  verificationEpoch++;
  // 進行中の確認には相乗りさせない（次の要求は新しく確かめる）
  verifyInFlight = null;
}

/**
 * 相手が自分の sidecar だと確かめられたときだけ、合言葉を返す（確かめられなければ null）。
 * fetch 以外で API を読むもの（pdf.js）が自分でヘッダーを付けるときに使う
 */
export async function getVerifiedTauriApiToken(): Promise<string | null> {
  return (await ensureTauriSidecarVerified(rawFetch())) ? getTauriApiToken() : null;
}

/** テスト用: 控えた合言葉と、確かめた結果を捨てる */
export function __resetTauriApiTokenForTest(): void {
  tauriTokenPromise = null;
  verifiedAt = null;
  verificationEpoch++;
  verifyInFlight = null;
  rawFetchRef = null;
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
      // デスクトップ版: 宛先が API のときだけ、相手が自分の sidecar だと確かめてから、合言葉を付けて送る。
      // 確かめられない相手には、合言葉も要求の中身も送らない（つながらないときと同じ失敗にする）
      if (!isApiTarget(input)) return baseFetch(input, init);
      return ensureTauriSidecarVerified(baseFetch).then(async (verified) => {
        const token = verified ? await getTauriApiToken() : null;
        if (!token) throw new TypeError("Graphium backend is not running or could not be verified");
        let res: Response;
        try {
          res = await send(input, init, token, true);
        } catch (e) {
          // つながらなかった = 相手が落ちた。3001 を別のプログラムが握り直すかもしれないので、
          // 次の要求では確かめ直してから合言葉を付ける。呼び出し側が取り消しただけのときは捨てない
          if ((e as { name?: unknown } | null)?.name !== "AbortError") invalidateTauriSidecarVerification();
          throw e;
        }
        // 合言葉が通らなかった = 相手が入れ替わった。次の要求で確かめ直す
        if (res.status === 401) invalidateTauriSidecarVerification();
        return res;
      });
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
  const original = globalThis.fetch.bind(globalThis);
  rawFetchRef = original;
  globalThis.fetch = withApiAuth(original);
}
