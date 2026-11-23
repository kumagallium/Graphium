// Claude Code の会話の記録（`~/.claude/projects/<作業フォルダを変換した名前>/<会話の id>.jsonl`）を
// 読むだけの入口。記録のフォルダには書き込まない。
//
// ここが受け取るのは「フォルダの名前」と「ファイルの名前」だけで、どちらもパスの 1 要素として
// 形を確かめてから使う（区切り文字・`..`・シンボリックリンクを通さない）。
// **baseDir は呼び出し側のコードが決める値で、リクエストから受け取ってはいけない**
// （受け取ると、この PC の任意のフォルダを読む口になる）。
//
// 記録は 1 本で数十 MB、全体で数 GB になることがある。ファイルを丸ごとメモリに載せず、
// 行ごとに流して読み取り役（lib/conversation/claude-code-reader）に渡す。

import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createClaudeCodeSessionReader } from "../../lib/conversation/claude-code-reader.js";
import {
  summarizeConversation,
  summarizeWorkdirs,
  type ConversationSummary,
  type WorkdirSummary,
} from "../../lib/conversation/render.js";
import type { ConversationMaterial } from "../../lib/conversation/types.js";

/** フォルダの名前として受け付ける形（Claude Code は作業フォルダのパスの記号を `-` に置き換える） */
const DIR_NAME_RE = /^[A-Za-z0-9_-]{1,255}$/;
/** 会話の記録のファイル名として受け付ける形 */
const SESSION_FILE_RE = /^([A-Za-z0-9_-]{1,100})\.jsonl$/;

/**
 * 1 行の上限（バイト）。超えた行は読まずに飛ばす。
 * 貼り付けた画像は発言と同じ行に base64 で入るので、小さくしすぎると本人の発言ごと落ちる。
 */
export const MAX_SESSION_LINE_BYTES = 32 * 1024 * 1024;

/** Claude Code の記録が置かれる既定の場所（CLAUDE_CONFIG_DIR があればその下） */
export function defaultClaudeProjectsDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return join(configDir || join(homedir(), ".claude"), "projects");
}

/**
 * Windows の予約デバイス名（CON・NUL・COM1 など）。拡張子を付けても開くと固まるので、
 * フォルダ名にも会話の id にも使わせない（サーバーの素材 id の検査と同じ理由）
 */
const WINDOWS_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function isValidProjectDirName(name: string): boolean {
  return DIR_NAME_RE.test(name) && !WINDOWS_RESERVED_RE.test(name);
}

export function sessionIdOfFileName(fileName: string): string | null {
  const id = SESSION_FILE_RE.exec(fileName)?.[1];
  return id && !WINDOWS_RESERVED_RE.test(id) ? id : null;
}

