// 「AI との会話」の素材 — 読み取り役・素材・ナレッジ化の 3 段が受け渡す共通の形。
//
// 入口（Claude Code・ほかの AI ツール・書き出しファイル）が増えても、変わるのは
// 読み取り役（このフォルダの `*-reader.ts`）だけにする。素材の保存・出典の解決・
// 知見の指示は、ここの形だけを見る。
//
// 不変条件:
//   - 本人の発言（speaker: "user"）の text は原文のまま。言い換え・要約・空白の詰め直しをしない
//   - AI の返答は抜粋だけ。道具の呼び出しと出力は入れない（秘密の値が混じる）
//   - 同じ provider と sessionId の会話は 1 件（取り込み直したら差し替える）
//
// このフォルダは lib 層なので、features / server には依存しない（サーバーと MCP からも読む）。

/** 会話の出どころ。入口を足すたびに増える */
export type ConversationProvider = "claude-code";

/** 画面や本文に出す、出どころの呼び名 */
export const CONVERSATION_PROVIDER_LABEL: Record<ConversationProvider, string> = {
  "claude-code": "Claude Code",
};

export type ConversationTurn = {
  speaker: "user" | "assistant";
  /** ISO 8601。記録に時刻が無ければ "" */
  at: string;
  /** user は全文（原文のまま）。assistant は抜粋 */
  text: string;
  /** assistant: 途中を省いた抜粋であることの印（短い返答は全文なので付かない） */
  excerpt?: true;
  /** user: スラッシュコマンドで始めた発言のコマンド名（"/review" など）。text は引数の原文 */
  command?: string;
  /**
   * user: 会話の始まりに置かれた長い文。
   *
   * 別の会話（AI）が書いた依頼文も、記録の上では人の発言と同じ形で残る。構造からは
   * 見分けられないので、捨てずに残し、「本人の発言」とは別の扱いにする
   * （本文では別の見出しで出し、ownChars には数えない）。
   */
  brief?: true;
};

export type ConversationMaterial = {
  provider: ConversationProvider;
  /** 重複を見分ける鍵（provider と組で一意） */
  sessionId: string;
  /** 会話を始めた作業フォルダ（記録に無ければ ""） */
  workdir: string;
  /** ISO 8601（記録に時刻が 1 つも無ければ ""） */
  startedAt: string;
  endedAt: string;
  turns: ConversationTurn[];
  /** 本人の発言の字数の合計（brief は数えない）。ナレッジ化の候補の絞り込みに使う */
  ownChars: number;
};

/** AI の返答の抜粋: この長さまでは全文、超えたら冒頭と末尾だけを残す */
export const ASSISTANT_EXCERPT_WHOLE_MAX = 520;
export const ASSISTANT_EXCERPT_HEAD = 200;
export const ASSISTANT_EXCERPT_TAIL = 300;
/** 抜粋で省いた箇所の印 */
export const ASSISTANT_EXCERPT_GAP = " […] ";

/** 会話の始まりの発言がこの字数を超えたら、書き手の分からない依頼文として扱う */
export const OPENING_BRIEF_MIN_CHARS = 700;

/** ナレッジ化の候補にする目安（本人の発言の字数の合計） */
export const CONVERSATION_CANDIDATE_MIN_OWN_CHARS = 300;

/** sessionId として受け付ける形（ファイル名と素材 id に組み込むため、英数字・ハイフン・下線だけ） */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export function isValidConversationSessionId(sessionId: string): boolean {
  return SESSION_ID_RE.test(sessionId);
}

/** 素材 id の接頭辞。出典 id は `conversation:<素材 id>` */
const FILE_ID_PREFIX = "conv-";
export const CONVERSATION_SOURCE_PREFIX = "conversation:";

const PROVIDERS: readonly ConversationProvider[] = ["claude-code"];

/**
 * 会話の素材 id。provider と sessionId から一意に決まる（取り込み直しても同じ id になり、
 * 二重に作らない）。sessionId が受け付ける形でなければ null。
 */
export function conversationFileId(provider: ConversationProvider, sessionId: string): string | null {
  if (!isValidConversationSessionId(sessionId)) return null;
  return `${FILE_ID_PREFIX}${provider}-${sessionId}`;
}

/** 素材 id から provider と sessionId を取り出す。会話の素材 id でなければ null */
export function parseConversationFileId(
  fileId: string,
): { provider: ConversationProvider; sessionId: string } | null {
  if (!fileId.startsWith(FILE_ID_PREFIX)) return null;
  const rest = fileId.slice(FILE_ID_PREFIX.length);
  for (const provider of PROVIDERS) {
    if (!rest.startsWith(`${provider}-`)) continue;
    const sessionId = rest.slice(provider.length + 1);
    if (isValidConversationSessionId(sessionId)) return { provider, sessionId };
  }
  return null;
}

/** 出典 id（知見・トピックが `[[source:conversation:…|一節]]` で引く形） */
export function conversationSourceId(fileId: string): string {
  return `${CONVERSATION_SOURCE_PREFIX}${fileId}`;
}

/**
 * ナレッジ化の費用の見込み: 会話 1 本の知見の作成に、測定でおよそ 7〜9 万トークンかかった
 * （2026-11-18）。トピックの作成は含まない。
 */
export const CONVERSATION_INGEST_TOKENS_PER_SESSION = { low: 70_000, high: 90_000 } as const;

/** 候補の本数から、知見の作成にかかるトークン数の幅を見積もる（掛けるだけ） */
export function estimateConversationIngestTokens(candidates: number): { low: number; high: number } {
  return {
    low: candidates * CONVERSATION_INGEST_TOKENS_PER_SESSION.low,
    high: candidates * CONVERSATION_INGEST_TOKENS_PER_SESSION.high,
  };
}
