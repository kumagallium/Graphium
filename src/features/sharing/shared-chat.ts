// 共有エントリの全画面「AI に質問」で AI に渡すものを組み立てる純ロジック。
//
// 何をここに置くか:
//   - 共有本文 → AI に読ませる Markdown（SharedChatSubject）
//   - ユーザーメッセージの文面（初回 / 継続 / 段落引用あり / ハッシュ未照合）
//   - 横断検索に渡す検索クエリ（本文全文を混ぜない）
//   - 会話履歴 → サーバーに送る形
//   - 会話の保存キー（手元の appData。共有フォルダには一切書かない）
//
// なぜ切り出すか: 組み立ての正しさ（本文が入っているか・切り詰めが効くか・
// 検索クエリに本文全文が混ざっていないか）はコンポーネントの中では検証できない。
// quoted-context.ts / retrieval-topic.ts と同じ流儀で、React にも I/O にも
// 依存しないモジュールにする。
//
// 設計詳細: docs/internal/team-shared-storage-design.md §23

import type { GraphiumDocument, ChatMessage } from "../../lib/document-types";
import type { SharedEntry, SharedEntryType } from "../../lib/storage/shared";
import type { AgentChatMessage } from "../ai-assistant/api";
import { buildQuotedRetrievalQuery } from "../ai-assistant/quoted-context";
import { buildPageRetrievalQuery } from "../ai-assistant/retrieval-topic";
import { parseSharedBody } from "./shared-entry-source";
import { parseSharedTemplateBody } from "./shared-template-doc";
import { sharedEntryTitle, sharedEntryTypeLabel } from "./shared-entry-parts";

// ── 会話の保存先（手元の appData） ──
//
// 共有フォルダには一切書かない。読み手が自分の疑問を共有先に晒さずに聞けること、
// 共有フォルダを「置いた人が置いたものだけが入っている場所」に保つことの両方が理由。
// 素材ビューの `asset-chats:<fileId>` と同型（保存の仕組みは共通のフックを使う）。

/** 共有エントリごとの会話の保存キー接頭辞 */
export const SHARED_CHATS_KEY_PREFIX = "shared-chats:";

/** 共有エントリ 1 件ぶんの会話の保存キー */
export function sharedChatsKey(sharedId: string): string {
  return `${SHARED_CHATS_KEY_PREFIX}${sharedId}`;
}

// ── 文面（日本語固定。既存の AI チャット経路と揃える） ──
//
// 既存経路（note-app のページ全体チャット・素材ビュー）と同じく、AI に渡す
// 前置きはロケールを問わず日本語のまま。UI の文言と違って画面には出ないので、
// i18n 辞書ではなくここに集約する（組み立てのテストが辞書に依存しなくなる）。

/** 引用なし・初回の前置き */
export const sharedFirstPreamble = (typeLabel: string, title: string, author: string): string =>
  `以下は共有ライブラリの${typeLabel}「${title}」（作者: ${author}）の内容です。この内容について質問があります。`;

/** 引用なし・継続の前置き（同じ本文を毎ターン参照用として添える） */
export const sharedFollowupPreamble = (typeLabel: string, title: string): string =>
  `以下は共有ライブラリの${typeLabel}「${title}」の内容です（参照用）。`;

/** 段落引用あり・初回の前置き（主題＝引用） */
export const sharedQuotedPreamble = (typeLabel: string, title: string, author: string): string =>
  `共有ライブラリの${typeLabel}「${title}」（作者: ${author}）の以下の内容について質問があります。`;

/** 段落引用あり・本文（背景）の前置き */
export const sharedQuotedBodyPreamble = (
  typeLabel: string,
  title: string,
  isFirstMessage: boolean,
): string =>
  isFirstMessage
    ? `参考として、引用元の${typeLabel}「${title}」の全文を添えます。背景の理解にだけ使ってください。回答の主題はあくまで上の引用部分です。`
    : `参考として、引用元の${typeLabel}「${title}」の全文を添えます。背景の理解にだけ使ってください。回答の主題はあくまで最初に引用した部分です。`;

