// 他のツール（Claude Code）の会話の記録を読む入口。
// - デスクトップ版の sidecar でだけ動く（セルフホストでは読む先がサーバー自身のホームになるため）
// - 読む場所（baseDir）はリクエストから受けない。サービスの既定（defaultClaudeProjectsDir）に任せる
// - どちらも POST（Origin と合言葉の検査は app.ts が行う。ブラウザのキャッシュにも残さない）
// - 応答は集計と、会話の共通の形だけ。記録の生の行は返さない

import { homedir } from "node:os";
import { Hono } from "hono";

import { summarizeWorkdirs } from "../../lib/conversation/render.js";
import type { ConversationMaterial } from "../../lib/conversation/types.js";
import {
  defaultClaudeProjectsDir,
  listClaudeConversations,
  readClaudeSession,
  type ClaudeConversationListing,
  type ClaudeConversationRef,
} from "../services/claude-code-sessions.js";

const app = new Hono();

const MAX_READ_SESSIONS = 50;
const LISTING_TTL_MS = 30_000;
/** 会話 1 本の文字数の上限（本人の発言と抜粋の合計）。超えるものは読めなかった扱いにする */
const MAX_MATERIAL_CHARS = 5_000_000;
/** 1 回の応答に載せる文字数の上限。超えたら残りは読まずに failed に数える（画面は 20 件ずつ呼ぶ） */
const MAX_RESPONSE_CHARS = 20_000_000;

// デスクトップ版でなければ何も読まない（判定は要求ごと）
app.use("*", async (c, next) => {
  if (process.env.GRAPHIUM_DESKTOP !== "1") {
    return c.json({ error: "Not available", code: "NOT_AVAILABLE" }, 404);
  }
  await next();
});

// --- 一覧の読み直しを絞る（実行中の Promise の共有 + 30 秒の覚え） ---
type WorkdirsPayload = { searchedPath: string; workdirs: unknown[] };
let inflight: { key: string; promise: Promise<WorkdirsPayload> } | null = null;
let cached: { key: string; at: number; value: WorkdirsPayload } | null = null;

export function __resetConversationListingCacheForTest(): void {
  inflight = null;
  cached = null;
}

/** 一覧の応答を組む（集計も含めて覚える。覚えが効いている間は、要求ごとの計算をしない） */
function buildWorkdirsPayload(listing: ClaudeConversationListing[]): WorkdirsPayload {
  const rows = summarizeWorkdirs(listing.map((l) => l.summary));
  const byWorkdir = new Map<string, ClaudeConversationListing[]>();
  for (const l of listing) {
    if (l.summary.ownTurns <= 0) continue;
    const list = byWorkdir.get(l.summary.workdir);
    if (list) list.push(l);
    else byWorkdir.set(l.summary.workdir, [l]);
  }
  const workdirs = rows.map((row) => {
    const sessionRefs = (byWorkdir.get(row.workdir) ?? [])
      .sort((a, b) => (a.summary.endedAt < b.summary.endedAt ? 1 : a.summary.endedAt > b.summary.endedAt ? -1 : 0))
      .map((l) => l.ref);
    return { ...row, sessionRefs };
  });
  return { searchedPath: displayPath(defaultClaudeProjectsDir()), workdirs };
}

function loadListing(): Promise<WorkdirsPayload> {
  // 鍵に読む場所を入れる（CLAUDE_CONFIG_DIR が変わったら覚えを使わない）
  const key = defaultClaudeProjectsDir();
  if (cached && cached.key === key && Date.now() - cached.at < LISTING_TTL_MS) {
    return Promise.resolve(cached.value);
  }
  if (inflight && inflight.key === key) return inflight.promise;
  const promise = listClaudeConversations()
    .then((listing) => {
      const value = buildWorkdirsPayload(listing);
      cached = { key, at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { key, promise };
  return promise;
}

/** 表示用: ホームの下なら `~` に置き換える */
function displayPath(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(home + "/") || path.startsWith(home + "\\")) return "~" + path.slice(home.length);
  return path;
}

app.post("/claude-code/workdirs", async (c) => {
  try {
    return c.json(await loadListing());
  } catch {
    return c.json({ error: "Failed to read conversation records" }, 500);
  }
});

/** 読み取りの順番待ち（1 本ずつ） */
let readQueue: Promise<unknown> = Promise.resolve();

function isRef(v: unknown): v is ClaudeConversationRef {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.dirName === "string" && typeof r.fileName === "string";
}

app.post("/claude-code/read", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }
  const sessions = (body as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(sessions) || sessions.length === 0 || sessions.length > MAX_READ_SESSIONS || !sessions.every(isRef)) {
    return c.json({ error: "Invalid request" }, 400);
  }
  // 同じ組は 1 回だけ読む
  const seen = new Set<string>();
  const refs: ClaudeConversationRef[] = [];
  for (const s of sessions) {
    const key = JSON.stringify([s.dirName, s.fileName]);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ dirName: s.dirName, fileName: s.fileName });
  }
  const materials: ConversationMaterial[] = [];
  let failed = 0;
  // 読むのは、要求をまたいで 1 本ずつ（同時に来た要求が大きな記録を並べて抱えないように）
  const run = async () => {
    let total = 0;
    for (const ref of refs) {
      if (total >= MAX_RESPONSE_CHARS) {
        failed += 1;
        continue;
      }
      // 名前の形の検査・リンクを辿らない読み方はサービスがやる。baseDir は渡さない
      const m = await readClaudeSession(ref.dirName, ref.fileName);
      const chars = m ? m.turns.reduce((a, t) => a + t.text.length, 0) : 0;
      if (!m || chars > MAX_MATERIAL_CHARS) {
        failed += 1;
        continue;
      }
      total += chars;
      materials.push(m);
    }
  };
  const mine = readQueue.then(run, run);
  readQueue = mine.catch(() => undefined);
  try {
    await mine;
  } catch {
    return c.json({ error: "Failed to read conversation records" }, 500);
  }
  return c.json({ materials, failed });
});

export default app;
