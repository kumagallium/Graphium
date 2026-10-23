// 素材（media/）を扱う 3 つのツール: list_media / get_media_file / add_material。
//
// Asterism など外部アプリが Graphium の素材を「取り込み元」として使うための口。
// 既存のツール（tools.ts / read-tools.ts）が人向けの文字列を返すのと違い、この 3 つは
// 機械が読む前提で **JSON 文字列を content[0].text に 1 本** 返し、失敗は isError: true と { error } で返す。
//
// 方針:
//   - 任意のパスを読まない。get_media_file は検証した id で media/ 直下だけを引き、
//     add_material は bytes（base64）だけを受け取る（path は受けない）。
//   - media/ に書くのは add_material の中だけ。実体は `<id>.<ext>.tmp` に書いてから rename、
//     メタは writeFileAtomic。どちらもアプリの一覧（meta を全部読む）を壊さないため。
//   - 索引（appdata/media-index.json）は書かない（v1）。アプリの ensureMediaIndex が
//     media/ の件数差で拾い、contentHash は後追いで付く。そのため add_material が足した
//     直後の素材は list_media にもアプリの被り判定にも出ない（アプリの再起動まで）。
//     その穴を埋めるのが自前の台帳 appdata/mcp-added-media.json（sha256 → fileId）。
//
// 実体とメタの書式・拡張子の決め方は src-tauri/src/lib.rs（media_ext / find_media_data_file /
// save_media_file_sync）に揃える。片方を変えたら両方直すこと。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { MediaIndexEntry, MediaType } from "../features/asset-browser/media-index";
import { computeBlobHash } from "../lib/storage/shared/hash";
import { MEDIA_TYPES } from "./media-search";
import { readMediaIndex } from "./sources";
import { writeFileAtomic } from "./upkeep/atomic-write";
import { acquireWriteLock } from "./upkeep/guard";
import { appDataDir, resolveGraphiumRoot, vaultExists } from "./vault";

/** get_media_file の inline と add_material で扱う bytes の上限 */
export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
/** list_media の既定件数 */
export const LIST_DEFAULT_LIMIT = 100;
/** list_media の最大件数 */
export const LIST_MAX_LIMIT = 1000;
/** 台帳のファイル名（appdata/ 直下） */
export const ADDED_LEDGER_FILENAME = "mcp-added-media.json";

export function mediaDir(root = resolveGraphiumRoot()): string {
  return join(root, "media");
}

// ── id の検証 ────────────────────────────────────────────────

/**
 * 素材 id として受け付けてよいか。vault.ts:readNote（区切り文字・`..`）と
 * server/routes/storage.ts:safeId（区切り文字・NUL・先頭ドット）の両方の規則を合わせる。
 * 通らなければ理由を返す（null なら OK）。
 */
export function validateMediaId(id: unknown): string | null {
  if (typeof id !== "string" || id.length === 0) return "id が空です";
  if (/[\\/]/.test(id)) return "id に区切り文字（/ や \\）は使えません";
  if (id.includes("..")) return "id に .. は使えません";
  if (id.includes("\0")) return "id に NUL 文字は使えません";
  if (id.startsWith(".")) return "id はドットで始められません";
  if (id.length > 255) return "id が長すぎます";
  return null;
}

// ── 実体の探し方（lib.rs の find_media_data_file と同じ） ─────────

/** 本体ではないファイルの末尾（メタ・Reader 原文・文字起こし・清書・要約・書きかけ） */
const NOT_DATA_SUFFIXES = [".meta.json", ".txt", ".transcript.json", ".cleanup.json", ".summary.json", ".tmp"];

/**
 * media/ 直下から id の実体ファイルを探す。`<id>.` 始まりを優先し、無ければ旧形式 `<id>`
 * （拡張子なし。`.txt` の原本もこの形で保存されている）。見つからなければ null。
 */
export function findMediaDataFile(dir: string, fileId: string): string | null {
  if (!fileId) return null;
  const prefix = `${fileId}.`;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (NOT_DATA_SUFFIXES.some((s) => name.endsWith(s))) continue;
    if (name.startsWith(prefix)) {
      const p = join(dir, name);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        /* 読めない項目は飛ばす */
      }
    }
  }
  const bare = join(dir, fileId);
  try {
    if (statSync(bare).isFile()) return bare;
  } catch {
    /* 無い */
  }
  return null;
}

