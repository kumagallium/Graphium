// ストレージ API（Docker / セルフホスト Web 用）
//
// クライアント（ServerFilesystemProvider）が叩く REST エンドポイント。
// Vercel モードではディスクが永続化されないため capabilities=false を返す。
//
// レイアウト:
//   <DATA_DIR>/notes/*.json
//   <DATA_DIR>/wiki/*.json
//   <DATA_DIR>/skills/*.json
//   <DATA_DIR>/media/<id>.<ext>   (バイナリ)
//   <DATA_DIR>/media/<id>.meta.json (name, mimeType, createdTime)
//   <DATA_DIR>/appdata/<key>.json
//
// 認証: 環境変数 GRAPHIUM_AUTH_TOKEN がセットされていれば、
//       X-Graphium-Token ヘッダーが一致するリクエストのみ許可する。

import { Hono } from "hono";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join, extname } from "node:path";
import type { Context, Next } from "hono";
import { getServerMode } from "../config/models.js";

type FileInfo = {
  id: string;
  name: string;
  modifiedTime: string;
  createdTime: string;
};

type MediaInfo = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
};

type MediaMeta = {
  name: string;
  mimeType: string;
  createdTime: string;
};

function resolveDataDir(): string {
  return process.env.DATA_DIR ?? join(process.cwd(), "data");
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function subdir(name: string): string {
  const dir = join(resolveDataDir(), name);
  ensureDir(dir);
  return dir;
}

function safeId(id: string): string {
  // パストラバーサル防止: スラッシュ・バックスラッシュ・ヌル文字を拒否
  if (!id || id.includes("/") || id.includes("\\") || id.includes("\0") || id.startsWith(".")) {
    throw new Error("不正なファイル ID です");
  }
  return id;
}

function listJsonFiles(dir: string): FileInfo[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const files: FileInfo[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (!st.isFile()) continue;
    files.push({
      id: name.slice(0, -".json".length),
      name,
      modifiedTime: st.mtime.toISOString(),
      createdTime: (st.birthtime ?? st.ctime).toISOString(),
    });
  }
  files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  return files;
}

const docTypes: Array<{ slug: string; sub: string }> = [
  { slug: "notes", sub: "notes" },
  { slug: "wiki", sub: "wiki" },
  { slug: "skills", sub: "skills" },
];

const app = new Hono();

// 認証ミドルウェア
async function authMiddleware(c: Context, next: Next) {
  const expected = process.env.GRAPHIUM_AUTH_TOKEN;
  if (!expected) {
    await next();
    return;
  }
  const token = c.req.header("x-graphium-token");
  if (token !== expected) {
    return c.json({ error: "認証に失敗しました" }, 401);
  }
  await next();
}

app.use("*", authMiddleware);

// 機能検出
app.get("/capabilities", (c) => {
  const serverStorage = getServerMode() !== "vercel";
  return c.json({
    serverStorage,
    requiresAuth: !!process.env.GRAPHIUM_AUTH_TOKEN,
  });
});

// --- ドキュメント CRUD（notes / wiki / skills） ---

for (const { slug, sub } of docTypes) {
  app.get(`/${slug}`, (c) => {
    return c.json(listJsonFiles(subdir(sub)));
  });

  app.get(`/${slug}/:id`, (c) => {
    try {
      const id = safeId(c.req.param("id"));
      const path = join(subdir(sub), `${id}.json`);
      if (!existsSync(path)) return c.json({ error: "ファイルが存在しません" }, 404);
      return c.body(readFileSync(path, "utf-8"), 200, {
        "content-type": "application/json",
      });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  });

  app.put(`/${slug}/:id`, async (c) => {
    try {
      const id = safeId(c.req.param("id"));
      const body = await c.req.text();
      // バリデーション: JSON として有効か
      JSON.parse(body);
      writeFileSync(join(subdir(sub), `${id}.json`), body, "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  });

  app.delete(`/${slug}/:id`, (c) => {
    try {
      const id = safeId(c.req.param("id"));
      const path = join(subdir(sub), `${id}.json`);
      if (existsSync(path)) unlinkSync(path);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  });
}

// --- メディア ---

function mediaMetaPath(id: string): string {
  return join(subdir("media"), `${id}.meta.json`);
}

function findMediaFile(id: string): string | null {
  const dir = subdir("media");
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir);
  for (const name of entries) {
    if (name.endsWith(".meta.json")) continue;
    if (name.startsWith(`${id}.`) || name === id) {
      return join(dir, name);
    }
  }
  return null;
}

function readMediaMeta(id: string): MediaMeta | null {
  const p = mediaMetaPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as MediaMeta;
  } catch {
    return null;
  }
}

app.get("/media", (c) => {
  const dir = subdir("media");
  if (!existsSync(dir)) return c.json([]);
  const entries = readdirSync(dir);
  const items: MediaInfo[] = [];
  for (const name of entries) {
    if (!name.endsWith(".meta.json")) continue;
    const id = name.slice(0, -".meta.json".length);
    const meta = readMediaMeta(id);
    if (!meta) continue;
    items.push({
      id,
      name: meta.name,
      mimeType: meta.mimeType,
      createdTime: meta.createdTime,
    });
  }
  items.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  return c.json(items);
});

// アップロード: multipart/form-data または application/octet-stream + クエリ
app.post("/media", async (c) => {
  try {
    const id = c.req.query("id") ?? crypto.randomUUID();
    safeId(id);
    const ct = c.req.header("content-type") ?? "";
    let bytes: Uint8Array;
    let name: string;
    let mimeType: string;
    if (ct.startsWith("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return c.json({ error: "file フィールドが必要です" }, 400);
      }
      const buffer = await file.arrayBuffer();
      bytes = new Uint8Array(buffer);
      name = file.name;
      mimeType = file.type || "application/octet-stream";
    } else {
      const buffer = await c.req.arrayBuffer();
      bytes = new Uint8Array(buffer);
      name = c.req.query("name") ?? id;
      mimeType = ct || "application/octet-stream";
    }
    // 既存の同 id ファイルを削除（拡張子が変わる可能性があるため）
    const existing = findMediaFile(id);
    if (existing) unlinkSync(existing);
    const ext = extname(name) || "";
    const filename = ext ? `${id}${ext}` : id;
    writeFileSync(join(subdir("media"), filename), bytes);
    const meta: MediaMeta = {
      name,
      mimeType,
      createdTime: new Date().toISOString(),
    };
    writeFileSync(mediaMetaPath(id), JSON.stringify(meta), "utf-8");
    return c.json({ id, name, mimeType, url: `media-server://${id}` });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

app.get("/media/:id", (c) => {
  try {
    const id = safeId(c.req.param("id"));
    const path = findMediaFile(id);
    if (!path) return c.json({ error: "メディアが存在しません" }, 404);
    const meta = readMediaMeta(id);
    const data = readFileSync(path);
    return c.body(new Uint8Array(data), 200, {
      "content-type": meta?.mimeType ?? "application/octet-stream",
      "cache-control": "private, max-age=86400",
    });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

app.patch("/media/:id", async (c) => {
  try {
    const id = safeId(c.req.param("id"));
    const meta = readMediaMeta(id);
    if (!meta) return c.json({ error: "メディアが存在しません" }, 404);
    const body = await c.req.json<{ name?: string }>();
    if (typeof body.name === "string" && body.name.trim()) {
      meta.name = body.name.trim();
      writeFileSync(mediaMetaPath(id), JSON.stringify(meta), "utf-8");
    }
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

app.delete("/media/:id", (c) => {
  try {
    const id = safeId(c.req.param("id"));
    const file = findMediaFile(id);
    if (file) unlinkSync(file);
    const metaP = mediaMetaPath(id);
    if (existsSync(metaP)) unlinkSync(metaP);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

// --- アプリデータ（インデックスファイル等の内部メタデータ） ---

app.get("/appdata/:key", (c) => {
  try {
    const key = safeId(c.req.param("key"));
    const path = join(subdir("appdata"), `${key}.json`);
    if (!existsSync(path)) return c.json(null);
    return c.body(readFileSync(path, "utf-8"), 200, {
      "content-type": "application/json",
    });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

app.put("/appdata/:key", async (c) => {
  try {
    const key = safeId(c.req.param("key"));
    const body = await c.req.text();
    JSON.parse(body); // バリデーション
    writeFileSync(join(subdir("appdata"), `${key}.json`), body, "utf-8");
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

export default app;
