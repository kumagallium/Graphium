// 言語に応じたテキスト類似度（MCP の洞察ツール用）。embedding が MCP に無いので、
// 束の選び（insight-coverage）と重複の候補探し（insight-tools）をこの軽い類似度で行う。
//
// - 和文・中文など CJK が中心の文: 2 文字の並び（文字 bigram）の Jaccard。
//   空白で語に分けられず、sampling.ts のトークン Jaccard では句読点区切りの長い断片が
//   1 トークンになって類似がほぼ 0 になるため（束が索引順に潰れる）
// - ラテン文字中心の文: 単語（小文字・簡易な複数形の除去・ストップワード除去）の Jaccard。
//   文字 bigram だと英語は無関係な対でも 0.4 前後になる（共通の綴りが多い）ため単語で見る
// 方式が違う特徴集合どうしは比べない（類似度 0）。

const CJK_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const LETTER_RE = /[\p{L}\p{N}]/u;

/** 文のうち CJK の文字がこの割合以上なら CJK の文として扱う */
const CJK_RATIO = 0.3;

export type SimilarityMode = "cjk" | "word";
export type Features = { mode: SimilarityMode; set: Set<string> };

/**
 * 重複の候補にする類似度のしきい値（モードごと）。
 * - cjk: 0.2。言い換えた同主張の対は 0.2 を超え、別話題の対は助詞の並びが重なる程度（約 0.05）
 * - word: 0.15。無関係な対は 0〜0.05、専門語が共通する言い換えは 0.2〜0.5
 * どちらも候補探しなので広めに拾う（拾いすぎても審査の対が増えるだけ。最終判定は LLM）
 */
export const DUPLICATE_THRESHOLD: Record<SimilarityMode, number> = { cjk: 0.2, word: 0.15 };

const STOPWORDS = new Set(
  (
    "the an of to in on at by for with from and or but not no is are was were be been being as it its this that these those " +
    "than then so such can could may might will would should do does did has have had more most less least into over under " +
    "their there which who whom what when where while also very if when how why"
  ).split(" "),
);

export function detectMode(text: string): SimilarityMode {
  let letters = 0;
  let cjk = 0;
  for (const ch of text) {
    if (!LETTER_RE.test(ch)) continue;
    letters++;
    if (CJK_RE.test(ch)) cjk++;
  }
  return letters > 0 && cjk / letters >= CJK_RATIO ? "cjk" : "word";
}

function bigrams(text: string): Set<string> {
  const chars = [...text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")];
  const out = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
  return out;
}

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    // 簡易な複数形の除去（flows → flow。"ss" で終わる語は除く）
    const w = raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (!STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** 文から類似度の特徴集合を作る（候補ごとに 1 回だけ作って使い回す） */
export function featuresOf(text: string): Features {
  const mode = detectMode(text);
  return { mode, set: mode === "cjk" ? bigrams(text) : words(text) };
}

/** 特徴集合どうしの Jaccard（0..1）。モードが違えば 0 */
export function featureSimilarity(a: Features, b: Features): number {
  if (a.mode !== b.mode || a.set.size === 0 || b.set.size === 0) return 0;
  let inter = 0;
  for (const g of a.set) if (b.set.has(g)) inter++;
  return inter / (a.set.size + b.set.size - inter);
}

export function textSimilarity(a: string, b: string): number {
  return featureSimilarity(featuresOf(a), featuresOf(b));
}
