// Web クリップ API（ブラウザ拡張機能 → sidecar → アプリ）
//
// 拡張機能が送ったクリップを DATA_DIR/clip/inbox/<id>.json に置くだけの受け口。
// メモ・ノートへの書き込みはアプリ（features/web-clip）だけが行う — メモ索引は
// まるごと上書きで保存するので、sidecar とアプリの 2 者が書くと片方の変更が消える。
//
// 認証は 2 系統:
//   - 拡張機能向け（POST / と GET /ping）: ペアリングの合言葉（X-Graphium-Clip-Token）。
//     任意の Web ページから localhost へ書き込まれないための要（CSRF 対策）。
//     カスタムヘッダーなので preflight が要り、CORS の許可オリジンに Web ページは無いので、
//     ページからは送れない。合言葉はさらにその上の守り
//   - アプリ向け（/inbox・/pairing）: storage API と同じ GRAPHIUM_AUTH_TOKEN（セルフホスト用）
//
// レイアウト:
//   <DATA_DIR>/clip/token            合言葉（0600）
//   <DATA_DIR>/clip/inbox/<id>.json  受け取り待ちのクリップ

import { Hono } from "hono";
import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { getServerMode } from "../config/models.js";

/** 1 件のクリップ（拡張機能から届いた形を整えたもの） */
export type WebClip = {
  id: string;
  url: string;
  title: string;
  /** 選んだ範囲の文。範囲を選ばずにページをクリップしたときは無い */
  text?: string;
  /** ページのメタ情報から読んだ DOI（"10.xxxx/..."） */
  doi?: string;
  /** 拡張機能でクリップした時刻（ISO） */
  clippedAt: string;
  /** sidecar が受け取った時刻（ISO） */
  receivedAt: string;
};

// 上限（設計書「セキュリティ」の表と揃える）
export const CLIP_LIMITS = {
  body: 1024 * 1024,
  text: 50_000,
  url: 2048,
  title: 500,
  doi: 200,
  /** 受け取り待ちの件数。アプリが長く閉じていても DATA_DIR を食い潰さない */
  inbox: 1000,
} as const;

function clipDir(): string {
  const dir = join(process.env.DATA_DIR ?? join(process.cwd(), "data"), "clip");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function inboxDir(): string {
  const dir = join(clipDir(), "inbox");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function tokenPath(): string {
  return join(clipDir(), "token");
}

function newToken(): string {
  // 256 bit。URL・ヘッダーにそのまま書ける base64url
  return randomBytes(32).toString("base64url");
}

function writeToken(token: string): void {
  const path = tokenPath();
  writeFileSync(path, token, { encoding: "utf8", mode: 0o600 });
  // 既存ファイルの上書きでは mode が効かないので付け直す
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows 等で失敗しても動作は続ける
  }
}

/** 合言葉を読む。無ければ作る */
export function readOrCreateClipToken(): string {
  const path = tokenPath();
  if (existsSync(path)) {
    const token = readFileSync(path, "utf8").trim();
    if (token.length >= 32) return token;
  }
  const token = newToken();
  writeToken(token);
  return token;
}

/** 定数時間で比べる（長さが違えば false） */
export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 制御文字（改行・タブは残す）を落として長さで切る */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);
}

/**
 * 届いた JSON をクリップに整える。URL が http(s) でなければ null。
 * id・受け取り時刻はここで付ける（拡張機能の値は信用しない）。
 */
export function normalizeIncomingClip(
  body: unknown,
  now: Date = new Date(),
  id: string = randomUUID(),
): WebClip | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const url = cleanText(b.url, CLIP_LIMITS.url + 1).trim();
  if (!url || url.length > CLIP_LIMITS.url || !isHttpUrl(url)) return null;
  const title = cleanText(b.title, CLIP_LIMITS.title).trim();
  const text = cleanText(b.text, CLIP_LIMITS.text).trim();
  const doi = cleanText(b.doi, CLIP_LIMITS.doi).trim();
  const clippedAtRaw = typeof b.clippedAt === "string" ? b.clippedAt : "";
  const clippedAtMs = Date.parse(clippedAtRaw);
  const receivedAt = now.toISOString();
  return {
    id,
    url,
    title,
    ...(text ? { text } : {}),
    ...(/^10\.\d{4,9}\/\S+$/.test(doi) ? { doi } : {}),
    clippedAt: Number.isFinite(clippedAtMs) ? new Date(clippedAtMs).toISOString() : receivedAt,
    receivedAt,
  };
}