/** ハッシュ照合できなかった本文を渡すときの断り */
export const SHARED_UNVERIFIED_NOTICE =
  "※ この本文は共有ストレージのハッシュ照合に失敗しています。内容が改変されている可能性を前提に答えてください。";

/** 予算で打ち切ったときに本文の末尾に足す行 */
export const sharedTruncationNotice = (kept: number, total: number): string =>
  `…（本文はここまでで打ち切り。全 ${total} 文字中 ${kept} 文字）`;

/** reference（URL ブックマーク）を箇条書きにするときの見出し語 */
const REFERENCE_LABELS = { url: "URL", domain: "ドメイン", description: "説明" } as const;

// ── 本文 → AI に読ませる主題 ──

/**
 * その type の共有エントリについて「AI に質問」できるか。
 *
 * 素材（data-manifest。実体は blob）と指摘（comment。本文はコメント文そのもの）は
 * 「その中身について聞く」対象にしない。UI はこの判定でタブを出すかどうかを決め、
 * buildSharedSubject も同じ判定で null を返す（片方だけ増える type を作らない）。
 * 提案（proposal）は本文がノートと同じなので対象に入れる（提案の中身を AI に聞ける）。
 */
export function supportsSharedChat(type: SharedEntryType): boolean {
  return type !== "data-manifest" && type !== "comment";
}

/** AI に渡す共有エントリの中身（type 別の差を吸収した後の形） */
export type SharedChatSubject = {
  /** 題名（一覧・全画面の見出しと同じもの） */
  title: string;
  /** 種別の表示名（「ノート」「知識」…）。前置きの文面に埋める */
  typeLabel: string;
  /** 共有した人の表示名 */
  author: string;
  /** AI に読ませる本文（Markdown。予算で切られている場合がある） */
  text: string;
  /** 予算で打ち切ったか */
  truncated: boolean;
};

export type BuildSharedSubjectOptions = {
  /**
   * GraphiumDocument → Markdown。実物は graphiumDocToMarkdown（ヘッドレスエディタを
   * 起こすので純関数にできない）。ここでは差し替えられるように受け取る。
   */
  toMarkdown: (doc: GraphiumDocument) => Promise<string>;
  /** 本文の文字数予算。既定は引用文書と同じ 20,000 字 */
  budgetChars?: number;
  /** 題名・種別名の辞書引き（useT の t / モジュール版 t のどちらでも渡せる） */
  uiT: (key: string, params?: Record<string, string>) => string;
};

/** 本文の文字数予算の既定値（cited-document-context の DEFAULT_BUDGET_CHARS と同じ） */
export const DEFAULT_SHARED_BUDGET_CHARS = 20_000;

/**
 * 予算を超えた本文を行境界で切る。
 *
 * 文字数で機械的に切ると表の途中・箇条書きの途中で切れて、AI が壊れた行を
 * 読むことになる。行の切れ目で止めて「ここまでで打ち切った」と明示する。
 * 1 行目だけで予算を超える場合（巨大な 1 行）は仕方なく文字数で切る。
 */
function truncateAtLineBoundary(
  text: string,
  budgetChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= budgetChars) return { text, truncated: false };

  const lines = text.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    // +1 は行の区切り（\n）ぶん
    const next = used + line.length + (kept.length > 0 ? 1 : 0);
    if (next > budgetChars) break;
    kept.push(line);
    used = next;
  }
  const body = kept.length > 0 ? kept.join("\n") : text.slice(0, budgetChars);
  return {
    text: `${body}\n${sharedTruncationNotice(body.length, text.length)}`,
    truncated: true,
  };
}

