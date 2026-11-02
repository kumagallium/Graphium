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
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
app.get("/pairing", appAuth, (c) => {
  const port = Number(process.env.PORT ?? 3001);
  return c.json({ code: `${port}.${readOrCreateClipToken()}` });
});

/** 合言葉を作り直す（拡張機能のコードは入れ直しになる） */
app.post("/pairing/reset", appAuth, (c) => {
  writeToken(newToken());
  const port = Number(process.env.PORT ?? 3001);
  return c.json({ code: `${port}.${readOrCreateClipToken()}` });
});

export default app;
