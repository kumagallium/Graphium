// 出典つきナレッジページ（トピック・問答・要約）の本文の引用 `[[source:<id>|<一節>]]`。
//
// - `<id>` は資料の id（ノート id・`pdf:<fileId>`・`url:<URL>` 等）
// - `|<一節>` は省略できる。その文が言い換えた資料の一節を、原文のまま控えたもの
//   （書いた AI に写させ、保存前に資料の文字と照らして、見つからない一節は外す）
// 一節の無い `[[source:<id>]]`（以前の本文・一節を控えない書き手）もそのまま読める。

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
  /** 控えた一節（無ければ undefined） */
  passage?: string;
};

/** 本文中の引用をすべて取り出す（出てきた順） */
export function parseSourceCitations(text: string): SourceCitation[] {
  const out: SourceCitation[] = [];
  for (const m of text.matchAll(SOURCE_CITATION_RE)) {
    const passage = m[2]?.trim();
    out.push({ raw: m[0], sourceId: m[1].trim(), ...(passage ? { passage } : {}) });
  }
  return out;
}

/** 引用の書き方をそろえる（一節が空なら付けない） */
export function formatSourceCitation(sourceId: string, passage?: string): string {
  const p = passage ? sanitizePassage(passage) : "";
  return p ? `[[source:${sourceId}|${p}]]` : `[[source:${sourceId}]]`;
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