/** baseDir の実体のパス。無ければ null */
async function realBase(baseDir: string): Promise<string | null> {
  try {
    const real = await realpath(baseDir);
    return (await lstat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/** 作業フォルダの記録のフォルダ。名前の形が違う・実体がフォルダでない・リンクなら null */
async function projectDirPath(base: string, dirName: string): Promise<string | null> {
  if (!isValidProjectDirName(dirName)) return null;
  const path = join(base, dirName);
  try {
    // lstat はリンクを辿らない。リンクは isDirectory が false になるので、ここで落ちる
    return (await lstat(path)).isDirectory() ? path : null;
  } catch {
    return null;
  }
}

export type ClaudeProjectDir = {
  /** `~/.claude/projects` の直下のフォルダ名 */
  dirName: string;
  /** 会話の記録の本数 */
  sessionFiles: number;
  totalBytes: number;
  /** いちばん新しい記録の更新時刻（ISO 8601。記録が無ければ ""） */
  modifiedAt: string;
};

export type ClaudeSessionFile = {
  fileName: string;
  sessionId: string;
  bytes: number;
  modifiedAt: string;
};

/** 作業フォルダの記録のフォルダにある、会話の記録の一覧（中身は読まない） */
export async function listClaudeSessionFiles(
  dirName: string,
  baseDir: string = defaultClaudeProjectsDir(),
): Promise<ClaudeSessionFile[]> {
  const base = await realBase(baseDir);
  if (!base) return [];
  const dir = await projectDirPath(base, dirName);
  if (!dir) return [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: ClaudeSessionFile[] = [];
  for (const fileName of names) {
    const sessionId = sessionIdOfFileName(fileName);
    if (!sessionId) continue;
    try {
      const st = await lstat(join(dir, fileName));
      if (!st.isFile()) continue;
      out.push({ fileName, sessionId, bytes: st.size, modifiedAt: st.mtime.toISOString() });
    } catch {
      // 読んでいる間に消えたファイルは飛ばす
    }
  }
  return out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
}

/** 記録のフォルダの一覧（中身は読まない。本数と大きさだけ） */
export async function listClaudeProjectDirs(baseDir: string = defaultClaudeProjectsDir()): Promise<ClaudeProjectDir[]> {
  const base = await realBase(baseDir);
  if (!base) return [];
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return [];
  }
  const out: ClaudeProjectDir[] = [];
  for (const dirName of names) {
    if (!(await projectDirPath(base, dirName))) continue;
    const files = await listClaudeSessionFiles(dirName, base);
    if (files.length === 0) continue;
    out.push({
      dirName,
      sessionFiles: files.length,
      totalBytes: files.reduce((a, f) => a + f.bytes, 0),
      modifiedAt: files[0]?.modifiedAt ?? "",
    });
  }
  return out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
}

/** ファイルを行ごとに流す。上限を超える行は飛ばす */
async function* readLines(path: string, maxLineBytes: number): AsyncGenerator<string> {
  // 最後の要素がリンクに差し替えられていても辿らない（lstat のあとに差し替えられた場合の備え。
  // O_NOFOLLOW の無い Windows では lstat の確認だけになる）。
  // 開いたあとで、普通のファイルであることをもう一度確かめる
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    return;
  }
  const stream = handle.createReadStream({ highWaterMark: 1024 * 1024 });
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let skipping = false;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(10, start);
      if (nl < 0) {
        const rest = chunk.subarray(start);
        if (!skipping) {
          pendingBytes += rest.length;
          if (pendingBytes > maxLineBytes) {
            skipping = true;
            pending = [];
          } else if (rest.length > 0) {
            pending.push(rest);
          }
        }
        break;
      }
      if (!skipping) {
        const piece = chunk.subarray(start, nl);
        if (pendingBytes + piece.length <= maxLineBytes) {
          const line = pending.length > 0 ? Buffer.concat([...pending, piece]) : piece;
          yield line.toString("utf8");
        }
      }
      pending = [];
      pendingBytes = 0;
      skipping = false;
      start = nl + 1;
    }
  }
  if (!skipping && pendingBytes > 0) yield Buffer.concat(pending).toString("utf8");
}

export type ReadClaudeSessionOptions = {
  /** false にすると AI の返答を読まない（集計用） */
  includeAssistant?: boolean;
  maxLineBytes?: number;
};

/**
 * 会話の記録 1 本を、共通の形にして返す。
 * 名前の形が違う・ファイルが無い・リンク・会話として読めないときは null。
 */
