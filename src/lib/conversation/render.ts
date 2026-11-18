// 会話の素材の本文（保存する文字列）と、一覧に出す題・フォルダ・集計を作る。
//
// 本文は、知見やトピックが引く一節を照らし合わせる相手になる。保存したあとは変えない
// （取り込み直したときだけ差し替わる）。本人の発言は原文のまま入れる — 改行も詰めない。
// ただし 2 行目以降は 2 字下げる。発言の中に「- AI（…）: …」や「## 日付」の形の行が
// あっても（貼り付けた文など）、別の発言や見出しとして読まれないようにするため。

import {
  ASSISTANT_EXCERPT_HEAD,
  ASSISTANT_EXCERPT_TAIL,
  CONVERSATION_CANDIDATE_MIN_OWN_CHARS,
  CONVERSATION_PROVIDER_LABEL,
  type ConversationMaterial,
  type ConversationProvider,
} from "./types";

export type ConversationBodyLang = "ja" | "en";

export type RenderConversationOptions = {
  /** 本文の見出しの言語（既定は ja） */
  lang?: ConversationBodyLang;
  /**
   * 日付と時刻を出すときの、UTC からのずれ（分。日本なら 540）。
   * 省くと実行している端末の時刻帯を使う。テストでは固定値を渡す。
   */
  utcOffsetMinutes?: number;
};

type Labels = {
  header: (provider: string) => string;
  briefNote: string;
  me: string;
  ai: string;
  aiExcerpt: string;
  brief: string;
  open: string;
  close: string;
  sep: string;
  colon: string;
};

const LABELS: Record<ConversationBodyLang, Labels> = {
  ja: {
    header: (provider) =>
      `この資料は、私（利用者）と AI（${provider}）の会話の記録である。「私」の行は私が書いた原文そのまま（複数行の発言は、2 行目以降を字下げしてある）。` +
      `「AI」の行は、その直後の私の発言の前に AI が書いた返答で、長いものは抜粋（冒頭 ${ASSISTANT_EXCERPT_HEAD} 字と末尾 ${ASSISTANT_EXCERPT_TAIL} 字）である。`,
    briefNote:
      "「依頼文」の行は、会話の始まりに置かれた長い文の原文である。私が打ったものか、別の会話が書いた依頼かは、記録からは見分けられない。",
    me: "私",
    ai: "AI（直前の返答）",
    aiExcerpt: "AI（直前の返答の抜粋）",
    brief: "依頼文",
    open: "（",
    close: "）",
    sep: "、",
    colon: ": ",
  },
  en: {
    header: (provider) =>
      `This is a record of a conversation between me (the user) and an AI (${provider}). Lines marked "Me" are what I wrote, verbatim (later lines of a multi-line message are indented). ` +
      `Lines marked "AI" are the reply the AI wrote just before my next line; long replies are excerpts (the first ${ASSISTANT_EXCERPT_HEAD} and the last ${ASSISTANT_EXCERPT_TAIL} characters).`,
    briefNote:
      'Lines marked "Brief" are the verbatim text of a long message placed at the start of the conversation. The record does not tell whether I typed it or another conversation wrote it as a request.',
    me: "Me",
    ai: "AI (previous reply)",
    aiExcerpt: "AI (excerpt of the previous reply)",
    brief: "Brief",
    open: " (",
    close: ")",
    sep: ", ",
    colon: ": ",
  },
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 複数行の文の 2 行目以降を字下げする（文字は変えない） */
function indentContinuation(text: string): string {
  return text.replace(/\r?\n|\r|\u2028|\u2029/g, (nl) => `${nl}  `);
}

/** ISO の時刻を、指定のずれ（無ければ端末の時刻帯）での日付と時分にする */
function localParts(iso: string, utcOffsetMinutes?: number): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const offset = utcOffsetMinutes ?? -new Date(ms).getTimezoneOffset();
  const d = new Date(ms + offset * 60_000);
  return {
    date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  };
}