function listInbox(): WebClip[] {
  const dir = inboxDir();
  const clips: WebClip[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      clips.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as WebClip);
    } catch {
      // 壊れたファイルは読み飛ばす（アプリの処理を止めない）
    }
  }
  // クリップした順に処理する
  return clips.sort((a, b) => (a.clippedAt < b.clippedAt ? -1 : a.clippedAt > b.clippedAt ? 1 : 0));
}

function isValidClipId(id: string): boolean {
  return /^[0-9a-f-]{36}$/.test(id);
}

const app = new Hono();

// Vercel（ディスクが永続しない公開 API）では受け付けない
app.use("*", async (c, next) => {
  if (getServerMode() === "vercel") return c.json({ error: "Web clip is not available" }, 404);
  await next();
});

async function extensionAuth(c: Context, next: Next) {
  const given = c.req.header("x-graphium-clip-token");
  if (!tokenMatches(given, readOrCreateClipToken())) {
    return c.json({ error: "Invalid clip token" }, 401);
  }
  await next();
}

async function appAuth(c: Context, next: Next) {
  const expected = process.env.GRAPHIUM_AUTH_TOKEN;
  if (expected && c.req.header("x-graphium-token") !== expected) {
    return c.json({ error: "Authentication failed" }, 401);
  }
  await next();
}

// ── 拡張機能向け ──

app.get("/ping", extensionAuth, (c) => c.json({ ok: true }));

app.post(
  "/",
  bodyLimit({
    maxSize: CLIP_LIMITS.body,
    onError: (c) => c.json({ error: "Clip too large" }, 413),
  }),
  extensionAuth,
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const clip = normalizeIncomingClip(body);
    if (!clip) return c.json({ error: "url must be an http(s) URL" }, 400);
    const dir = inboxDir();
    const pending = readdirSync(dir).filter((n) => n.endsWith(".json")).length;
    if (pending >= CLIP_LIMITS.inbox) {
      return c.json({ error: "Clip inbox is full. Open Graphium to receive pending clips." }, 507);
    }
    // 書きかけのファイルをアプリが読まないよう、別名で書いてから置き換える
    const final = join(dir, `${clip.id}.json`);
    const tmp = `${final}.tmp`;
    writeFileSync(tmp, JSON.stringify(clip), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, final);
    return c.json({ ok: true, id: clip.id }, 201);
  },
);

// ── アプリ向け ──

app.get("/inbox", appAuth, (c) => c.json({ clips: listInbox() }));

app.delete("/inbox/:id", appAuth, (c) => {
  const id = c.req.param("id") ?? "";
  if (!isValidClipId(id)) return c.json({ error: "Invalid id" }, 400);
  const path = join(inboxDir(), `${id}.json`);
  if (existsSync(path)) unlinkSync(path);
  return c.json({ ok: true });
});

/** 設定画面に出すペアリングコード（"<port>.<token>"） */
app.get("/pairing", appAuth, (c) => c.json({ code: pairingCode() }));

/** 合言葉を作り直す（拡張機能のコードは入れ直しになる） */
app.post("/pairing/reset", appAuth, (c) => {
  writeToken(newToken());
  return c.json({ code: pairingCode() });
});

function pairingCode(): string {
  const port = Number(process.env.PORT ?? 3001);
  return `${port}.${readOrCreateClipToken()}`;
}

