// Sign in with ChatGPT の状態管理（サインイン・トークン更新・サインアウト）
//
// 設定 → AI の「ChatGPT でサインイン」の裏側。ブラウザで承認 → 127.0.0.1 の待ち受けが
// callback を受ける → token 交換 → ID トークン検証 → 保存、までをここで持つ。
// 状態（進行中のサインイン・更新の直列化）はこのモジュール内に持つ（copilot-cli-manager と同じ流儀）。
// トークン・authorize URL（id_token_hint を含みうる）はログに出さない。

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CodedError, type ChatGptSignInErrorCode } from "../../../lib/ai-error-codes.js";
import { getServerMode } from "../../config/models.js";
import {
  buildAuthorizeUrl,
  CALLBACK_PATH,
  DYNAMIC_CLIENT_ID,
  decodeIdTokenUnverified,
  exchangeCode,
  fetchDiscovery,
  fetchJwks,
  generatePkce,
  isTerminalRefreshError,
  OAuthError,
  parseCallback,
  PLAN_USAGE_SCOPE,
  randomUrlToken,
  REGISTRATION_PORT,
  refreshTokens,
  revokeToken,
  verifyIdToken,
  type CallbackResult,
  type Discovery,
} from "./oauth.js";
import { loadAuth, persistAuth, updateAuth, withoutTokens, type ChatGptAccount, type ChatGptAuthFile } from "./store.js";

/** サインインの待ち時間の上限（10 分） */
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;
/** 期限のこの時間前から更新する */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** earliest_refresh_at を過ぎていて、期限がこの範囲に入ったら更新する */
const EARLY_REFRESH_WINDOW_MS = 15 * 60 * 1000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

/** code 付きのエラー（ルートが HTTP ステータスへ変換する） */
export class ChatGptSignInError extends Error {
  readonly code: ChatGptSignInErrorCode;
  constructor(message: string, code: ChatGptSignInErrorCode) {
    super(message);
    this.name = "ChatGptSignInError";
    this.code = code;
  }
}

export type SignInState = {
  state: "idle" | "waiting" | "succeeded" | "failed";
  error: string | null;
  errorCode: string | null;
};

export type ChatGptPlanStatus = {
  /** このサーバーでサインインを始められるか（デスクトップ / ローカルの node のみ） */
  available: boolean;
  signIn: SignInState;
  /** トークンを持っているときだけ非 null */
  account: { email: string | null; planUsage: boolean; welcomed: boolean } | null;
};

/** テストから差し替えられる依存 */
export type ChatGptPlanManagerDeps = {
  fetch: typeof fetch;
  now: () => number;
  /** 初回登録の待ち受けポート（本番は 1455 固定） */
  registrationPort: number;
  signInTimeoutMs: number;
};

const CALLBACK_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Graphium</title></head><body>' +
  "<p>You can close this tab and return to Graphium.</p>" +
  "<p>このタブを閉じて、Graphium に戻ってください。</p></body></html>";

function sendPage(res: ServerResponse, status: number): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  });
  res.end(CALLBACK_HTML);
}

function sendPlain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Connection: "close" });
  res.end(text);
}

function hasPlanUsage(account: ChatGptAccount): boolean {
  return account.scopes?.includes(PLAN_USAGE_SCOPE) ?? false;
}

function authExpired(message = "Your ChatGPT sign-in is missing or has expired. Sign in again in Settings → AI."): CodedError {
  return new CodedError(message, "CHATGPT_PLAN_AUTH_EXPIRED");
}

/** 127.0.0.1 で待ち受ける。ports を順に試し、使用中なら次へ。全部だめなら EADDRINUSE を投げる */
function listenOnLoopback(server: Server, ports: number[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryNext = (i: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener("listening", onListening);
        if (err.code === "EADDRINUSE" && i + 1 < ports.length) tryNext(i + 1);
        else reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve((server.address() as AddressInfo).port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(ports[i], "127.0.0.1");
    };
    tryNext(0);
  });
}