type MediaMeta = { id?: string; name?: string; mimeType?: string; createdTime?: string };

/** `<id>.meta.json` を読む。無い・壊れていれば null */
function readMediaMeta(dir: string, fileId: string): MediaMeta | null {
  const p = join(dir, `${fileId}.meta.json`);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as MediaMeta;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ── 拡張子と MIME（lib.rs の media_ext / ext_from_mime と同じ規則） ───

/** 本体ファイルに使えない拡張子（`.txt` は Reader 原文専用） */
const RESERVED_MEDIA_EXTS = new Set(["txt"]);

const EXT_FROM_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  // 表のデータ（lib.rs には無いが、拡張子は名前から決まるので保存形式には影響しない）
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "application/json": "json",
};

/** 名前の拡張子 → MIME（mimeType を省いたときの補完。無ければ application/octet-stream） */
const MIME_FROM_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_FROM_MIME)
    .filter(([mime]) => mime !== "audio/x-wav")
    .map(([mime, ext]) => [ext, mime]),
);
MIME_FROM_EXT.jpeg = "image/jpeg";
MIME_FROM_EXT.txt = "text/plain";

function sanitizeExt(e: string | undefined): string | null {
  if (!e) return null;
  const lower = e.toLowerCase();
  if (lower.length === 0 || lower.length > 8 || !/^[a-z0-9]+$/.test(lower)) return null;
  if (RESERVED_MEDIA_EXTS.has(lower)) return null;
  return lower;
}

/** 名前の拡張子（ドットの後ろ） */
function nameExt(name: string): string | undefined {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return base.slice(dot + 1);
}

/** 保存に使う拡張子。名前を優先し、無ければ MIME から。決められなければ null（拡張子なし） */
export function mediaExt(name: string, mimeType: string): string | null {
  return sanitizeExt(nameExt(name)) ?? sanitizeExt(EXT_FROM_MIME[mimeType]);
}

function guessMimeType(name: string): string {
  const ext = nameExt(name)?.toLowerCase();
  return (ext && MIME_FROM_EXT[ext]) || "application/octet-stream";
}

// ── 返り値の組み立て ───────────────────────────────────────

function json(body: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}

function fail(error: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error }) }] };
}

/** 道具の本体が投げる、利用者に見せてよい失敗 */
export class MediaToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaToolError";
  }
}

function vaultMissingMessage(root: string): string {
  return (
    `Graphium の vault が見つかりません: ${root}。` +
    "GRAPHIUM_ROOT 環境変数で vault のルート（notes/ を含むディレクトリ）を指定してください。"
  );
}

// ── list_media ──────────────────────────────────────────────

export type ListMediaItem = {
  id: string;
  name: string;
  type: MediaType;
  mimeType: string;
  size?: number;
  uploadedAt: string;
  folder?: string;
  contentHash?: string;
};

export type ListMediaOptions = {
  /** ドット付き小文字の拡張子（例 [".csv", ".xlsx"]）。大文字小文字は区別しない */
  exts?: string[];
  folder?: string;
  type?: MediaType;
  limit?: number;
};

/** 索引に載っていて実体を持ちうる素材か（URL ブックマークとメモには実体ファイルが無い） */
function hasDataFile(m: MediaIndexEntry): boolean {
  return m.type !== "url" && m.type !== "memo";
}

function normalizeExts(exts: string[] | undefined): string[] | null {
  if (!exts || exts.length === 0) return null;
  const out = exts
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
    .map((e) => (e.startsWith(".") ? e : `.${e}`));
  return out.length > 0 ? out : null;
}