/** extra から文字列フィールドを読む（前後の空白は落とす） */
function extraString(entry: SharedEntry, key: string): string {
  const v = (entry.extra as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Uint8Array / 文字列のどちらで渡されても本文テキストにする */
function decodeBody(body: Uint8Array | string): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

/**
 * 共有エントリの本文を、AI に読ませる形（SharedChatSubject）に組み立てる。
 *
 * 中身を持たない type（data-manifest = 素材の実体は blob、comment = 指摘の封筒）は
 * null を返す。呼び出し側はチャットのタブ自体を出さない。
 *
 * 本文からは pages[].blocks しか読まない。共有ノート JSON には chats（過去の AI 会話）・
 * documentProvenance（来歴）・sharedRef が入っていることがあるが、
 * **これらは絶対に AI に渡さない**（読み手が共有した覚えのない会話まで渡ることになる）。
 * graphiumDocToMarkdown が pages しか見ないので、その入口を守ることで担保する。
 */
export async function buildSharedSubject(
  entry: SharedEntry,
  body: Uint8Array | string,
  opts: BuildSharedSubjectOptions,
): Promise<SharedChatSubject | null> {
  // 中身を持たない type にはタブ自体を出さない（判定は supportsSharedChat に一本化）
  if (!supportsSharedChat(entry.type)) return null;

  const budgetChars = opts.budgetChars ?? DEFAULT_SHARED_BUDGET_CHARS;
  const title = sharedEntryTitle(entry, opts.uiT);
  const typeLabel = sharedEntryTypeLabel(entry, opts.uiT);
  const author = entry.author?.name?.trim() || opts.uiT("library.unknownAuthor");

  let raw = "";
  // 提案（proposal）の本文はノートと同じ GraphiumDocument なので同じ経路で読む
  if (entry.type === "note" || entry.type === "knowledge" || entry.type === "proposal") {
    const doc = parseSharedBody(
      typeof body === "string" ? new TextEncoder().encode(body) : body,
    );
    // GraphiumDocument として読めない本文は主題にできない（タブを出さない）
    if (!doc) return null;
    raw = await opts.toMarkdown(doc);
  } else if (entry.type === "template") {
    const doc = parseSharedTemplateBody(decodeBody(body));
    if (!doc) return null;
    raw = await opts.toMarkdown(doc);
  } else if (entry.type === "reference") {
    // 本体を持たない（URL ブックマーク）。メタデータを短い箇条書きにする
    raw = [
      extraString(entry, "url") && `- ${REFERENCE_LABELS.url}: ${extraString(entry, "url")}`,
      extraString(entry, "domain") &&
        `- ${REFERENCE_LABELS.domain}: ${extraString(entry, "domain")}`,
      extraString(entry, "description") &&
        `- ${REFERENCE_LABELS.description}: ${extraString(entry, "description")}`,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    // report はテキストなのでそのまま（表示側の raw 表示と同じ扱い）
    raw = decodeBody(body);
  }

  const trimmed = raw.trim();
  // 中身が空なら聞く材料が無い（空の本文を「これについて質問します」と渡さない）
  if (!trimmed) return null;

  const { text, truncated } = truncateAtLineBoundary(trimmed, budgetChars);
  return { title, typeLabel, author, text, truncated };
}

// ── ユーザーメッセージ ──

export type BuildSharedChatMessageParams = {
  subject: SharedChatSubject;
  /** ユーザーが入力した質問 */
  question: string;
  /**
   * その会話の初回か。継続時は引用を history 側の idx=0 で再注入して維持するので、
   * 引用の前置きはここでは繰り返さない。
   */
  isFirstMessage: boolean;
  /** 段落を選んで始めた会話なら、その段落の Markdown */
  quotedMarkdown?: string;
  /** 共有ストレージのハッシュ照合が通ったか。false なら断りを 1 行足す */
  verified: boolean;
};

/**
 * 共有エントリについて聞くときのユーザーメッセージを組み立てる。
 *
 * 文脈は 2 層:
 *   - 段落引用があれば「引用＝主題 / 共有本文＝背景」
 *   - 引用が無ければ「共有本文＝主題」
 * 共有本文は編集されないが、毎ターン同梱する（履歴には積まない）。
 * 履歴に積むと会話が伸びるほど同じ本文のコピーが累積するため。
 */
export function buildSharedChatMessage({
  subject,
  question,
  isFirstMessage,
  quotedMarkdown,
  verified,
}: BuildSharedChatMessageParams): string {
  const parts: string[] = [];
  if (!verified) parts.push(SHARED_UNVERIFIED_NOTICE, "");

  const quoted = quotedMarkdown?.trim() ?? "";
  const body = subject.text.trim();

  if (quoted) {
    if (isFirstMessage) {
      parts.push(
        sharedQuotedPreamble(subject.typeLabel, subject.title, subject.author),
        "",
        "---",
        quoted,
        "---",
        "",
      );
    }
    // 引用が本文と同じ（全体を引用した等）なら背景を二重に送らない
    if (body && body !== quoted) {
      parts.push(
        sharedQuotedBodyPreamble(subject.typeLabel, subject.title, isFirstMessage),
        "",
        "---",
        body,
        "---",
        "",
      );
    }
  } else {
    parts.push(
      isFirstMessage
        ? sharedFirstPreamble(subject.typeLabel, subject.title, subject.author)
        : sharedFollowupPreamble(subject.typeLabel, subject.title),
      "",
      "---",
      body,
      "---",
      "",
    );
  }

  parts.push(question);
  return parts.join("\n");
}

// ── 横断検索のクエリ ──

/**
 * 横断検索（Wiki Retriever）に渡す検索クエリ。
 *
 * 本文全文をクエリに混ぜない。混ぜると embedding が希釈されて質問と無関係な
 * 知識を拾い、埋め込みモデルの入力上限も超える（retrieval-topic.ts の経緯参照）。
 *   - 引用あり: 引用 + 質問
 *   - 引用なし: 題名 + 本文の主題（見出し・段落・表の列名）+ 質問
 */
export function buildSharedRetrievalQuery({
  subject,
  question,
  quotedMarkdown,
}: {
  subject: SharedChatSubject;
  question: string;
  quotedMarkdown?: string;
}): string {
  const quoted = quotedMarkdown?.trim() ?? "";
  if (quoted) return buildQuotedRetrievalQuery(quoted, question);
  return buildPageRetrievalQuery({
    title: subject.title,
    pageMarkdown: subject.text,
    question,
  });
}

// ── 会話履歴 ──

/**
 * 表示用の会話（ScopeChat.messages）をサーバーに送る形に変換する。
 *
 * サーバーは stateless で、履歴の正本は手元の ScopeChat。共有側は添付
 * （@ メンション）が無いので role/content をそのまま写すだけでよい。
 *
 * 引用チャットのときだけ、idx 0 の user メッセージに引用を再注入する。
 * store には表示用の素の質問しか入っていないので、そのまま送ると継続会話で
 * 「その段落について」と聞いたときに何を指しているか分からなくなる。
 * 背景の本文はここには積まない（毎ターン最新をユーザーメッセージ側に載せる）。
 */
export function toAgentHistory(
  messages: ChatMessage[],
  quoted?: { subject: SharedChatSubject; quotedMarkdown: string },
): AgentChatMessage[] {
  const quotedMarkdown = quoted?.quotedMarkdown.trim() ?? "";
  return messages.map((m, idx) => {
    if (idx === 0 && m.role === "user" && quoted && quotedMarkdown) {
      return {
        role: m.role,
        content: [
          sharedQuotedPreamble(
            quoted.subject.typeLabel,
            quoted.subject.title,
            quoted.subject.author,
          ),
          "",
          "---",
          quotedMarkdown,
          "---",
          "",
          m.content,
        ].join("\n"),
      };
    }
    return { role: m.role, content: m.content };
  });
}