/**
 * 素材の本文を組み立てる。
 *
 * ```
 * （資料の説明）
 *
 * ## 2026-11-03
 *
 * - AI（直前の返答の抜粋）: …
 * - 私（06:28）: …
 * ```
 */
export function renderConversationBody(
  material: ConversationMaterial,
  options: RenderConversationOptions = {},
): string {
  const L = LABELS[options.lang ?? "ja"];
  const provider = CONVERSATION_PROVIDER_LABEL[material.provider];
  const out: string[] = [L.header(provider)];
  if (material.turns.some((t) => t.brief)) out.push(L.briefNote);
  out.push("");
  let day = "";
  for (const turn of material.turns) {
    const parts = turn.at ? localParts(turn.at, options.utcOffsetMinutes) : null;
    if (parts && parts.date !== day) {
      day = parts.date;
      out.push(`## ${day}`, "");
    }
    if (turn.speaker === "assistant") {
      out.push(`- ${turn.excerpt ? L.aiExcerpt : L.ai}${L.colon}${turn.text}`);
      continue;
    }
    const notes = [parts?.time, turn.command].filter((v): v is string => !!v);
    const who = turn.brief ? L.brief : L.me;
    const paren = notes.length > 0 ? `${L.open}${notes.join(L.sep)}${L.close}` : "";
    out.push(`- ${who}${paren}${L.colon}${indentContinuation(turn.text)}`);
  }
  return `${out.join("\n")}\n`;
}

/** 題の長さの上限 */
const TITLE_MAX_CHARS = 60;