function uploadedAtMs(s: string | undefined): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** 索引から、アーカイブされていない素材を uploadedAt の新しい順に返す */
export function listMedia(options: ListMediaOptions = {}, root = resolveGraphiumRoot()): { items: ListMediaItem[] } {
  if (!vaultExists(root)) throw new MediaToolError(vaultMissingMessage(root));
  const exts = normalizeExts(options.exts);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? LIST_DEFAULT_LIMIT)), LIST_MAX_LIMIT);
  const dir = mediaDir(root);

  const candidates: MediaIndexEntry[] = [];
  for (const m of readMediaIndex(root).values()) {
    if (m.archivedAt) continue;
    if (!hasDataFile(m)) continue;
    if (options.type && m.type !== options.type) continue;
    if (options.folder && !(m.noteContexts ?? []).includes(options.folder)) continue;
    if (exts) {
      const lower = (m.name ?? "").toLowerCase();
      if (!exts.some((e) => lower.endsWith(e))) continue;
    }
    candidates.push(m);
  }
  candidates.sort((a, b) => uploadedAtMs(b.uploadedAt) - uploadedAtMs(a.uploadedAt));

  const items: ListMediaItem[] = [];
  for (const m of candidates.slice(0, limit)) {
    const item: ListMediaItem = {
      id: m.fileId,
      name: m.name,
      type: m.type,
      mimeType: m.mimeType ?? "",
      uploadedAt: m.uploadedAt ?? "",
    };
    // size は索引に無いので実体を stat する（無い・読めないときは省く）
    const p = findMediaDataFile(dir, m.fileId);
    if (p) {
      try {
        item.size = statSync(p).size;
      } catch {
        /* 省く */
      }
    }
    const folder = m.noteContexts?.[0];
    if (folder) item.folder = folder;
    if (m.contentHash) item.contentHash = m.contentHash;
    items.push(item);
  }
  return { items };
}

// ── get_media_file ──────────────────────────────────────────

export type GetMediaFileResult = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  bytes_base64?: string;
};

/** 索引でなく media/ 直下を直接引く（add_material が返した id もアーカイブ済みも、id 指定なら返す） */
export async function getMediaFile(
  options: { id: string; inline?: boolean },
  root = resolveGraphiumRoot(),
): Promise<GetMediaFileResult> {
  if (!vaultExists(root)) throw new MediaToolError(vaultMissingMessage(root));
  const bad = validateMediaId(options.id);
  if (bad) throw new MediaToolError(bad);
  const dir = mediaDir(root);
  const p = findMediaDataFile(dir, options.id);
  if (!p) throw new MediaToolError(`素材が見つかりません: ${options.id}`);
  const size = (await stat(p)).size;
  const meta = readMediaMeta(dir, options.id);
  const indexed = meta ? undefined : readMediaIndex(root).get(options.id);
  const name = meta?.name || indexed?.name || p.split(/[\\/]/).pop() || options.id;
  const mimeType = meta?.mimeType || indexed?.mimeType || guessMimeType(name);
  const out: GetMediaFileResult = { id: options.id, name, mimeType, size };
  if (options.inline && size <= MAX_MEDIA_BYTES) {
    out.bytes_base64 = (await readFile(p)).toString("base64");
  }
  return out;
}

// ── 台帳（appdata/mcp-added-media.json） ───────────────────────

export type AddedLedgerEntry = { fileId: string; name: string; addedAt: string };
export type AddedLedger = { version: 1; added: Record<string, AddedLedgerEntry> };

export function addedLedgerPath(root = resolveGraphiumRoot()): string {
  return join(appDataDir(root), ADDED_LEDGER_FILENAME);
}

/** 台帳を読む。無い・壊れている・形が違うときは空（台帳は被りの近道でしかなく、無くても正しさは索引が担う） */
export function readAddedLedger(root = resolveGraphiumRoot()): AddedLedger {
  const p = addedLedgerPath(root);
  if (!existsSync(p)) return { version: 1, added: {} };
  try {
    const r = JSON.parse(readFileSync(p, "utf8")) as Partial<AddedLedger> | null;
    if (!r || typeof r !== "object" || r.version !== 1 || !r.added || typeof r.added !== "object" || Array.isArray(r.added)) {
      return { version: 1, added: {} };
    }
    return { version: 1, added: r.added };
  } catch {
    return { version: 1, added: {} };
  }
}

async function writeAddedLedger(ledger: AddedLedger, root: string): Promise<void> {
  await writeFileAtomic(addedLedgerPath(root), JSON.stringify(ledger, null, 2));
}

// ── add_material ────────────────────────────────────────────

export type AddMaterialInput = {
  bytes_base64: string;
  name: string;
  mimeType?: string;
  /** v1 では受け付けない（渡されたら拒否） */
  path?: unknown;
  /** v1 では受け付けない（渡されたら拒否） */
  folder?: unknown;
};

