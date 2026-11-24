// 起動中のアプリと MCP のあいだでやり取りする 2 つのファイルの形式。
// React にも Node にも依存しない（アプリと src/mcp の両方から import する）。
//
// ・`appdata/app-open-pages.json`（アプリ → MCP）: いまエディタで開いているナレッジのページ。
//   MCP は、起動中のアプリが開いているページを書き換えない（未保存の編集と衝突するため）。
//   このファイルが「今回の起動より後に書かれている」ことを、アプリが知らせを受け取れる版である印にも使う
// ・`appdata/mcp-notice-<時刻>-<id>.json`（MCP → アプリ）: MCP がファイルへ直接書いたページの知らせ。
//   アプリは受け取ったらストレージから読み直すだけ（知らせの中身で書き込みはしない）

export const MCP_LIVE_FORMAT_VERSION = 1 as const;

/** アプリが開いているページの一覧の appData キー */
export const OPEN_PAGES_KEY = "app-open-pages";
/** MCP の知らせの appData キーの接頭辞 */
export const MCP_NOTICE_PREFIX = "mcp-notice-";

/** 1 つの知らせに載せるページ数の上限（壊れた・細工された知らせで全ページを読み直させない） */
export const MCP_NOTICE_MAX_PAGES = 200;

export type AppOpenPages = {
  formatVersion: typeof MCP_LIVE_FORMAT_VERSION;
  /** 書いた時刻（ISO 8601）。ハートビートの startedAt 以降なら、今回の起動で書かれたもの */
  at: string;
  /** エディタ（メイン・サイドピーク・別ウィンドウ）で開いているナレッジのページの id（`wiki:` は付けない） */
  wikiIds: string[];
  /**
   * アプリの中でナレッジを書き換える処理（取り込み・手入れなど）が動いているか。
   * true の間、MCP は既存のページを書き換えない（同じページを両方が読んで書くと、片方の更新が消える）。
   * 新しいページの作成は止めない
   */
  busy?: boolean;
};

export type McpNoticePage = {
  wikiId: string;
  title: string;
  /** この操作で新しく作ったページか（false は既存ページの書き換え） */
  created: boolean;
};

export type McpLiveNotice = {
  formatVersion: typeof MCP_LIVE_FORMAT_VERSION;
  at: string;
  /** MCP クライアントの名前（表示用） */
  client?: string;
  pages: McpNoticePage[];
  /** メモから作った知見の逆リンク（アプリがメモの索引に記録する） */
  memoBacklinks?: { captureId: string; pages: { wikiId: string; title: string }[] };
};

/** Windows でファイル名に使えない予約名（拡張子を付けても装置として開かれる） */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * ファイル名に使える id か。英数字・`_`・`-`・`.` だけ（区切り文字・親ディレクトリ・制御文字を含まない）で、
 * 先頭と末尾が `.` でなく、Windows の予約名でもないもの
 */
export function isSafePageId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 200 &&
    /^[A-Za-z0-9_.-]+$/.test(id) &&
    !id.includes("..") &&
    !id.startsWith(".") &&
    !id.endsWith(".") &&
    !WINDOWS_RESERVED.test(id)
  );
}

/** 時計のずれとして許す未来の幅（これより先の時刻の知らせ・一覧は受け取らない） */
export const MCP_LIVE_MAX_FUTURE_MS = 60_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isIsoTime(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

/** 知らせのキー。時刻順に並ぶ（同じ時刻は id で分かれる） */
export function makeNoticeKey(at: Date, id: string): string {
  const stamp = at.toISOString().replace(/[-:.]/g, "");
  return `${MCP_NOTICE_PREFIX}${stamp}-${id.replace(/[^A-Za-z0-9]/g, "")}`;
}

/** 開いているページの一覧を読む。形が違えば null（MCP は「受け取れないアプリ」として扱う） */
export function parseOpenPages(v: unknown): AppOpenPages | null {
  if (!isRecord(v) || v.formatVersion !== MCP_LIVE_FORMAT_VERSION) return null;
  if (!isIsoTime(v.at) || !Array.isArray(v.wikiIds)) return null;
  if (!v.wikiIds.every(isSafePageId)) return null;
  return {
    formatVersion: MCP_LIVE_FORMAT_VERSION,
    at: v.at,
    wikiIds: [...new Set(v.wikiIds)],
    // true 以外（無い・形が違う）は「動いていない」。古い形のファイルも読める
    ...(v.busy === true ? { busy: true } : {}),
  };
}

/**
 * 知らせを読む。形が違う・id が不正・件数が多すぎる・時刻が未来すぎるものは null（アプリは捨てる）。
 * now を渡すと、時刻が now より MCP_LIVE_MAX_FUTURE_MS を超えて先の知らせを断る（古くならず残り続けるのを防ぐ）
 */
export function parseNotice(v: unknown, now?: number): McpLiveNotice | null {
  if (!isRecord(v) || v.formatVersion !== MCP_LIVE_FORMAT_VERSION) return null;
  if (!isIsoTime(v.at) || !Array.isArray(v.pages) || v.pages.length > MCP_NOTICE_MAX_PAGES) return null;
  if (now !== undefined && Date.parse(v.at) - now > MCP_LIVE_MAX_FUTURE_MS) return null;
  const pages: McpNoticePage[] = [];
  for (const p of v.pages) {
    if (!isRecord(p) || !isSafePageId(p.wikiId) || typeof p.title !== "string") return null;
    pages.push({ wikiId: p.wikiId, title: p.title.slice(0, 500), created: p.created === true });
  }
  const notice: McpLiveNotice = { formatVersion: MCP_LIVE_FORMAT_VERSION, at: v.at, pages };
  if (typeof v.client === "string") notice.client = v.client.slice(0, 200);
  const mb = v.memoBacklinks;
  if (mb !== undefined) {
    if (!isRecord(mb) || !isSafePageId(mb.captureId) || !Array.isArray(mb.pages)) return null;
    if (mb.pages.length > MCP_NOTICE_MAX_PAGES) return null;
    const mbPages: { wikiId: string; title: string }[] = [];
    for (const p of mb.pages) {
      if (!isRecord(p) || !isSafePageId(p.wikiId) || typeof p.title !== "string") return null;
      mbPages.push({ wikiId: p.wikiId, title: p.title.slice(0, 500) });
    }
    notice.memoBacklinks = { captureId: mb.captureId, pages: mbPages };
  }
  return notice;
}
