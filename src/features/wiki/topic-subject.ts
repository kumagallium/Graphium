// トピックの題を「材料」と「物性」に割る（純関数・isomorphic）。
// 日本語「〈化学式〉 の 〈物性〉」と英語「〈property〉 of 〈化学式〉」を扱う。
// 割れず topicType が material のときは、題まるごとを材料とする。
// WikiMeta に材料・物性の欄が無いための暫定の規則で、欄が出来たらそちらを先に読む。

import type { TopicType } from "../../lib/document-types";

export type TopicSubject = { material: string | null; property: string | null };

/** 元素記号（周期表 118） */
const ELEMENTS: ReadonlySet<string> = new Set(
  (
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
    "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu " +
    "Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr " +
    "Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
  ).split(" "),
);

/** 割る対象の題の長さの上限（畳んだ後）。これを超えたら割らない */
const MAX_TITLE_LENGTH = 200;

/** NFKC にそろえ、ハイフン類を `-` に統一し、連続する空白を半角空白 1 つに畳んで前後を落とす（線形時間） */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‐-―−﹣－]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 化学式か。p 型/n 型の前置きと 合金/系 の後置きを外したうえで、次の 3 つをすべて満たすこと。
 * (1) 使える文字は元素記号・数字・小数点・x/y/z/δ・ハイフン・丸括弧・カンマだけで、括弧の対応が取れている
 * (2) 別々の元素が 2 種類以上（B2B は不可）
 * (3) 数字を含む、または 2 文字の元素記号を含む（CPU・ISO・SNS など大文字の略語を除くため）
 * relaxed が true（topicType が material）のときは (3) を外す。種類の札は人が直せる構造化された手がかりなので信じる。
 */
export function isChemicalFormula(raw: string, relaxed = false): boolean {
  let s = normalize(raw);
  s = s.replace(/^[pn](?:型|-type)\s*/i, "").replace(/\s*(?:合金|系|alloy|system)$/i, "");
  if (!s) return false;
  const distinct = new Set<string>();
  let hasDigit = false;
  let hasTwoLetter = false;
  let depth = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[A-Z]/.test(c)) {
      const two = s.slice(i, i + 2);
      if (two.length === 2 && ELEMENTS.has(two)) {
        distinct.add(two);
        hasTwoLetter = true;
        i += 2;
      } else if (ELEMENTS.has(c)) {
        distinct.add(c);
        i += 1;
      } else {
        return false;
      }
    } else if (/[0-9]/.test(c)) {
      hasDigit = true;
      i += 1;
    } else if (c === "(") {
      depth++;
      i += 1;
    } else if (c === ")") {
      depth--;
      if (depth < 0) return false;
      i += 1;
    } else if (/[.xyzδ,-]/.test(c)) {
      i += 1;
    } else {
      return false;
    }
  }
  if (depth !== 0) return false;
  if (distinct.size < 2) return false;
  return relaxed || hasDigit || hasTwoLetter;
}

/** 最後の " of "（大文字小文字を問わない）の位置。無ければ -1。正規表現の後戻りを使わない */
function lastOfIndex(t: string): number {
  return Math.max(t.lastIndexOf(" of "), t.lastIndexOf(" Of "), t.lastIndexOf(" OF "), t.lastIndexOf(" oF "));
}

/** 題を材料と物性に割る。割れなければ topicType が material のときだけ材料＝題 */
export function splitTopicSubject(title: string, topicType?: TopicType | null): TopicSubject {
  const t = normalize(title ?? "");
  const relaxed = topicType === "material";
  const fallback = (): TopicSubject => (relaxed && t ? { material: t, property: null } : { material: null, property: null });
  if (t.length > MAX_TITLE_LENGTH) return fallback();
  // 日本語: 左の化学式に「の」は入らないので最初の「の」で割る（物性側には「の」が入りうる）
  const jaAt = t.indexOf("の");
  if (jaAt >= 0) {
    const left = t.slice(0, jaAt).trim();
    const right = t.slice(jaAt + 1).trim();
    if (left && right && isChemicalFormula(left, relaxed)) return { material: left, property: right };
  }
  // 英語: 物性側に " of " が入りうる（figure of merit of …）ので最後の " of " で割る
  const enAt = lastOfIndex(t);
  if (enAt >= 0) {
    const left = t.slice(0, enAt).trim();
    const right = t.slice(enAt + 4).trim();
    if (left && right && isChemicalFormula(right, relaxed)) return { material: right, property: left };
  }
  return fallback();
}
