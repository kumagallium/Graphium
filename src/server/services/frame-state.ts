// frame の値（FrameValue.value）の状態を「語幹 + present/absent」に寄せる。
// 決まった規則だけで機械的に寄せ、迷ったら null（そのまま）。日本語だけが対象（英語は対象外）。
// 目的: 規則側「分解する」と観察側「分解した」を語幹「分解」+ present で突き合わせ、
// 文字列一致による違反の誤検知を防ぐ。照合（quote-check）を通った後の文字列にだけ使う。

export type StatePolarity = "present" | "absent";

export interface SplitState {
  stem: string;
  polarity: StatePolarity;
}

// 「〜する」型の動詞の語尾。長い語尾から順に試す（否定を先に判定）
const SURU_NEGATIVE = [
  "していなかった", "しませんでした", "していない", "されていない", "しなくなった",
  "しなくなる", "しなかった", "されなかった", "しません", "しない", "されない",
].sort((a, b) => b.length - a.length);
const SURU_POSITIVE = [
  "していました", "している", "していた", "しました", "されている", "されていた",
  "します", "された", "される", "した", "する",
].sort((a, b) => b.length - a.length);

// 発生・観察の語: <語幹>(が|は)?<語><語尾>（丁寧形・丁寧な否定過去も含む）
const EVENT_WORDS = "(?:見られ|起き|生じ|確認され|観察され|認められ)";
const EVENT_POSITIVE_RE = new RegExp(`^(.+?)(?:が|は)?${EVENT_WORDS}(?:ている|ていた|ました|ます|る|た)$`, "s");
const EVENT_NEGATIVE_RE = new RegExp(`^(.+?)(?:が|は)?${EVENT_WORDS}(?:ませんでした|なかった|ていない|ません|ない)$`, "s");

// 有無
const EXIST_POSITIVE_RE = /^(.+?)(?:(?:あり|有り)|(?:が|は)(?:あった|あります|ある))$/s;
const EXIST_NEGATIVE_RE = /^(.+?)(?:(?:なし|無し)|(?:が|は)(?:ありませんでした|なかった|ありません|無い|ない))$/s;

// 程度・部分・頻度・可能性などの修飾語（含まれていたら寄せない）。ひらがなの修飾語は
// 「語幹にひらがなを含まない」規則で弾かれるので、ここには漢字・カタカナ・英字の語を置く
const MODIFIERS = [
  "一部", "部分的", "わずか", "僅か", "少し", "若干", "ほぼ", "ほとんど", "完全", "半分", "徐々",
  "急", "再", "未", "非", "不", "無",
  "顕著", "軽微", "大幅", "著しい", "通常", "特に", "常に", "時折", "時々", "度々", "頻繁", "稀",
  "一度", "一旦", "一時", "可能性", "疑い", "恐れ", "傾向", "場合", "時", "前", "後", "際", "多少", "少量",
];
// 語幹に許す文字: 漢字・々・カタカナ（ー・を含む）・ASCII 英字だけ。
// ひらがなを含ませないことで、助詞・活用語尾・条件節・形式名詞（こと・わけ）・二重否定が語幹に残らない
const STEM_RE = /^[一-鿿々゠-ヿA-Za-z]+$/;

function validStem(stem: string, minLength: number): boolean {
  if (stem.length < minLength || stem.length > 16) return false;
  if (!STEM_RE.test(stem)) return false;
  if (MODIFIERS.some((m) => stem.includes(m))) return false;
  return true;
}

function tryEndings(text: string, endings: string[]): string | null {
  for (const e of endings) {
    if (text.endsWith(e)) return text.slice(0, text.length - e.length);
  }
  return null;
}

// minLength: 「〜する」型は単漢字（出・示・増 など）を動詞の語尾の断片とみなして 2 文字以上を求める
function candidate(text: string): { stem: string; polarity: StatePolarity; minLength: number } | null {
  // 否定を先に判定する。発生・観察の語（「確認された」など）は「〜された」より先に見る
  let m = EVENT_NEGATIVE_RE.exec(text);
  if (m) return { stem: m[1], polarity: "absent", minLength: 1 };
  m = EVENT_POSITIVE_RE.exec(text);
  if (m) return { stem: m[1], polarity: "present", minLength: 1 };
  m = EXIST_NEGATIVE_RE.exec(text);
  if (m) return { stem: m[1], polarity: "absent", minLength: 1 };
  m = EXIST_POSITIVE_RE.exec(text);
  if (m) return { stem: m[1], polarity: "present", minLength: 1 };
  const sn = tryEndings(text, SURU_NEGATIVE);
  if (sn !== null) return { stem: sn, polarity: "absent", minLength: 2 };
  const sp = tryEndings(text, SURU_POSITIVE);
  if (sp !== null) return { stem: sp, polarity: "present", minLength: 2 };
  return null;
}

/** 状態の文を「語幹 + present/absent」に寄せる。迷ったら null（そのまま）。 */
export function splitStateText(text: string): SplitState | null {
  const t = text.trim();
  if (t.length === 0) return null;
  const c = candidate(t);
  if (!c) return null;
  const stem = c.stem.trim();
  if (!validStem(stem, c.minLength)) return null;
  // 原文引用の不変条件: 語幹は元の値の部分文字列
  if (!text.includes(stem)) throw new Error("splitStateText: 語幹が元の値の部分文字列ではない");
  return { stem, polarity: c.polarity };
}
