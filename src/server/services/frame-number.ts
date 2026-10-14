// frame の値（FrameValue.value）の数値化。決まった規則だけで機械的に分け、迷ったら null（文字列のまま）。
// LLM には数を変換させない。照合（quote-check）を通った後の文字列にだけ使う。

export type SplitComparator = "lt" | "gt" | "le" | "ge";

export interface SplitNumeric {
  value: number;
  unit?: string;
  comparator?: SplitComparator;
}

// 数の部分だけ全角を許す（単位の表記は変えない）。符号: + - ＋ － U+2212
const D = "[0-9０-９]";
// 千区切りの先頭桁は 0 にしない（"0,500" を 500 にしない）
const D1 = "[1-9１-９]";
const SIGN = "[+\\-＋－−]";
const DOT = "[.．]";
const COMMA = "[,，]";
const NUMBER_RE = new RegExp(
  `^\\s*(<=|>=|＜＝|＞＝|[<>＜＞≤≦≥≧])?\\s*` +
    `(${SIGN}?(?:${D1}${D}{0,2}(?:${COMMA}${D}{3})+|${D}+)(?:${DOT}${D}+)?(?:[eE]${SIGN}?${D}+)?)` +
    `(.*)$`,
  "s",
);

const COMPARATORS: Record<string, SplitComparator> = {
  "<": "lt", "＜": "lt",
  ">": "gt", "＞": "gt",
  "<=": "le", "＜＝": "le", "≤": "le", "≦": "le",
  ">=": "ge", "＞＝": "ge", "≥": "ge", "≧": "ge",
};

const MAX_UNIT_LENGTH = 24;
// 範囲・近似の記号
const RANGE_CHARS = /[〜~～∼±≈]/;
// 日本語の量の語
const JA_QUANTITY_WORDS = /以上|以下|未満|超|程度|前後|くらい|ぐらい|ほど|約|から|まで/;
// 英語の語（単語として）
const EN_WORDS = /(?<![A-Za-z])(?:to|or|and|about|approx)(?![A-Za-z])/i;

// 単位として通す形: 許可リストにある記号だけ（大小文字を区別する。mK と MK は別物）。
// 複合単位は / · で区切った各部分がすべて許可リストにあるときだけ通す（上付き・^ は剥がして判定）。
// 日付・時刻・時代・近似・上下限の語はリストに無いので通らない（迷ったら null）。
// 暦・時刻（年 月 日 時）や序数にも読める日本語の語（度 回）は入れない。
const JA_UNITS = new Set([
  "秒", "分", "時間", "週", "個", "件", "倍", "人", "円", "点", "本", "枚",
]);
const UNIT_TOKENS = new Set([
  // 長さ・質量・時間
  "m", "cm", "mm", "nm", "μm", "µm", "km", "Å", "g", "mg", "kg", "μg", "µg", "ug", "ng", "t",
  "s", "ms", "μs", "µs", "us", "ns", "min", "h", "hr",
  // 周波数・力・圧力・エネルギー・電気・磁気
  "Hz", "kHz", "MHz", "GHz", "N", "kN", "Pa", "kPa", "MPa", "GPa", "bar", "mbar", "atm", "Torr", "mmHg",
  "J", "kJ", "MJ", "cal", "kcal", "eV", "keV", "MeV", "GeV", "W", "mW", "kW", "MW",
  "V", "mV", "kV", "A", "mA", "Ω", "kΩ", "MΩ", "S", "T", "mT", "Oe",
  // 温度・物質量・濃度・体積
  "K", "mK", "mol", "mmol", "μmol", "µmol", "L", "mL", "μL", "µL", "M", "mM", "ppm", "ppb",
  // 割合・その他
  "wt%", "vol%", "at%", "mol%", "dB", "rpm", "°C", "°F", "°",
]);
const SYMBOL_UNIT_RE = /^[%‰℃℉\u3300-\u33ff]$/;
const MAX_PLAIN_UNIT = 12;

function isPlainUnit(unit: string): boolean {
  if (unit.length > MAX_PLAIN_UNIT) return false;
  if (/\s/.test(unit)) return false;
  if (JA_UNITS.has(unit)) return true;
  // N/A は「該当なし」と読めるので単位にしない
  if (unit.toUpperCase() === "N/A") return false;
  const parts = unit.split(/[/·]/);
  return parts.every((part) => {
    const base = part.replace(/\^?[²³¹⁻]+$/u, "");
    if (base.length === 0) return false;
    return UNIT_TOKENS.has(base) || SYMBOL_UNIT_RE.test(base);
  });
}

function normalizeNumberText(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, ".")
    .replace(/[，,]/g, "")
    .replace(/＋/g, "+")
    .replace(/[－−]/g, "-");
}

/** 「650 K」「< 1」「1,200」のような単純な「数 + 単位」だけを分ける。迷ったら null */
export function splitNumericText(text: string): SplitNumeric | null {
  if (/^\s*(?:ca\.|約|~|≈)/i.test(text)) return null;
  const m = NUMBER_RE.exec(text);
  if (!m) return null;
  const num = Number(normalizeNumberText(m[2]));
  if (!Number.isFinite(num)) return null;

  const unit = m[3].trim();
  if (unit.length > 0) {
    // 数と英字の単位の間に空白が無い形（316L・3D・13C・3He など）は型番・同位体と区別できないので分けない
    if (m[3] === unit && /^\p{Script=Latin}|^\p{Script=Greek}/u.test(unit)) return null;
    if (unit.length > MAX_UNIT_LENGTH) return null;
    if (/[0-9０-９]/.test(unit)) return null;
    if (RANGE_CHARS.test(unit)) return null;
    if (/^[-–—−－/:]/.test(unit)) return null;
    if (JA_QUANTITY_WORDS.test(unit)) return null;
    if (EN_WORDS.test(unit)) return null;
    if (!isPlainUnit(unit)) return null;
  }

  const out: SplitNumeric = { value: num };
  if (unit.length > 0) out.unit = unit;
  if (m[1]) out.comparator = COMPARATORS[m[1]];
  return out;
}
