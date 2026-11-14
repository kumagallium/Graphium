// この MCP プロセスの中で、外の AI が何に触れたかの記録（メモリの中だけ。ファイルには書かない）。
//
// 全体グラフの画面（show_knowledge_graph）が、画面専用の道具 graph_activity で数秒おきに読み、
// 読んだページ・たどった線・書いたページをグラフの上で光らせる（アプリのチャットの横の全体グラフと同じ考え方）。
// ホスト（Claude Desktop など）は 1 つの接続につき 1 つの MCP プロセスを起動し、画面からの道具の呼び出しも
// 同じプロセスに届くので、プロセスの中に持てば足りる。永続の記録は usage-recorder（appdata）が別に持つ。
//
// 光らせるのは実際に触れたときだけ（推測で光らせない）:
//   - read  : get_note / get_topic / show_note / get_source_text で本文を読んだ
//   - seen  : search_notes などの結果に出た（本文はまだ読んでいない）
//   - walk  : trace_lineage がたどった線（from → id）
//   - wrote : create_note / submit_procedure / submit_topic_page などで作った・書き直した

export type ActivityKind = "read" | "seen" | "walk" | "wrote";

export type ActivityEvent = {
  /** 通し番号（1 始まり。画面は最後に受け取った番号を since に渡す） */
  seq: number;
  kind: ActivityKind;
  /** 触れたページ・資料の id（ノート id / ナレッジのページ id / pdf:… などの資料 id） */
  id: string;
  /** walk のときの線の手前側 */
  from?: string;
  at: string;
};

export type ActivityLog = {
  push(kind: ActivityKind, id: string, from?: string): void;
  /** since より後の出来事（最大 limit 件、古い順）と、次に渡す番号 */
  since(since: number, limit?: number): { events: ActivityEvent[]; cursor: number };
  /** テスト用 */
  readonly size: number;
};

/** 持っておく出来事の上限（古いものから捨てる） */
export const ACTIVITY_CAPACITY = 2000;

export function createActivityLog(capacity = ACTIVITY_CAPACITY): ActivityLog {
  const events: ActivityEvent[] = [];
  let seq = 0;
  return {
    push(kind, id, from) {
      if (!id) return;
      seq += 1;
      events.push({ seq, kind, id, ...(from ? { from } : {}), at: new Date().toISOString() });
      if (events.length > capacity) events.splice(0, events.length - capacity);
    },
    since(since, limit = 500) {
      const out = events.filter((e) => e.seq > since).slice(0, limit);
      return { events: out, cursor: out.length > 0 ? out[out.length - 1].seq : Math.max(since, 0) };
    },
    get size() {
      return events.length;
    },
  };
}
