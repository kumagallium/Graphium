// Graphium vault（ノート本体・インデックス）へのファイル直読みアクセス。
//
// MCP サーバーは **Graphium アプリが起動していなくても動く** ことを要件にするため、
// フロントエンドのストレージ抽象（src/lib/storage）は経由せず Node の fs で直接読む。
// そのため型だけを既存定義から借り、実装はこのファイル内で完結させる
// （src/lib/storage/registry は React 側の状態に依存しており import できない）。
//
// ルート解決の優先順は scripts/claude-code-skill/save-to-graphium/save.mjs と揃える。
// ズレると Skill と MCP で書き込み先が食い違うため、片方を変えたら両方直すこと。

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { GraphiumDocument } from "../lib/document-types";
import type { GraphiumIndex, NoteIndexEntry } from "../features/navigation/index-file";

/** Graphium アプリの設定ディレクトリ（Tauri v2 の app_config_dir と一致させる） */
function graphiumAppConfigDir(): string {
  const id = "com.graphium.app";
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", id);
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appdata, id);
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, id);
}

/** Graphium 本体の config.json から graphiumRoot を読む（未設定・破損なら null） */
function readConfiguredGraphiumRoot(): string | null {
  const configPath = join(graphiumAppConfigDir(), "config.json");
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf8").trim();
    if (!raw) return null;
    const root = (JSON.parse(raw) as { graphiumRoot?: unknown })?.graphiumRoot;
    return typeof root === "string" && root.trim() ? root.trim() : null;
  } catch {
    return null;
  }
}

/**
 * vault のルートを解決する。
 * GRAPHIUM_ROOT > アプリ設定の graphiumRoot > ~/Documents/Graphium
 *
 * save.mjs 互換のため GRAPHIUM_NOTES_DIR も尊重する（notes ディレクトリの親をルートとみなす）。
 */
export function resolveGraphiumRoot(): string {
  const explicit = process.env.GRAPHIUM_ROOT?.trim();
  if (explicit) return explicit;

  const notesDirEnv = process.env.GRAPHIUM_NOTES_DIR?.trim();
  if (notesDirEnv) return join(notesDirEnv, "..");

  return readConfiguredGraphiumRoot() ?? join(homedir(), "Documents", "Graphium");
}

export function notesDir(root = resolveGraphiumRoot()): string {
  // GRAPHIUM_NOTES_DIR は notes ディレクトリを直接指すので、その場合だけ素通しする
  const notesDirEnv = process.env.GRAPHIUM_NOTES_DIR?.trim();
  if (notesDirEnv && !process.env.GRAPHIUM_ROOT?.trim()) return notesDirEnv;
  return join(root, "notes");
}

export function wikiDir(root = resolveGraphiumRoot()): string {
  return join(root, "wiki");
}

export function appDataDir(root = resolveGraphiumRoot()): string {
  return join(root, "appdata");
}

/** vault が存在するか（ノートディレクトリの有無で判定） */
export function vaultExists(root = resolveGraphiumRoot()): boolean {
  return existsSync(notesDir(root));
}

/**
 * note-index.json を読む。
 *
 * このファイルはフロントエンドの ensureIndex が生成・更新するもので、MCP 側からは
 * 書き換えない（読み取り専用）。Graphium を一度も起動していない vault では存在しない。
 */
export function readNoteIndex(root = resolveGraphiumRoot()): GraphiumIndex | null {
  const path = join(appDataDir(root), "note-index.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as GraphiumIndex;
    if (!parsed || !Array.isArray(parsed.notes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 検索・一覧の対象になるエントリだけを返す。
 *
 * ゴミ箱（deletedAt）とアーカイブ（archivedAt）はフロントの一覧・検索から外れるので、
 * MCP でも同じ見え方に揃える。Skill ノート（source === "skill"）はプロンプトテンプレートで
 * 知識ではないため除外する。
 */
export function activeNotes(index: GraphiumIndex): NoteIndexEntry[] {
  return index.notes.filter(
    (n) => !n.deletedAt && !n.archivedAt && n.source !== "skill",
  );
}

/** ノート本体を読む。notes/ に無ければ wiki/ を見る（Wiki ドキュメントも noteId で引けるため） */
export function readNote(
  noteId: string,
  root = resolveGraphiumRoot(),
): GraphiumDocument | null {
  for (const dir of [notesDir(root), wikiDir(root)]) {
    const path = join(dir, `${noteId}.json`);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as GraphiumDocument;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * インデックスが無い vault のためのフォールバック。
 * notes/*.json を直接走査して最小限のエントリを組む（title と日付のみ）。
 */
export function scanNotesWithoutIndex(root = resolveGraphiumRoot()): NoteIndexEntry[] {
  const dir = notesDir(root);
  if (!existsSync(dir)) return [];
  const entries: NoteIndexEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const noteId = file.slice(0, -".json".length);
    const doc = readNote(noteId, root);
    if (!doc) continue;
    entries.push({
      noteId,
      title: doc.title ?? "(untitled)",
      modifiedAt: "",
      createdAt: "",
      headings: [],
      labels: [],
      outgoingLinks: [],
      source: doc.source,
    });
  }
  return entries;
}

/**
 * note-index.json の更新時刻（ミリ秒）。無ければ 0。
 *
 * MCP のプロセスはクライアントが生きている間ずっと残るため、その間に Graphium 本体が
 * ノートを追加・更新したことを検知する必要がある。Graphium は保存のたびにこのファイルを
 * 書き直すので、更新時刻が索引の鮮度の代わりになる。
 */
export function noteIndexMtimeMs(root = resolveGraphiumRoot()): number {
  try {
    return statSync(join(appDataDir(root), "note-index.json")).mtimeMs;
  } catch {
    return 0;
  }
}
