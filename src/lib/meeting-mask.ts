// 音声ノートの「名前や連絡先を伏せる」（サーバーとブロックの両方で使う純ロジック）
//
// 清書・要約を頼むときに、AI に人名・組織名・連絡先・番号を決まった印に置き換えさせる
// （buildMeetingMaskSection）。AI の見逃しに備えて、返ってきた文に対して
// 利用者の「必ず伏せる語」とメール・電話番号の形を機械で置き換える（maskText）。
// ブロックはノートに書き出すときにも、その時点の「必ず伏せる語」でもう一度かける（後から足した語にも効く）。
// 伏せた清書・要約だけをノートに書き出せるので、ノートを読む AI（ナレッジ化など）には伏せた文しか渡らない。

/** 「必ず伏せる語」の最大字数 */
export const MAX_MASK_TERMS_CHARS = 300;

export type MaskLanguage = "ja" | "en";

export type MaskPlaceholders = {
  person: string;
  organization: string;
  contact: string;
  number: string;
  /** 「必ず伏せる語」を置き換える印（種類が分からないので共通） */
  term: string;
};

const PLACEHOLDERS: Record<MaskLanguage, MaskPlaceholders> = {
  ja: { person: "［人名］", organization: "［組織名］", contact: "［連絡先］", number: "［番号］", term: "［伏せ字］" },
  en: { person: "[name]", organization: "[organization]", contact: "[contact]", number: "[number]", term: "[redacted]" },
};

export function maskPlaceholders(language: MaskLanguage): MaskPlaceholders {
  return PLACEHOLDERS[language];
}

/** 「必ず伏せる語」を語の配列にする（読点・カンマ・改行区切り。制御文字を除き、字数で切る。長い語から） */
export function parseMaskTerms(input: unknown): string[] {
  if (typeof input !== "string") return [];
  // eslint-disable-next-line no-control-regex
  const s = [...input.replace(/[\u0000-\u001f\u007f]+/g, ",")].slice(0, MAX_MASK_TERMS_CHARS).join("");
  const terms = [...new Set(s.split(/[,、，;；\n]/).map((x) => x.trim()).filter((x) => x.length > 0))];
  // 長い語から置き換える（「田中商事」を「田中」より先に）
  return terms.sort((a, b) => b.length - a.length);
}

/** 清書・要約の指示に足す「伏せる」節 */
export function buildMeetingMaskSection(language: MaskLanguage): string {
  const p = maskPlaceholders(language);
  return `\n\n## Hide sensitive details
The user turned on "hide names and contact details". In every text you output (including "owner"), replace:
- names of people (speakers and anyone mentioned, including nicknames; an honorific such as さん or 先生 may stay after the placeholder) → ${p.person}
- names of companies, schools, clients and other organizations → ${p.organization}
- email addresses, phone numbers and postal addresses → ${p.contact}
- account numbers, membership or employee numbers and other personal ID numbers → ${p.number}
Write the placeholder exactly as shown, every time the detail appears. Keep roles and generic words (部長, the client, the team), product and technical terms, places that are not addresses, dates and amounts. If you are not sure whether a word is a person's or an organization's name, hide it.`;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 印そのもの（両言語・全角半角）。「必ず伏せる語」の置き換えが印の中を壊さないよう、ここは触らない
const PLACEHOLDER_RE = new RegExp(
  `(${Object.values(PLACEHOLDERS)
    .flatMap((p) => Object.values(p))
    .map((ph) => `[\\[［]\\s*${escapeRegExp(ph.slice(1, -1))}\\s*[\\]］]`)
    .join("|")})`,
  "g",
);

// メールアドレス（半角・全角の @）。AI が見逃したときの安全網
const EMAIL_RE = /[A-Za-z0-9._%+-]+[@＠][A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 電話番号らしい並び（全角数字・各種ハイフン・括弧も）。桁数で確かめてから伏せる（dateLike を除く）
const DIGIT = "[0-9０-９]";
const SEP = "[\\s\\-‐‑–−－]";
const PHONE_RE = new RegExp(
  `(?<![0-9０-９\\-‐‑–−－])(?:[+＋]${DIGIT}{1,3}${SEP}?)?[(（]?${DIGIT}{1,5}[)）]?${SEP}?[(（]?${DIGIT}{1,4}[)）]?${SEP}?${DIGIT}{3,4}(?![0-9０-９\\-‐‑–−－])`,
  "g",
);

const toAsciiDigits = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 電話番号とみなすか: 国内は 0 始まりで 10〜11 桁、国際形式（+）は 9〜15 桁。区切りの無い並びは国内の形だけ */
function isPhoneLike(match: string): boolean {
  const s = toAsciiDigits(match);
  const digits = s.replace(/\D/g, "");
  if (/^[+＋]/.test(match)) return digits.length >= 9 && digits.length <= 15;
  if (!digits.startsWith("0")) return false;
  // 日付（05-10-2026 は 8 桁）や時刻・型番の短い並びはここで外れる
  return digits.length >= 10 && digits.length <= 11;
}

/** 返ってきた文を機械で伏せる（印の書き方を揃える → 「必ず伏せる語」→ メール → 電話番号の順） */
export function maskText(text: string, terms: string[], language: MaskLanguage): string {
  const p = maskPlaceholders(language);
  // 印の中は触らずに、印と印のあいだだけを置き換える
  const parts = text.split(PLACEHOLDER_RE);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        // 印: 日本語では AI が半角の [人名] で書くことがあるので、決まった形に揃える
        if (language !== "ja") return part;
        const inner = part.replace(/^[[［]\s*|\s*[\]］]$/g, "");
        const hit = Object.values(p).find((ph) => ph.slice(1, -1) === inner);
        return hit ?? part;
      }
      let out = part;
      for (const term of terms) {
        // 英字の語は大文字小文字を区別しない（Tanaka / tanaka）
        out = out.replace(new RegExp(escapeRegExp(term), /[A-Za-z]/.test(term) ? "gi" : "g"), p.term);
      }
      return out
        .replace(EMAIL_RE, p.contact)
        .replace(PHONE_RE, (m) => (isPhoneLike(m) ? p.contact : m));
    })
    .join("");
}