// ── 承認するペアリング（コードを貼らずにつなぐ） ──
//
// 拡張機能が申し込み → アプリに「許可しますか？」と 4 桁の番号を出す → 利用者が
// 拡張機能の画面の番号と見比べて許可 → 拡張機能が結果を取りに来てコードを受け取る。
//
// 守り:
//   - 申し込みと結果の取得は Origin が chrome-extension:// のものだけ。Origin は
//     Web ページからは偽れないので、開いているページは申し込めない
//   - コードを受け取れるのは申し込んだのと同じ拡張機能だけ（Origin を照合）。1 回渡したら消す
//   - ほかの拡張機能が申し込んでも、利用者が許可しなければ通らない。番号はその見分け用
//   - 許可・却下はアプリ向けの口。JSON 必須にして、Web ページの単純リクエスト
//     （preflight 無し）では届かないようにする
//   - 申し込みはメモリにだけ置き、2 分で切れる。同時に待てるのは数件まで

type PairRequest = {
  id: string;
  origin: string;
  number: string;
  requestedAt: number;
  status: "pending" | "approved" | "denied";
};

export const PAIR_TTL_MS = 2 * 60 * 1000;
const PAIR_MAX_PENDING = 3;
const pairRequests = new Map<string, PairRequest>();

/** テスト用 */
export function clearPairRequests(): void {
  pairRequests.clear();
}

function prunePairRequests(now = Date.now()): void {
  for (const [id, r] of pairRequests) {
    if (now - r.requestedAt > PAIR_TTL_MS) pairRequests.delete(id);
  }
}

/** Chrome 拡張機能の Origin（chrome-extension://<32 文字の ID>）だけ通す */
export function extensionOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin : null;
}

app.post("/pair", (c) => {
  const origin = extensionOrigin(c.req.header("origin"));
  if (!origin) return c.json({ error: "Pairing requests are accepted from the browser extension only" }, 403);
  prunePairRequests();
  // 同じ拡張機能の古い申し込みは置き換える（押し直しで画面に何件も並ばないように）
  for (const [id, r] of pairRequests) {
    if (r.origin === origin) pairRequests.delete(id);
  }
  const pending = [...pairRequests.values()].filter((r) => r.status === "pending").length;
  if (pending >= PAIR_MAX_PENDING) return c.json({ error: "Too many pairing requests" }, 429);
  const req: PairRequest = {
    id: randomUUID(),
    origin,
    number: String(randomInt(0, 10_000)).padStart(4, "0"),
    requestedAt: Date.now(),
    status: "pending",
  };
  pairRequests.set(req.id, req);
  return c.json({ id: req.id, number: req.number, expiresInMs: PAIR_TTL_MS }, 201);
});

// 結果の問い合わせも POST。拡張機能のページからの GET には Chrome が Origin を付けない
app.post("/pair/:id", (c) => {
  const origin = extensionOrigin(c.req.header("origin"));
  if (!origin) return c.json({ error: "Forbidden" }, 403);
  prunePairRequests();
  const req = pairRequests.get(c.req.param("id") ?? "");
  // 別の拡張機能の申し込みは「無い」と同じに見せる
  if (!req || req.origin !== origin) return c.json({ status: "expired" }, 404);
  if (req.status === "pending") return c.json({ status: "pending" });
  pairRequests.delete(req.id);
  if (req.status === "denied") return c.json({ status: "denied" });
  return c.json({ status: "approved", code: pairingCode() });
});

app.get("/pair-requests", appAuth, (c) => {
  prunePairRequests();
  const requests = [...pairRequests.values()]
    .filter((r) => r.status === "pending")
    .map((r) => ({
      id: r.id,
      number: r.number,
      extensionId: r.origin.slice("chrome-extension://".length),
      requestedAt: new Date(r.requestedAt).toISOString(),
    }));
  return c.json({ requests });
});

app.post("/pair-requests/:id", appAuth, async (c) => {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 415);
  }
  let body: { approve?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  prunePairRequests();
  const req = pairRequests.get(c.req.param("id") ?? "");
  if (!req || req.status !== "pending") return c.json({ error: "No such request" }, 404);
  req.status = body.approve === true ? "approved" : "denied";
  return c.json({ ok: true });
});

export default app;
