// 音声ノートの「名前や連絡先を伏せる」（サーバーとブロックの両方で使う純ロジック）
//
// 清書・要約を頼むときに、AI に人名・組織名・連絡先・番号を決まった印に置き換えさせる
// （buildMeetingMaskSection）。AI の見逃しに備えて、返ってきた文に対して
// 利用者の「必ず伏せる語」とメール・電話番号の形を機械で置き換える（maskText）。
// ブロックはノートに書き出すときにも、その時点の「必ず伏せる語」でもう一度かける（後から足した語にも効く）。
// 伏せた清書・要約だけをノートに書き出せるので、ノートを読む AI（ナレッジ化など）には伏せた文しか渡らない。

import type { GenerationLanguage } from "./language";

/** 「必ず伏せる語」の最大字数 */
export const MAX_MASK_TERMS_CHARS = 300;

export type MaskLanguage = GenerationLanguage;

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
  ko: { person: "[이름]", organization: "[조직]", contact: "[연락처]", number: "[번호]", term: "[가림]" },
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

// 敬称の前の名前らしい語（AI が伏せ損ねた人名の候補）。漢字 1〜4 字かカタカナ 2〜8 字のあとに敬称
const NAME_BEFORE_HONORIFIC_RE =
  /(?<![぀-ヿ㐀-鿿豈-﫿\]］])([㐀-鿿豈-﫿]{1,4}|[゠-ヿ]{2,8})(?=さん|様|さま|氏|先生|くん|君|ちゃん)/g;
// 韓国語の敬称の前の名前（김철수 님 / 김철수님께서 / 철수 씨가 / 철수선생님）。ハングル 2〜4 字。
// 1 字は 손님・형님 のような一般語ばかり拾うので見ない。直前がハングルや印の閉じ括弧なら語の途中として弾く。
// 名前は最短一致（철수선생님 を 철수선생 にしない）。敬称のあとは語の終わりか助詞・指定詞だけ
// （다음은 씨앗 の 씨 を敬称と見ない）。2 番目のグループは敬称（님 だけの除外語に使う）
// 助詞と指定詞（씨예요・씨였어요・님이세요 など）。ここに無い語が続けば敬称ではなく名詞の一部とみなす
const KO_PARTICLE =
  "께서|께|에게|한테|에서|부터|까지|처럼|보다|하고|이랑|랑|라고|라는|이|입|예|였|가|은|는|을|를|의|과|와|도|만|들|요|으로|로|에";