export function createChatGptPlanManager(overrides: Partial<ChatGptPlanManagerDeps> = {}) {
  const deps: ChatGptPlanManagerDeps = {
    fetch: (...args) => globalThis.fetch(...args),
    now: () => Date.now(),
    registrationPort: REGISTRATION_PORT,
    signInTimeoutMs: SIGN_IN_TIMEOUT_MS,
    ...overrides,
  };

  let signIn: SignInState = { state: "idle", error: null, errorCode: null };
  let session: { close: () => void } | null = null;
  let refreshing: Promise<void> | null = null;
  let discoveryCache: { value: Discovery; at: number } | null = null;

  async function getDiscovery(): Promise<Discovery> {
    if (discoveryCache && deps.now() - discoveryCache.at < DISCOVERY_TTL_MS) return discoveryCache.value;
    const value = await fetchDiscovery(deps.fetch);
    discoveryCache = { value, at: deps.now() };
    return value;
  }

  function getStatus(): ChatGptPlanStatus {
    // Web 実行ではファイルに触れない
    if (getServerMode() !== "node") {
      return { available: false, signIn: { state: "idle", error: null, errorCode: null }, account: null };
    }
    let auth: ChatGptAuthFile;
    try {
      auth = loadAuth();
    } catch {
      // 読み取り失敗でも状態は返す（サインイン無しとして扱う。ファイルは上書きしない）
      console.warn("[chatgpt-plan] could not read the sign-in file; reporting no account");
      return { available: true, signIn: { ...signIn }, account: null };
    }
    const acc = auth.account;
    const hasTokens = !!acc && !!(acc.accessToken || acc.refreshToken);
    return {
      available: getServerMode() === "node",
      signIn: { ...signIn },
      account: acc && hasTokens ? { email: acc.email, planUsage: hasPlanUsage(acc), welcomed: !!auth.welcomed } : null,
    };
  }

  function markWelcomed(): void {
    updateAuth((c) => ({ ...c, welcomed: true }));
  }

  async function startSignIn(): Promise<{ authUrl: string }> {
    if (getServerMode() !== "node") {
      throw new ChatGptSignInError("Sign in with ChatGPT is not available in this environment.", "CHATGPT_UNAVAILABLE");
    }
    if (signIn.state === "waiting") {
      throw new ChatGptSignInError("A ChatGPT sign-in is already in progress.", "ALREADY_SIGNING_IN");
    }
    signIn = { state: "waiting", error: null, errorCode: null };

    let auth: ChatGptAuthFile;
    try {
      auth = loadAuth();
      // hostId の初回保存はここで行う（loadAuth は読むだけ）
      persistAuth(auth);
    } catch (err) {
      signIn = { state: "idle", error: null, errorCode: null };
      throw err;
    }
    const saved = auth.account;
    const registering = !saved;
    const { verifier, challenge } = generatePkce();
    const state = randomUrlToken(24);
    const nonce = randomUrlToken(24);
    let handled = false;
    // end() で立つ。取り消し・時間切れ・サインアウト・完了のあとは、この試行は何も書かない
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const server = createServer((req, res) => void onRequest(req, res));
    const closeServer = () => {
      try {
        server.close();
        server.closeAllConnections?.();
      } catch {
        // すでに閉じている
      }
    };
    const end = (next: SignInState) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      timer = null;
      closeServer();
      if (session === mySession) session = null;
      signIn = next;
    };
    const mySession = {
      close: () => {
        // 取り消し: 状態を idle に戻す
        if (signIn.state === "waiting") end({ state: "idle", error: null, errorCode: null });
        else closeServer();
      },
    };
    const fail = (message: string, errorCode: string | null = null) =>
      end({ state: "failed", error: message, errorCode });

    let port: number;
    try {
      port = await listenOnLoopback(server, registering ? [deps.registrationPort] : [deps.registrationPort, 0]);
    } catch (err) {
      finished = true;
      signIn = { state: "idle", error: null, errorCode: null };
      closeServer();
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        throw new ChatGptSignInError(
          `Port ${deps.registrationPort} on 127.0.0.1 is in use by another app. Close it and try again.`,
          "CHATGPT_PORT_IN_USE",
        );
      }
      throw err;
    }
    session = mySession;
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

    // 受け取ったトークンを使わずに捨てるとき、リフレッシュトークンの失効をできる範囲で試す
    const discard = async (refreshToken: string | null, clientId: string): Promise<void> => {
      if (!refreshToken) return;
      try {
        const d = await getDiscovery();
        if (d.revocationEndpoint) await revokeToken(deps.fetch, { revocationEndpoint: d.revocationEndpoint, token: refreshToken, clientId });
      } catch {
        // best-effort
      }
    };

    // callback 受信後の処理（検証 → token 交換 → ID トークン検証 → 保存）。
    // 各 await のあとで、この試行がまだ生きているか確かめる（取り消し後に保存しない）
    const complete = async (r: Extract<CallbackResult, { kind: "code" }>): Promise<void> => {
      const clientId = registering ? (r.clientId as string) : (saved as ChatGptAccount).clientId;
      const tokens = await exchangeCode(
        deps.fetch,
        { clientId, code: r.code, codeVerifier: verifier, redirectUri },
        deps.now(),
      );
      if (finished) return discard(tokens.refreshToken, clientId);
      if (!tokens.idToken) {
        await discard(tokens.refreshToken, clientId);
        throw new OAuthError("The token response had no id_token.");
      }
      let claims;
      try {
        const discovery = await getDiscovery();
        const jwks = await fetchJwks(deps.fetch, discovery.jwksUri);
        if (finished) return discard(tokens.refreshToken, clientId);
        claims = verifyIdToken(tokens.idToken, { jwks, clientId, nonce, now: deps.now() });
      } catch (err) {
        await discard(tokens.refreshToken, clientId);
        throw err;
      }
      if (finished) return discard(tokens.refreshToken, clientId);
      const subject = claims.sub as string;
      if (!registering && subject !== (saved as ChatGptAccount).subject) {
        // 別のアカウントで承認された。新しく受け取ったトークンは使わず失効する
        await discard(tokens.refreshToken, clientId);
        const cur = loadAuth().account;
        if (cur && (cur.accessToken || cur.refreshToken)) {
          // 保存済みのアカウントがサインイン中なら、何も消さない
          throw new OAuthError("You signed in with a different ChatGPT account. To switch accounts, sign out first.");
        }
        // 保存済みがサインアウト後なら、登録を捨てる。次のサインインは新規登録（dynamic_agent_client）で始まる
        updateAuth((c) => (c.account?.subject === (saved as ChatGptAccount).subject ? { ...c, account: null } : c));
        throw new OAuthError("You signed in with a different ChatGPT account than before. Try again to connect this account.");
      }
      const scopes = tokens.scopes ?? (r.scope ? r.scope.split(/\s+/).filter(Boolean) : []);
      updateAuth((cur) => ({
        ...cur,
        account: {
          email: typeof claims.email === "string" ? claims.email : (saved?.email ?? null),
          subject,
          clientId,
          idToken: tokens.idToken as string,
          accessToken: tokens.accessToken,
          ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
          expiresAt: tokens.expiresAt,
          ...(tokens.earliestRefreshAt !== null ? { earliestRefreshAt: tokens.earliestRefreshAt } : {}),
          scopes,
          savedAt: deps.now(),
        },
      }));
    };

    async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
        sendPlain(res, 404, "Not found");
        return;
      }
      if (handled || signIn.state !== "waiting") {
        sendPlain(res, 400, "This sign-in is already finished.");
        return;
      }
      const r = parseCallback(url.searchParams, {
        expectedState: state,
        registering,
        savedClientId: saved?.clientId ?? null,
      });
      // state が違う要求は無関係なものとして断り、本物の callback を待ち続ける
      if (r.kind === "state-mismatch") {
        sendPlain(res, 400, "Invalid state.");
        return;
      }
      handled = true;
      if (r.kind === "denied") {
        sendPage(res, 200);
        fail("You declined the sign-in in the browser.", "CHATGPT_ACCESS_DENIED");
        return;
      }
      if (r.kind === "error") {
        sendPage(res, 400);
        fail(r.message);
        return;
      }
      try {
        await complete(r);
        sendPage(res, 200);
        // 取り消し済みなら end() は何もしない（状態を succeeded で上書きしない）
        end({ state: "succeeded", error: null, errorCode: null });
      } catch (err) {
        sendPage(res, 400);
        fail(err instanceof OAuthError || err instanceof ChatGptSignInError ? err.message : "Sign-in could not be completed.");
      }
    }

    timer = setTimeout(() => {
      if (signIn.state === "waiting") fail("The sign-in timed out. Try again.");
    }, deps.signInTimeoutMs);
    timer.unref?.();

    const authUrl = buildAuthorizeUrl({
      clientId: registering ? DYNAMIC_CLIENT_ID : (saved as ChatGptAccount).clientId,
      registering,
      hostId: auth.hostId,
      redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
      ...(saved?.idToken ? { idTokenHint: saved.idToken } : {}),
      ...(saved?.email ? { loginHint: saved.email } : {}),
    });
    return { authUrl };
  }

  function cancelSignIn(): void {
    session?.close();
  }

  async function signOut(): Promise<{ revoked: boolean }> {
    cancelSignIn();
    // 進行中の更新があれば終わるのを待つ（失敗は握る）。更新が回転させた新しいトークンを失効・消去するため
    if (refreshing) await refreshing.catch(() => undefined);
    const acc = loadAuth().account;
    let revoked = false;
    if (acc?.refreshToken) {
      try {
        const d = await getDiscovery();
        if (d.revocationEndpoint) {
          revoked = await revokeToken(deps.fetch, {
            revocationEndpoint: d.revocationEndpoint,
            token: acc.refreshToken,
            clientId: acc.clientId,
          });
        }
      } catch {
        revoked = false;
      }
    }
    // 失効を確認できなくてもローカルは消す。client_id・sub・email は残す（次回は再認可）
    updateAuth((c) => ({ ...c, account: c.account ? withoutTokens(c.account) : null }));
    signIn = { state: "idle", error: null, errorCode: null };
    return { revoked };
  }

  function needsRefresh(acc: ChatGptAccount): boolean {
    const now = deps.now();
    if (acc.expiresAt === undefined || !acc.accessToken) return true;
    if (now >= acc.expiresAt - REFRESH_MARGIN_MS) return true;
    if (acc.earliestRefreshAt !== undefined && now >= acc.earliestRefreshAt && now >= acc.expiresAt - EARLY_REFRESH_WINDOW_MS) {
      return true;
    }
    return false;
  }

  async function doRefresh(): Promise<void> {
    const acc = loadAuth().account;
    if (!acc?.refreshToken) throw authExpired();
    const used = acc.refreshToken;
    let tokens;
    try {
      tokens = await refreshTokens(deps.fetch, { clientId: acc.clientId, refreshToken: acc.refreshToken }, deps.now());
    } catch (err) {
      if (isTerminalRefreshError(err)) {
        // 保存されているリフレッシュトークンが自分の使ったものと違えば、他のプロセスが回転済み。消さない
        if (loadAuth().account?.refreshToken !== used) return;
        // 再認可で id_token_hint に使えるよう、ID トークンは残す
        updateAuth((c) =>
          c.account && c.account.subject === acc.subject && c.account.refreshToken === used
            ? { ...c, account: withoutTokens(c.account, { keepIdToken: true }) }
            : c,
        );
        throw authExpired();
      }
      // ネットワーク失敗・5xx ではトークンを消さない
      throw err;
    }
    // リフレッシュトークンは回転するので、トークン・期限・スコープをまとめて差し替える
    updateAuth((c) => {
      // 保存されているリフレッシュトークンが自分の使ったものと同じときだけ書く（サインアウトや他の更新を上書きしない）
      if (!c.account || c.account.subject !== acc.subject || c.account.refreshToken !== used) return c;
      const idTokenOk = tokens.idToken && decodeIdTokenUnverified(tokens.idToken)?.sub === acc.subject;
      const { earliestRefreshAt: _drop, ...rest } = c.account;
      return {
        ...c,
        account: {
          ...rest,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? c.account.refreshToken,
          ...(idTokenOk ? { idToken: tokens.idToken as string } : {}),
          expiresAt: tokens.expiresAt,
          ...(tokens.earliestRefreshAt !== null ? { earliestRefreshAt: tokens.earliestRefreshAt } : {}),
          scopes: tokens.scopes ?? c.account.scopes,
          savedAt: deps.now(),
        },
      };
    });
  }

  /** 同時に 2 つ走らせない（Promise を共有して直列化する） */
  function refreshNow(): Promise<void> {
    if (!refreshing) {
      refreshing = doRefresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function getAccessToken(): Promise<string> {
    const first = loadAuth().account;
    if (!first || (!first.accessToken && !first.refreshToken)) throw authExpired();
    if (!hasPlanUsage(first)) {
      throw authExpired("ChatGPT plan usage was not granted for this sign-in. Sign in again and allow plan usage in Settings → AI.");
    }
    if (needsRefresh(first)) {
      try {
        await refreshNow();
      } catch (err) {
        // 一時的な失敗でも、アクセストークンがまだ有効ならそれを使う
        if (err instanceof CodedError) throw err;
        const still = loadAuth().account;
        if (!still?.accessToken || still.expiresAt === undefined || still.expiresAt - deps.now() < 30_000) {
          // ネットワーク・5xx の一時的な失敗で、使えるトークンも無い。サインインは保ったままあとでやり直す
          throw new CodedError(
            "ChatGPT plan access could not be refreshed right now. Your sign-in is kept; try again in a little while.",
            "CHATGPT_PLAN_UNAVAILABLE",
          );
        }
      }
    }
    const acc = loadAuth().account;
    if (!acc?.accessToken) throw authExpired();
    if (!hasPlanUsage(acc)) {
      throw authExpired("ChatGPT plan usage was not granted for this sign-in. Sign in again and allow plan usage in Settings → AI.");
    }
    return acc.accessToken;
  }

  /** テスト用: 進行中のサインイン・更新・キャッシュを捨てる */
  function resetForTest(): void {
    session?.close();
    session = null;
    signIn = { state: "idle", error: null, errorCode: null };
    refreshing = null;
    discoveryCache = null;
  }

  return { getStatus, startSignIn, cancelSignIn, signOut, getAccessToken, markWelcomed, resetForTest };
}

export const chatgptPlanManager = createChatGptPlanManager();
