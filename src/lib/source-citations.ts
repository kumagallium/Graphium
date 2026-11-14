// 出典つきナレッジページ（トピック・問答・要約）の本文の引用 `[[source:<id>|<一節>]]`。
//
// - `<id>` は資料の id（ノート id・`pdf:<fileId>`・`url:<URL>` 等）
// - `|<一節>` は省略できる。その文が言い換えた資料の一節を、原文のまま控えたもの
//   （書いた AI に写させ、保存前に資料の文字と照らして、見つからない一節は外す）
// 一節の無い `[[source:<id>]]`（以前の本文・一節を控えない書き手）もそのまま読める。
// - `|?|<一節>` は「資料に見つからなかった一節」。AI が写した一節が資料の文字に無かったとき、
//   黙って消さずに印を付けて残す（読む人に見せ、出典照合で確かめる対象にする）。
//   印の付いた一節は、資料の位置へ開く手がかり（targetQuote）や出典照合の抜粋には使わない。

/**
 * 引用 1 つ。m[1] = id、m[2] = 一節（無ければ undefined）。
 * 一節の中には `]` や `|` が入ってよい（論文の一節の「[12]」や表の区切り）。一節が `]` で
 * 終わると `…[14]]]` のように `]` が 3 つ並ぶので、終わりの印は「後ろに `]` が続かない `]]`」とし、
 * その手前の `]` は一節に含める。`]]` を一節の途中に入れることはできない。
 */
export const SOURCE_CITATION_RE = /\[\[source:([^\]|]+?)(?:\|((?:[^\]]|\](?=[^\]])|\](?=\]\](?!\])))*?))?\]\](?!\])/g;

export type SourceCitation = {
  /** 本文中の引用の文字列そのまま */
  raw: string;
  sourceId: string;
  /** 控えた一節（無ければ undefined。印 `?|` は外した中身） */
  passage?: string;
  /** 資料に見つからなかった一節か（`|?|<一節>`） */
  unverified?: boolean;
};

const UNVERIFIED_PREFIX = "?|";

/** 正規表現の m[2]（一節の部分）を、一節と「見つからなかった」の印に分ける */
export function splitPassage(raw: string | undefined): { passage?: string; unverified?: boolean } {
  const t = raw?.trim();
  if (!t) return {};
  if (t.startsWith(UNVERIFIED_PREFIX)) {
    const p = t.slice(UNVERIFIED_PREFIX.length).trim();
    return p ? { passage: p, unverified: true } : {};
  }
  return { passage: t };
}

/** 本文中の引用をすべて取り出す（出てきた順） */
export function parseSourceCitations(text: string): SourceCitation[] {
  const out: SourceCitation[] = [];
  for (const m of text.matchAll(SOURCE_CITATION_RE)) {
    out.push({ raw: m[0], sourceId: m[1].trim(), ...splitPassage(m[2]) });
  }
  return out;
}

/** 引用の書き方をそろえる（一節が空なら付けない。unverified なら「見つからなかった」の印を付ける） */
export function formatSourceCitation(sourceId: string, passage?: string, unverified?: boolean): string {
  const p = passage ? sanitizePassage(passage) : "";
  if (!p) return `[[source:${sourceId}]]`;
  return unverified ? `[[source:${sourceId}|${UNVERIFIED_PREFIX}${p}]]` : `[[source:${sourceId}|${p}]]`;
}

/** 一節に入れられない文字列（引用の終わりの印 `]]`）を外し、空白を 1 つに畳む */
function sanitizePassage(passage: string): string {
  return passage.replace(/\]\]/g, " ").replace(/\s+/g, " ").trim();
}

/** 一節を外した本文（引用は `[[source:<id>]]` に戻す） */
export function stripCitationPassages(text: string): string {
  return text.replace(SOURCE_CITATION_RE, (_m, id: string) => `[[source:${id.trim()}]]`);
}

// ── 一節の照合 ──────────────────────────────────────────────────────────────
// 書いた AI が写した一節が、資料の文字に実在するかを確かめる（AI を使わない・何度やっても同じ結果）。
// 吸収するのは「同じ文字なのに表記が違う」ものだけ:
// - NFKC（全角半角・合字）・大文字小文字・空白と改行（PDF の行の区切り）
// - 句読点の全角半角（、，→ ,  。．→ .）
// - ハイフン・ダッシュの字形（‐ ‑ ‒ – — − → -）と、欧文の語の途中のハイフン
//   （PDF の行末で分かれた語 "trans-\nformer" を、AI はつないで "transformer" と書く）
// - 論文の参照番号（[8]・[3, 5]・[12–14]）。AI は一節を写すときに落としがち
// - 一節の末尾の句読点（原文の「…modes, while」を AI は「…modes.」で閉じる）
// 言い換え・「…」での省略・2 か所のつなぎ合わせは吸収しない（それを見つけるための照合）。

const DASHES_RE = /[‐‑‒–—−﹘﹣－]/g;

/** 一節の照合用の正規化 */
export function normalizeForPassageMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(DASHES_RE, "-")
    .replace(/\[\s*\d+(?:\s*[,\-]\s*\d+)*\s*\]/g, "")
    .replace(/[、，]/g, ",")
    .replace(/[。．]/g, ".")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/([a-z])-(?=[a-z])/g, "$1");
}

/** 照合に使える最短の長さ（正規化後）。短い一節はどこにでも一致してしまうので、照合しない */
export const MIN_PASSAGE_MATCH_LENGTH = 8;

/** 一節が資料の文字に実在するか（正規化した上での部分一致）。短すぎる一節は false */
export function passageAppearsIn(passage: string, sourceText: string): boolean {
  const p = normalizeForPassageMatch(passage).replace(/[.,;:!?]+$/, "");
  if (p.length < MIN_PASSAGE_MATCH_LENGTH) return false;
  return normalizeForPassageMatch(sourceText).includes(p);
}
