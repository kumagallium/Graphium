// 外の AI が何に触れたかの記録。全体グラフの画面（show_knowledge_graph）が、画面専用の道具
// graph_activity で数秒おきに読み、読んだページ・たどった線・書いたページをグラフの上で光らせる
// （アプリのチャットの横の全体グラフと同じ考え方）。
//
// 記録は appdata の追記式ファイル（mcp-activity.jsonl）に書く。Claude Desktop では、モデルからの
// 道具の呼び出しと画面からの呼び出しが別の MCP プロセスに届くことがある（2026-11-19 の実機で、
// 画面の HTML を読んだプロセスのログに道具の呼び出しが 1 件も無かった）。メモリに持つと、画面が
// 問い合わせるプロセスには記録が無い。ファイルなら、どのプロセスからも読める。
// その代わり、同時に開いている別の会話の分も混ざる。画面は「開いた少し前から後」だけを光らせる。
//
// 光らせるのは実際に触れたときだけ（推測で光らせない）:
//   - read  : get_note / get_topic / show_note / get_source_text で本文を読んだ
//   - seen  : search_notes などの結果に出た（本文はまだ読んでいない。画面は印を付けない）
//   - walk  : trace_lineage がたどった線（from → id）
//   - wrote : create_note / submit_procedure / submit_topic_page などで作った・書き直した

import { appendFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export type ActivityKind = "read" | "seen" | "walk" | "wrote";

export type ActivityEvent = {
  kind: ActivityKind;
  /** 触れたページ・資料の id（ノート id / ナレッジのページ id / pdf:… などの資料 id） */
  id: string;
  /** walk のときの線の手前側 */
  from?: string;
  at: string;
};

export type ActivityLog = {
  push(kind: ActivityKind, id: string, from?: string): void;
  /**
   * cursor（前回の返事の cursor。初回は 0）より後の出来事を古い順に返す。
   * notBefore（ISO）を渡すと、それより前の出来事は返さない（別の会話の古い記録を光らせないため）
   */
  since(cursor: number, opts?: { limit?: number; notBefore?: string }): { events: ActivityEvent[]; cursor: number };
};

/** ファイルがこれより大きくなったら、ひとつ前の世代（.1）に回して空から書き直す */
export const ACTIVITY_FILE_MAX_BYTES = 1024 * 1024;
/** 1 回の返事で返す件数の上限 */
const DEFAULT_LIMIT = 500;

export function activityFilePath(appDataDir: string): string {
  return join(appDataDir, "mcp-activity.jsonl");
}

function parseLines(text: string): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ActivityEvent;
      if (e && typeof e.id === "string" && typeof e.kind === "string" && typeof e.at === "string") out.push(e);
    } catch {
      // 書きかけの行・壊れた行は飛ばす
    }
  }
  return out;
}

/**
 * appdata のファイルに書く記録。dir は呼ぶたびに解決する（vault の場所が後から決まることがあるため）。
 * cursor はファイルの中のバイト位置。世代が回って cursor がファイルより大きくなったら、頭から読み直す
 */
export function createFileActivityLog(dir: () => string): ActivityLog {
  return {
    push(kind, id, from) {
      if (!id) return;
      try {
        const path = activityFilePath(dir());
        mkdirSync(dirname(path), { recursive: true });
        if (existsSync(path) && statSync(path).size > ACTIVITY_FILE_MAX_BYTES) renameSync(path, `${path}.1`);
        const event: ActivityEvent = { kind, id, ...(from ? { from } : {}), at: new Date().toISOString() };
        // 1 行は小さい（数百バイト）ので、追記はプロセスどうしで混ざらない
        appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
      } catch {
        // 記録に失敗しても道具の応答は壊さない
      }
    },
    since(cursor, opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const path = activityFilePath(dir());
      if (!existsSync(path)) return { events: [], cursor: 0 };
      let size: number;
      try {
        size = statSync(path).size;
      } catch {
        return { events: [], cursor };
      }
      const start = cursor > size ? 0 : Math.max(0, cursor);
      if (start === size) return { events: [], cursor: size };
      const buf = Buffer.alloc(size - start);
      const fd = openSync(path, "r");
      try {
        readSync(fd, buf, 0, buf.length, start);
      } finally {
        closeSync(fd);
      }
      // 最後の改行までを読んだ分とする（書きかけの行は次の回に回す）
      const text = buf.toString("utf8");
      const lastNl = text.lastIndexOf("\n");
      if (lastNl < 0) return { events: [], cursor: start };
      const complete = text.slice(0, lastNl + 1);
      let events = parseLines(complete);
      if (opts.notBefore) events = events.filter((e) => e.at >= opts.notBefore!);
      return { events: events.slice(-limit), cursor: start + Buffer.byteLength(complete, "utf8") };
    },
  };
}

/** メモリだけの記録（テスト用）。cursor は件数 */
export function createActivityLog(capacity = 2000): ActivityLog & { readonly size: number } {
  const events: ActivityEvent[] = [];
  let total = 0;
  return {
    push(kind, id, from) {
      if (!id) return;
      events.push({ kind, id, ...(from ? { from } : {}), at: new Date().toISOString() });
      total += 1;
      if (events.length > capacity) events.splice(0, events.length - capacity);
    },
    since(cursor, opts = {}) {
      const dropped = total - events.length;
      let out = events.slice(Math.max(0, cursor - dropped));
      if (opts.notBefore) out = out.filter((e) => e.at >= opts.notBefore!);
      return { events: out.slice(-(opts.limit ?? DEFAULT_LIMIT)), cursor: total };
    },
    get size() {
      return events.length;
    },
  };
}
