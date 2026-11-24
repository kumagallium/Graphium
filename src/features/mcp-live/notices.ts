// MCP の知らせ（`appdata/mcp-notice-*.json`）を 1 回さらって処理する純粋な関数。
// 知らせの中身で書き込みはしない（handle がストレージから読み直すだけ）。形式は format.ts

import { MCP_NOTICE_PREFIX, parseNotice, type McpLiveNotice } from "./format";

/** これより古い知らせは、処理に失敗し続けていても捨てる */
export const MCP_NOTICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 読めない（null の）知らせを、一時失敗かもしれないとして残す期間 */
export const MCP_NOTICE_NULL_GRACE_MS = 2 * 60 * 1000;

/** makeNoticeKey のキーから時刻（ms）を取り出す。取り出せなければ null */
export function noticeKeyTime(key: string): number | null {
  const m = /^mcp-notice-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-/.exec(key);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`);
  return Number.isNaN(t) ? null : t;
}

/** drainMcpNotices が使うストレージの口（asMaintenanceStorage の戻り値がそのまま入る） */
export type McpNoticeStorage = {
  readAppData(key: string): Promise<unknown | null>;
  listAppDataKeys(prefix: string): Promise<string[]>;
  deleteAppData(key: string): Promise<void>;
};

/**
 * 知らせを昇順（時刻順）に 1 件ずつ読み、handle で処理する。
 * ・形が違う・時刻が未来すぎる・読めない知らせは捨てる
 * ・handle が成功したら消す。例外なら消さずに次へ（次回に再試行）。ただし 24 時間より古ければ消す
 * 戻り値は処理した件数（handle が成功した件数）
 */
export async function drainMcpNotices(
  storage: McpNoticeStorage,
  handle: (notice: McpLiveNotice) => Promise<void>,
  now: () => number = Date.now,
): Promise<number> {
  const keys = (await storage.listAppDataKeys(MCP_NOTICE_PREFIX))
    .filter((k) => k.startsWith(MCP_NOTICE_PREFIX))
    .sort();
  let handled = 0;
  for (const key of keys) {
    let raw: unknown;
    try {
      raw = await storage.readAppData(key);
    } catch (e) {
      console.warn("[mcp-live] 知らせを読めませんでした:", key, e);
      continue;
    }
    // null は「壊れた JSON」「もう無い」だけでなく I/O の一時失敗でも返る。新しいキーはすぐ消さず
    // 次回に読み直す。2 分より古いもの（と、時刻を取り出せないキー）だけ消す
    // （残し続けて 10 秒ごとに読まれるのを防ぐ。もう無いキーを消しても害は無い）
    if (raw === null || raw === undefined) {
      const keyAt = noticeKeyTime(key);
      if (keyAt === null || now() - keyAt > MCP_NOTICE_NULL_GRACE_MS) await removeQuietly(storage, key);
      continue;
    }
    // 未来すぎる時刻の知らせは null（捨てる）
    const notice = parseNotice(raw, now());
    if (!notice) {
      await removeQuietly(storage, key);
      continue;
    }
    try {
      await handle(notice);
    } catch (e) {
      console.warn("[mcp-live] 知らせの処理に失敗（次回に再試行）:", key, e);
      if (now() - Date.parse(notice.at) > MCP_NOTICE_MAX_AGE_MS) await removeQuietly(storage, key);
      continue;
    }
    handled++;
    await removeQuietly(storage, key);
  }
  return handled;
}

async function removeQuietly(storage: McpNoticeStorage, key: string): Promise<void> {
  try {
    await storage.deleteAppData(key);
  } catch (e) {
    console.warn("[mcp-live] 知らせを消せませんでした:", key, e);
  }
}

/** 読み込みの失敗を再試行する期間（これを過ぎた知らせは、読めないページを諦めて進む） */
export const MCP_NOTICE_RETRY_WINDOW_MS = 2 * 60 * 1000;

/**
 * メモの逆リンクを持つ知らせは、メモの索引を読み終えてから処理する。読み込み前に記録すると、
 * 空の索引へ変換をかけて保存し、既存のメモを消してしまう。未読込なら例外を投げて知らせを残す
 * （次回に再試行）。ページの読み直しやトーストの前に呼ぶ
 */
export function requireMemoIndexLoaded(notice: McpLiveNotice, isLoaded: () => boolean): void {
  if (notice.memoBacklinks && !isLoaded()) throw new Error("memo index is not loaded yet");
}

/**
 * 読めなかったページがあるとき、知らせを残して再試行するか。知らせの時刻から 2 分以内なら再試行し、
 * 過ぎたら諦める（取り消されてもう無いページを読み直し続けない）
 */
export function shouldRetryFailedPages(
  notice: McpLiveNotice,
  failedCount: number,
  now: number = Date.now(),
): boolean {
  return failedCount > 0 && now - Date.parse(notice.at) <= MCP_NOTICE_RETRY_WINDOW_MS;
}

/**
 * メモの逆リンクを記録する。索引にそのメモが無いときは何も書かない（読み込みに失敗した空の索引で
 * メモの一覧を上書きしないため。メモが消えているときも同じ）。記録したら true
 */
export async function recordMemoBacklinks(
  backlinks: NonNullable<McpLiveNotice["memoBacklinks"]>,
  hasCapture: (captureId: string) => boolean,
  record: (captureId: string, noteId: string, title: string) => Promise<unknown>,
): Promise<boolean> {
  if (!hasCapture(backlinks.captureId)) return false;
  for (const p of backlinks.pages) {
    await record(backlinks.captureId, `wiki:${p.wikiId}`, p.title);
  }
  return true;
}