const KO_NAME_BEFORE_HONORIFIC_RE = new RegExp(
  `(?<![가-힣\\]］])([가-힣]{2,4}?)(?=[^\\S\\n]*(선생님|님|씨)(?:(?![가-힣])|${KO_PARTICLE}))`,
  "g",
);
// 韓国語の「名前 + 役職 + 님」（김 과장님 / 김철수 과장님）。姓だけの 1 字も拾う。空白と 님 を必須にして誤検出を抑える
const KO_TITLES = "과장|부장|차장|팀장|실장|사장|회장|대표|이사|상무|전무|본부장|위원장|원장|소장|주임|대리|교수|박사|매니저|연구원";
const KO_NAME_BEFORE_TITLE_RE = new RegExp(
  `(?<![가-힣\\]］])([가-힣]{1,4})[^\\S\\n]+(?:${KO_TITLES})님`,
  "g",
);
// 英語の敬称のあとの名前（Mr. Tanaka など）
const NAME_AFTER_TITLE_RE = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+([A-Z][a-zA-Z'-]+)/g;

// 敬称が付いても人名ではない語（呼びかけ・役職・職業・「〜様」の熟語）
const NOT_NAMES = new Set([
  "皆", "皆々", "一同", "各位", "諸", "お客", "客", "奥", "神", "仏", "王", "子", "坊", "姫", "若", "殿", "旦那", "隣",
  "先方", "担当", "部長", "課長", "係長", "社長", "店長", "会長", "所長", "学長", "院長", "理事長", "学生", "先輩", "後輩",
  "業者", "医者", "大工", "運転手", "営業", "事務", "職人", "同様", "仕", "同", "模", "多", "異", "今", "外", "大", "有",
  "苦労", "ご苦労", "仕様", "模様", "多様", "異様",
  "ユーザー", "メンバー", "クライアント", "ベンダー", "デザイナー", "エンジニア", "スタッフ", "ゲスト", "オーナー",
  "パートナー", "リーダー", "マネージャー", "マネジャー", "ドクター",
]);

// 韓国語で敬称・役職の前に来ても人名ではない語（役職・呼びかけ・指示語・部署）
const KO_NOT_NAMES = new Set([
  "고객", "회원", "손님", "사용자", "담당자", "관계자", "참석자", "여러분", "직원", "관리자", "운영자",
  "팀장", "과장", "부장", "차장", "사장", "회장", "대표", "이사", "상무", "전무", "실장", "본부장", "위원장", "원장", "소장",
  "주임", "대리", "교수", "박사", "선생", "선배", "후배", "기사", "작가", "강사", "의사", "간호사", "변호사", "매니저", "연구원",
  "디자이너", "엔지니어", "개발자", "컨설턴트", "멤버", "리더", "파트너", "스태프", "게스트",
  "우리", "저희", "그", "저", "각", "두", "세", "네", "새", "옆", "다른", "해당", "담당", "신임", "전임",
  "개발", "영업", "기획", "인사", "총무", "연구", "품질", "생산", "마케팅",
]);
// 님 の前でだけ人名ではない語（하나님・부처님・어머님 など）。하나 씨・하나 선생님 は人名として拾う
const KO_NOT_NAMES_BEFORE_NIM = new Set([
  "하나", "부처", "임금", "공주", "왕자", "주인", "도련", "아드", "사모", "부모", "아버", "어머", "할아버", "할머", "형수",
]);
// 씨 の前でだけ人名ではない語（아저씨・아가씨・마음씨、글씨・날씨・種の 씨 の複合語）
const KO_NOT_NAMES_BEFORE_SSI = new Set([
  "아저", "아가", "마음", "손글", "봄날", "여름날", "가을날", "겨울날", "호박", "수박", "해바라기",
]);

/**
 * 伏せた文に残っている、人名らしい語の候補（日本語・韓国語の敬称の前の語・英語の敬称のあとの名前）。
 * 機械で決めつけて伏せると「業者さん」なども消えるので、候補として見せて利用者に選ばせる。
 * 出てきた順に重複なく返す。印や「必ず伏せる語」で伏せたあとの文に使う
 */
export function findNameCandidates(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    if (!name || NOT_NAMES.has(name) || KO_NOT_NAMES.has(name) || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  for (const m of text.matchAll(NAME_BEFORE_HONORIFIC_RE)) add(m[1]);
  // 韓国語の 2 規則は出てきた位置の順に並べてから足す（「김 과장님과 영희 씨」→ 김, 영희）
  const ko: { index: number; name: string }[] = [];
  for (const m of text.matchAll(KO_NAME_BEFORE_HONORIFIC_RE)) {
    if (m[2] === "님" && KO_NOT_NAMES_BEFORE_NIM.has(m[1])) continue;
    if (m[2] === "씨" && KO_NOT_NAMES_BEFORE_SSI.has(m[1])) continue;
    ko.push({ index: m.index, name: m[1] });
  }
  for (const m of text.matchAll(KO_NAME_BEFORE_TITLE_RE)) ko.push({ index: m.index, name: m[1] });
  for (const { name } of ko.sort((a, b) => a.index - b.index)) add(name);
  for (const m of text.matchAll(NAME_AFTER_TITLE_RE)) add(m[1]);
  return out;
}

/** 「必ず伏せる語」（カンマ区切りの文字列）に語を足す。すでにある語は足さない */
export function appendMaskTerms(current: string, names: string[]): string {
  const have = new Set(parseMaskTerms(current));
  const add = names.filter((n) => !have.has(n));
  if (add.length === 0) return current;
  const base = current.trim().replace(/[,、，]\s*$/, "");
  return base ? `${base}, ${add.join(", ")}` : add.join(", ");
}