export type AddMaterialResult = { id: string; duplicate: boolean; indexed?: false };

// 同一プロセス内の呼び出しを直列にする（writeFileAtomic の一時ファイル名が pid 単位で衝突するため。asterism-sent.ts と同じ）
let queue: Promise<unknown> = Promise.resolve();

/** 被りを中身の SHA-256 で合流させつつ、media/ に素材を 1 つ足す */
export function addMaterial(input: AddMaterialInput, root = resolveGraphiumRoot()): Promise<AddMaterialResult> {
  const run = queue.then(() => addMaterialLocked(input, root));
  queue = run.catch(() => undefined);
  return run;
}

/** base64 の文字数から、復号後が上限を超えることが確実か（復号する前に大きすぎる入力を弾く） */
function base64TooLarge(s: string): boolean {
  return s.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 4;
}

async function addMaterialLocked(input: AddMaterialInput, root: string): Promise<AddMaterialResult> {
  if (!vaultExists(root)) throw new MediaToolError(vaultMissingMessage(root));
  if (input.path !== undefined) throw new MediaToolError("path は受け付けません。bytes_base64 でファイルの中身を渡してください");
  if (input.folder !== undefined) throw new MediaToolError("folder は v1 では受け付けません");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.includes("\0")) throw new MediaToolError("name が空です");
  if (typeof input.bytes_base64 !== "string" || input.bytes_base64.length === 0) {
    throw new MediaToolError("bytes_base64 が空です");
  }
  if (base64TooLarge(input.bytes_base64)) {
    throw new MediaToolError(`大きすぎます（上限 ${MAX_MEDIA_BYTES / 1024 / 1024} MiB）`);
  }
  const compact = input.bytes_base64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new MediaToolError("bytes_base64 が base64 ではありません");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0) throw new MediaToolError("bytes_base64 を復号すると空でした");
  if (bytes.length > MAX_MEDIA_BYTES) {
    throw new MediaToolError(`大きすぎます（上限 ${MAX_MEDIA_BYTES / 1024 / 1024} MiB）`);
  }
  const mimeType = (typeof input.mimeType === "string" && input.mimeType.trim()) || guessMimeType(name);

  const lock = await acquireWriteLock(root);
  if (!lock.ok) throw new MediaToolError(lock.message);
  try {
    return await addMaterialUnderLock({ bytes, name, mimeType }, root);
  } finally {
    await lock.release().catch(() => undefined);
  }
}

/** 索引の中で、この id がアーカイブされているか（索引に無ければ false） */
function archivedInIndex(index: Map<string, MediaIndexEntry>, fileId: string): boolean {
  return Boolean(index.get(fileId)?.archivedAt);
}

async function addMaterialUnderLock(
  input: { bytes: Buffer; name: string; mimeType: string },
  root: string,
): Promise<AddMaterialResult> {
  const dir = mediaDir(root);
  await mkdir(dir, { recursive: true });
  const hash = await computeBlobHash(new Uint8Array(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength));
  const index = readMediaIndex(root);

  // 1) 索引の contentHash（アプリが付けたもの）。アーカイブ済み・実体が無いものとは合流しない
  for (const m of index.values()) {
    if (m.contentHash !== hash || m.archivedAt || !hasDataFile(m)) continue;
    if (findMediaDataFile(dir, m.fileId)) return { id: m.fileId, duplicate: true };
  }

  // 2) 自前の台帳（MCP が足したもの。索引にまだ無い間の近道）
  const ledger = readAddedLedger(root);
  const hit = ledger.added[hash];
  if (hit) {
    const alive = findMediaDataFile(dir, hit.fileId) !== null && !archivedInIndex(index, hit.fileId);
    if (alive) return { id: hit.fileId, duplicate: true };
    // 本体が消えた・アーカイブされた行は捨てて新規扱い
    delete ledger.added[hash];
  }

  // 3) 新規: 実体を `<id>.<ext>.tmp` に書いて rename → メタを原子的に書く
  const id = randomUUID();
  const ext = mediaExt(input.name, input.mimeType);
  const filename = ext ? `${id}.${ext}` : id;
  const dataPath = join(dir, filename);
  const tmpPath = `${dataPath}.tmp`;
  try {
    await writeFile(tmpPath, input.bytes);
    await rename(tmpPath, dataPath);
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw e;
  }
  try {
    const meta = { id, name: input.name, mimeType: input.mimeType, createdTime: new Date().toISOString() };
    await writeFileAtomic(join(dir, `${id}.meta.json`), JSON.stringify(meta));
  } catch (e) {
    // メタが無い本体は一覧に出ない孤児になるので一緒に消す
    await rm(dataPath, { force: true }).catch(() => undefined);
    throw e;
  }

  ledger.added[hash] = { fileId: id, name: input.name, addedAt: new Date().toISOString() };
  await writeAddedLedger(ledger, root);
  return { id, duplicate: false, indexed: false };
}