export async function readClaudeSession(
  dirName: string,
  fileName: string,
  options: ReadClaudeSessionOptions = {},
  baseDir: string = defaultClaudeProjectsDir(),
): Promise<ConversationMaterial | null> {
  const sessionId = sessionIdOfFileName(fileName);
  if (!sessionId) return null;
  const base = await realBase(baseDir);
  if (!base) return null;
  const dir = await projectDirPath(base, dirName);
  if (!dir) return null;
  const path = join(dir, fileName);
  try {
    if (!(await lstat(path)).isFile()) return null;
  } catch {
    return null;
  }
  const reader = createClaudeCodeSessionReader({ sessionId, includeAssistant: options.includeAssistant });
  try {
    for await (const line of readLines(path, options.maxLineBytes ?? MAX_SESSION_LINE_BYTES)) {
      reader.push(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  } catch {
    return null;
  }
  return reader.finish();
}

/** 記録のフォルダ 1 つぶんの、会話ごとの集計（本文は持たない） */
export async function summarizeClaudeProjectDir(
  dirName: string,
  baseDir: string = defaultClaudeProjectsDir(),
): Promise<ConversationSummary[]> {
  const files = await listClaudeSessionFiles(dirName, baseDir);
  const out: ConversationSummary[] = [];
  for (const file of files) {
    const material = await readClaudeSession(dirName, file.fileName, { includeAssistant: false }, baseDir);
    if (material) out.push(summarizeConversation(material));
  }
  return out;
}

/**
 * 作業フォルダごとの一覧（本数・本人の発言の量・期間）。
 * 記録を全部読むので、量が多いと時間がかかる。フォルダを絞るときは dirNames を渡す。
 */
export async function listClaudeWorkdirs(
  options: { dirNames?: readonly string[]; candidateMinOwnChars?: number } = {},
  baseDir: string = defaultClaudeProjectsDir(),
): Promise<WorkdirSummary[]> {
  const dirNames = options.dirNames ?? (await listClaudeProjectDirs(baseDir)).map((d) => d.dirName);
  const all: ConversationSummary[] = [];
  for (const dirName of dirNames) {
    all.push(...(await summarizeClaudeProjectDir(dirName, baseDir)));
  }
  return summarizeWorkdirs(all, { candidateMinOwnChars: options.candidateMinOwnChars });
}

/** 会話 1 本を指す名前の組（`readClaudeSession` にそのまま渡せる） */
export type ClaudeConversationRef = { dirName: string; fileName: string };
export type ClaudeConversationListing = { ref: ClaudeConversationRef; summary: ConversationSummary };

/**
 * 会話ごとの集計の覚え。鍵は「読む場所・フォルダ名・ファイル名」、中身が同じかは大きさと更新時刻で見る。
 *
 * 記録は使い込むほど増える（数 GB・数千本）。一覧を開くたびに全部を読み直すと数十秒かかり、
 * 画面側の通信が打ち切られる。変わっていない記録は読み直さず、ここから返す。
 * 本文は持たない（集計だけ）ので、本数が増えても小さい。
 */
const summaryCache = new Map<string, { bytes: number; modifiedAt: string; summary: ConversationSummary }>();

export function __resetConversationSummaryCacheForTest(): void {
  summaryCache.clear();
}

/** 記録のフォルダを全部読み、会話ごとの集計と、その会話を指す名前の組を返す（本文は持たない） */
export async function listClaudeConversations(
  baseDir: string = defaultClaudeProjectsDir(),
): Promise<ClaudeConversationListing[]> {
  const out: ClaudeConversationListing[] = [];
  const seen = new Set<string>();
  const prefix = `${baseDir}\0`;
  for (const dir of await listClaudeProjectDirs(baseDir)) {
    for (const file of await listClaudeSessionFiles(dir.dirName, baseDir)) {
      const key = `${prefix}${dir.dirName}\0${file.fileName}`;
      seen.add(key);
      const ref = { dirName: dir.dirName, fileName: file.fileName };
      const hit = summaryCache.get(key);
      if (hit && hit.bytes === file.bytes && hit.modifiedAt === file.modifiedAt) {
        out.push({ ref, summary: hit.summary });
        continue;
      }
      const material = await readClaudeSession(dir.dirName, file.fileName, { includeAssistant: false }, baseDir);
      // 読めなかった会話は飛ばす（覚えない。次に開いたときにもう一度読む）
      if (!material) {
        summaryCache.delete(key);
        continue;
      }
      const summary = summarizeConversation(material);
      summaryCache.set(key, { bytes: file.bytes, modifiedAt: file.modifiedAt, summary });
      out.push({ ref, summary });
    }
  }
  // 消えた記録の覚えを捨てる（同じ読む場所の分だけ）
  for (const key of summaryCache.keys()) {
    if (key.startsWith(prefix) && !seen.has(key)) summaryCache.delete(key);
  }
  return out;
}