// tsconfig の lib は ES2020 で Intl.Segmenter の型を持たないので、使う分だけ宣言する
type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> };
type GraphemeSegmenterCtor = new (locale: string | undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter;

/** 見た目の 1 字ごとに分ける（絵文字や結合文字の途中で切らない）。使えない環境ではコードポイントごと */
function graphemes(text: string): string[] {
  const Ctor = (Intl as unknown as { Segmenter?: GraphemeSegmenterCtor }).Segmenter;
  if (typeof Ctor === "function") {
    return Array.from(new Ctor(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * 一覧に出す題。本人の最初の発言の 1 行目（無ければ依頼文の 1 行目、それも無ければ
 * 出どころと日付）。本人の言葉をそのまま使うので、何の会話かを思い出しやすい。
 */
export function conversationTitle(material: ConversationMaterial, options: RenderConversationOptions = {}): string {
  const firstLine = (text: string) =>
    text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find((l) => l.length > 0) ?? "";
  const users = material.turns.filter((t) => t.speaker === "user");
  const pick = users.find((t) => !t.brief) ?? users[0];
  const line = pick ? firstLine(pick.text) : "";
  if (line) {
    const chars = graphemes(line);
    return chars.length > TITLE_MAX_CHARS ? `${chars.slice(0, TITLE_MAX_CHARS).join("")}…` : line;
  }
  const date = material.startedAt ? localParts(material.startedAt, options.utcOffsetMinutes)?.date : undefined;
  const provider = CONVERSATION_PROVIDER_LABEL[material.provider];
  return date ? `${provider} ${date}` : provider;
}

/** フォルダ名として使う長さの上限 */
const WORKDIR_NAME_MAX_CHARS = 80;

/**
 * 作業フォルダのパスから、末尾の名前を取り出す（区切りは / と \ の両方）。
 * 記録の欄の値がそのままフォルダ名になるので、制御文字・向きを変える文字・見えない文字を落とし、
 * `.` `..` は名前として扱わず、長さを絞る。
 */
export function workdirName(workdir: string): string {
  const clean = (part: string) =>
    part
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
      .trim();
  const parts = workdir
    .split(/[/\\]+/)
    .map(clean)
    .filter((p) => p.length > 0 && p !== "." && p !== "..");
  if (parts.length === 0) return "";
  const chars = graphemes(parts[parts.length - 1]);
  return chars.length > WORKDIR_NAME_MAX_CHARS ? chars.slice(0, WORKDIR_NAME_MAX_CHARS).join("").trim() : chars.join("");
}

/**
 * 素材を入れるフォルダ（noteContexts の値）。フォルダは 2 階層までなので、
 * `<親>/<作業フォルダの名前>` にする。作業フォルダが分からなければ親だけ。
 * 親の名前は画面の言語で決まるので、呼び出し側が渡す（日本語なら「AI 会話」）。
 */
export function conversationFolder(rootLabel: string, workdir: string): string {
  const root = rootLabel.replace(/\//g, " ").trim();
  const name = workdirName(workdir);
  if (!root) return name;
  return name ? `${root}/${name}` : root;
}

/** 会話 1 本の集計（一覧・候補の絞り込み用。本文は持たない） */
export type ConversationSummary = {
  provider: ConversationProvider;
  sessionId: string;
  workdir: string;
  startedAt: string;
  endedAt: string;
  /** 本人の発言の数（依頼文は数えない） */
  ownTurns: number;
  ownChars: number;
  /** 会話の始まりに依頼文があるか */
  hasBrief: boolean;
};

export function summarizeConversation(material: ConversationMaterial): ConversationSummary {
  const users = material.turns.filter((t) => t.speaker === "user");
  return {
    provider: material.provider,
    sessionId: material.sessionId,
    workdir: material.workdir,
    startedAt: material.startedAt,
    endedAt: material.endedAt,
    ownTurns: users.filter((t) => !t.brief).length,
    ownChars: material.ownChars,
    hasBrief: users.some((t) => t.brief),
  };
}

/** 作業フォルダごとの集計 */
export type WorkdirSummary = {
  workdir: string;
  /** 会話の本数（本人の発言が無いものも含む） */
  sessions: number;
  /** 本人の発言が 1 つも無い会話の本数（頼まれた作業だけの会話。取り込みの既定からは外す） */
  unattendedSessions: number;
  /** 本人の発言が目安以上あり、ナレッジ化の候補になる会話の本数 */
  candidateSessions: number;
  ownTurns: number;
  ownChars: number;
  /** 期間（ISO 8601。時刻の分かる会話が無ければ ""） */
  startedAt: string;
  endedAt: string;
};

/** 会話の集計を作業フォルダごとにまとめる。並びは新しい会話のあるフォルダが先 */
export function summarizeWorkdirs(
  summaries: readonly ConversationSummary[],
  options: { candidateMinOwnChars?: number } = {},
): WorkdirSummary[] {
  const min = options.candidateMinOwnChars ?? CONVERSATION_CANDIDATE_MIN_OWN_CHARS;
  const map = new Map<string, WorkdirSummary>();
  for (const s of summaries) {
    let row = map.get(s.workdir);
    if (!row) {
      row = {
        workdir: s.workdir,
        sessions: 0,
        unattendedSessions: 0,
        candidateSessions: 0,
        ownTurns: 0,
        ownChars: 0,
        startedAt: "",
        endedAt: "",
      };
      map.set(s.workdir, row);
    }
    row.sessions += 1;
    if (s.ownTurns === 0) row.unattendedSessions += 1;
    if (s.ownChars >= min) row.candidateSessions += 1;
    row.ownTurns += s.ownTurns;
    row.ownChars += s.ownChars;
    if (s.startedAt && (!row.startedAt || Date.parse(s.startedAt) < Date.parse(row.startedAt))) {
      row.startedAt = s.startedAt;
    }
    if (s.endedAt && (!row.endedAt || Date.parse(s.endedAt) > Date.parse(row.endedAt))) {
      row.endedAt = s.endedAt;
    }
  }
  return [...map.values()].sort((a, b) => {
    const ta = a.endedAt ? Date.parse(a.endedAt) : 0;
    const tb = b.endedAt ? Date.parse(b.endedAt) : 0;
    return tb - ta || a.workdir.localeCompare(b.workdir);
  });
}
