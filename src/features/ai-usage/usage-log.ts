// AI に使われたページの記録（アプリと MCP の両方が書く・ブラウザ API に依存しない）。
//
// 何のためか: AI の回答に引用されたページ・外の AI（MCP）に読まれたページを数え、
// 「よく一緒に使われるのにリンクの無い組み合わせ」「よく使われるのに裏付けが薄い知見」
// 「長く使われていない島」を見つける材料にする。表示はまだ無い（記録だけ先に貯める）。
//
// 置き場所: 保管庫の appdata/<key>.json。key は `ai-usage-<YYYYMMDD>-<writer>-<session>`。
// 書き手（アプリ / MCP）とセッション（ページの読み込み・MCP のプロセス）ごとに別ファイル
// にするので、2 つのプロセスが同じファイルを同時に書くことは起きない。
//
// 残すのは「いつ・何が・どう使われたか」だけ。質問文・回答の本文・ページの本文は残さない。
// 端末（保管庫）の中にだけ置き、どこにも送らない。

/** 記録ファイルの形の版。形を変えたら上げる */
export const AI_USAGE_FORMAT_VERSION = 1;

/** appData のキーの頭（listAppDataKeys の prefix にそのまま渡せる） */
export const AI_USAGE_KEY_PREFIX = "ai-usage-";

/** 1 ファイルに積む件数の上限。暴走しても 1 ファイルが膨らみ続けないように */
export const AI_USAGE_MAX_EVENTS_PER_FILE = 5000;

export type AiUsageWriter = "app" | "mcp";

/**
 * 使われ方。
 * - cite: アプリの AI チャットの回答に引用された（回答末尾の「ノート内の知識」に載ったもの）
 * - read: 外の AI が MCP でページを開いた（get_note / get_topic）。検索結果に出ただけでは数えない
 */
export type AiUsageKind = "cite" | "read";

/** 参照先の種類。retriever の参照（wiki id そのまま / note: / asset: / shared:）に揃える */
export type AiUsageRefKind = "wiki" | "note" | "asset" | "shared";

export type AiUsageEvent = {
  /** ISO 8601（UTC） */
  t: string;
  ev: AiUsageKind;
  /** `<kind>:<id>`（例: `wiki:0015c6f8-…`、`note:…`） */
  ref: string;
  /**
   * まとまりの ID。同じ値の event は「一緒に使われた」とみなす。
   * アプリ: 1 回の回答ごとに振る。MCP: 1 プロセスで同じ値（集計側で時間の近さで区切る）
   */
  g: string;
};

export type AiUsageFile = {
  version: number;
  writer: AiUsageWriter;
  session: string;
  /** MCP クライアント名（claude-desktop / claude-code など）。分かるときだけ */
  client?: string;
  events: AiUsageEvent[];
};

/** UTC の日付を YYYYMMDD で返す */
export function usageDateStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** セッション ID に使える形（appData のキーに使える文字だけ・長すぎない）にならす */
export function sanitizeSessionId(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  return s || "x";
}

/** 記録ファイルのキー。appData のキーの制約（^[A-Za-z0-9_-]{1,200}$）を満たす */
export function usageKey(date: Date, writer: AiUsageWriter, session: string): string {
  return `${AI_USAGE_KEY_PREFIX}${usageDateStamp(date)}-${writer}-${sanitizeSessionId(session)}`;
}

/** 新しいセッション ID（12 文字の英数字） */
export function newUsageSessionId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

/**
 * retriever の参照（`getSourceTitleToRefMap()` の値）を記録用の ref に直す。
 * Wiki はプレフィックス無しの id、ノート・素材・共有はプレフィックス付きで来る。
 */
export function toUsageRef(retrieverRef: string): string | null {
  const ref = retrieverRef.trim();
  if (!ref) return null;
  const m = /^(note|asset|shared):(.+)$/.exec(ref);
  if (m) return m[2] ? `${m[1]}:${m[2]}` : null;
  if (ref.includes(":")) return null;
  return `wiki:${ref}`;
}

/**
 * 回答が引用した題名を、記録用の ref に直す（引けない題名は落とす・重複は 1 つに）。
 * titleToRef は retriever の getSourceTitleToRefMap() の戻り値。
 */
export function refsFromCitedTitles(
  titles: readonly string[],
  titleToRef: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const title of titles) {
    const raw = titleToRef.get(title);
    if (!raw) continue;
    const ref = toUsageRef(raw);
    if (ref && !out.includes(ref)) out.push(ref);
  }
  return out;
}

/** 読み込んだ値が記録ファイルとして使えるか（壊れていたら作り直す） */
export function isAiUsageFile(v: unknown): v is AiUsageFile {
  if (!v || typeof v !== "object") return false;
  const f = v as Partial<AiUsageFile>;
  return (
    typeof f.version === "number" &&
    (f.writer === "app" || f.writer === "mcp") &&
    typeof f.session === "string" &&
    Array.isArray(f.events)
  );
}

/**
 * 既存の記録に event を足した新しい記録を返す（純粋関数）。
 * 既存が無い・壊れている・別の書き手のものなら作り直す。上限を超えた分は古い方から捨てる。
 */
export function appendUsageEvents(
  existing: unknown,
  events: readonly AiUsageEvent[],
  meta: { writer: AiUsageWriter; session: string; client?: string },
): AiUsageFile {
  const base: AiUsageFile =
    isAiUsageFile(existing) && existing.writer === meta.writer && existing.session === meta.session
      ? existing
      : { version: AI_USAGE_FORMAT_VERSION, writer: meta.writer, session: meta.session, events: [] };
  const client = meta.client ?? base.client;
  const all = [...base.events, ...events];
  return {
    version: AI_USAGE_FORMAT_VERSION,
    writer: meta.writer,
    session: meta.session,
    ...(client ? { client } : {}),
    events: all.length > AI_USAGE_MAX_EVENTS_PER_FILE ? all.slice(all.length - AI_USAGE_MAX_EVENTS_PER_FILE) : all,
  };
}

/** ref の配列から、同じまとまり・同じ時刻の event を作る */
export function buildUsageEvents(
  refs: readonly string[],
  ev: AiUsageKind,
  group: string,
  at: Date,
): AiUsageEvent[] {
  const t = at.toISOString();
  return refs.map((ref) => ({ t, ev, ref, g: group }));
}