// ── 登録 ─────────────────────────────────────────────────────

/** 失敗を isError の JSON にして返す。想定外の例外もメッセージだけを出す */
async function guarded<T>(fn: () => Promise<T> | T) {
  try {
    return json(await fn());
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export function registerMediaTools(server: McpServer): void {
  server.registerTool(
    "list_media",
    {
      title: "素材を一覧する",
      description:
        "Graphium の素材（ファイルの実体を持つもの）を、新しい順に一覧する。外部アプリが取り込み元として使うための機械向けの口で、" +
        "返りは JSON 文字列 { items: [{ id, name, type, mimeType, size?, uploadedAt, folder?, contentHash? }] }。" +
        "拡張子（exts。ドット付き小文字で渡す。比較は大文字小文字を区別しない）・フォルダ・種類で絞れる。アーカイブ済みと URL・メモは出ない。" +
        "人が探すときは search_media を使う。add_material で足した直後の素材は、Graphium が索引を作り直すまで出ない。",
      inputSchema: {
        exts: z.array(z.string()).optional().describe('拡張子で絞る（例 [".csv", ".tsv", ".xlsx"]）'),
        folder: z.string().optional().describe("フォルダ名で絞る"),
        type: z.enum(MEDIA_TYPES).optional().describe("素材の種類で絞る"),
        limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional().describe(`最大件数（既定 ${LIST_DEFAULT_LIMIT}）`),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => guarded(() => listMedia(args)),
  );

  server.registerTool(
    "get_media_file",
    {
      title: "素材のファイルを取り出す",
      description:
        "素材 1 件のファイル情報（と中身）を返す。返りは JSON 文字列 { id, name, mimeType, size, bytes_base64? }。" +
        `inline: true のとき、${MAX_MEDIA_BYTES / 1024 / 1024} MiB 以下なら bytes_base64 に中身を入れる（超えると省く）。` +
        "id は list_media か add_material の返りのもの。索引でなく media/ を直接引くので、アーカイブ済みでも id が分かれば返す。",
      inputSchema: {
        id: z.string().describe("素材の id"),
        inline: z.boolean().optional().describe("中身を base64 で含める（既定 false）"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => guarded(() => getMediaFile(args)),
  );

  server.registerTool(
    "add_material",
    {
      title: "素材を足す",
      description:
        "ファイルの中身（base64）を Graphium の素材として置く。同じ中身（SHA-256 が一致）の素材が既にあれば新しく作らず、その id を返す。" +
        "返りは JSON 文字列 { id, duplicate, indexed? }（duplicate: true は合流。indexed: false は Graphium がまだ索引に載せていない）。" +
        `path は受け付けない（中身は bytes_base64 で渡す）。${MAX_MEDIA_BYTES / 1024 / 1024} MiB 超は拒否。folder は今は指定できない。` +
        "足した素材は Graphium の次回起動時に一覧へ現れる。",
      inputSchema: {
        bytes_base64: z.string().describe("ファイルの中身（base64）"),
        name: z.string().describe("ファイル名（拡張子を含む。例 price.csv）"),
        mimeType: z.string().optional().describe("MIME タイプ（省くと名前から推定）"),
        path: z.string().optional().describe("受け付けない（指定すると失敗する）"),
        folder: z.string().optional().describe("受け付けない（v1 では指定すると失敗する）"),
      },
    },
    async (args) => guarded(() => addMaterial(args)),
  );
}
