// 手順抽出の結果の「名寄せ」。
//
// 抽出の prompt には既存の名前（頻出 40 件）を渡しているが、それだけでは揺れが残る:
//   - prompt に載らない頻度の低い名前とは揃わない
//   - 一括抽出は論文ごとに並列で走るので、同じ回の論文どうしは互いの名前を知らない
//   - モデルが表記を少し変える（Calcination / calcination / ball-milling / ball milling）
// そこで保存の直前に、抽出結果のラベルを書庫の名前へ寄せ直す。2 段で行う:
//   1. 表記ゆれ（決定的）: NFKC・大小・ハイフンや空白・英語の複数形だけが違う名前は同じとみなす
//   2. 同じ概念（AI）: 1 で寄らなかった新しい名前だけを、既存の名前の一覧と一緒に AI に渡し、
//      同じモノ・同じ操作を指すものがあれば既存の名前を選ばせる（一覧に無い名前は選べない）
// このファイルは 1 と、2 の結果をブロックに当てる部分（純関数）を持つ。2 の呼び出しは
// label-alignment-api.ts、直列化（同じ回の論文が前の論文の名前を使えるようにする）は
// label-alignment-queue.ts。

import type { ProvIngesterBlock } from "./prov-note-builder";
import type { ProvVocabulary, VocabularyKind } from "./label-vocabulary";

/** 種類ごとの「元の名前 → 寄せ先の名前」 */
export type LabelMapping = Partial<Record<VocabularyKind, Record<string, string>>>;

export type AlignmentChange = {
  kind: VocabularyKind;
  from: string;
  to: string;
  /** spelling = 表記ゆれ（決定的）、concept = AI が同じ概念と判断 */
  via: "spelling" | "concept";
};

const KINDS: VocabularyKind[] = ["step", "material", "tool", "output", "attributeKey"];

/** 英単語 1 語の複数形を単数へ（数字を含む語・短い語は触らない） */
function singularize(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (/ss$/.test(word) || /us$/.test(word) || /is$/.test(word)) return word;
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * 表記ゆれを畳んだ比較用のキー。
 * - NFKC（全角半角・下付き数字 ₁₂ → 12）と小文字化
 * - ハイフン類・下線・中黒・スラッシュ・空白は区切りとして扱い、最後に詰める
 * - 英単語ごとに複数形を単数へ
 * 化学式は大小で意味が変わる（Co と CO）が、ラベルとしての衝突は実用上ほぼ無いので
 * 大小は畳む。グラフ側（prov-graph の normalizeEntityText）も大小を畳んで数えている。
 */
export function canonicalLabelKey(text: string): string {
  const s = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―−\-_/・･]+/g, " ")
    .replace(/[()（）[\]「」"'`.,;:、。]+/g, " ")
    .trim();
  if (!s) return "";
  return s
    .split(/\s+/)
    .map(singularize)
    .join("");
}

/** `rpm: 300` → { key: "rpm", rest: ": 300" }。キーが無ければ null */
function splitAttribute(text: string): { key: string; rest: string } | null {
  const m = text.match(/^([^:：]{1,24})([:：]\s*.+)$/s);
  if (!m) return null;
  return { key: m[1].trim(), rest: m[2] };
}

/** 抽出結果に現れるラベルを種類ごとに集める（出現順・重複なし） */
export function collectBlockLabels(blocks: ProvIngesterBlock[]): ProvVocabulary {
  const out: Record<VocabularyKind, string[]> = {
    step: [],
    material: [],
    tool: [],
    output: [],
    attributeKey: [],
  };
  const seen: Record<VocabularyKind, Set<string>> = {
    step: new Set(),
    material: new Set(),
    tool: new Set(),
    output: new Set(),
    attributeKey: new Set(),
  };
  const push = (kind: VocabularyKind, raw: string | undefined) => {
    const s = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!s || seen[kind].has(s)) return;
    seen[kind].add(s);
    out[kind].push(s);
  };
  const walk = (list: ProvIngesterBlock[]) => {
    for (const b of list) {
      if (b.role === "procedure" && b.blockType === "heading") push("step", b.text);
      for (const sp of b.content ?? []) {
        if (sp.role === "material" || sp.role === "tool" || sp.role === "output") push(sp.role, sp.text);
        else if (sp.role === "attribute") {
          const a = splitAttribute(sp.text);
          if (a) push("attributeKey", a.key);
        }
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

/**
 * 段 1: 表記ゆれだけが違う名前を、既存の名前（無ければ同じ抽出結果の中で先に出た名前）へ寄せる。
 * 戻り値は寄せ方の表と、寄らずに残った「新しい名前」（段 2 で AI に渡す候補）。
 */
export function alignBySpelling(
  labels: ProvVocabulary,
  inventory: ProvVocabulary,
): { mapping: LabelMapping; changes: AlignmentChange[]; unmatched: ProvVocabulary } {
  const mapping: LabelMapping = {};
  const changes: AlignmentChange[] = [];
  const unmatched: Record<VocabularyKind, string[]> = {
    step: [],
    material: [],
    tool: [],
    output: [],
    attributeKey: [],
  };
  for (const kind of KINDS) {
    // 既存側: キー → 代表の表記（inventory は頻出順なので最初に出たものが代表）
    const known = new Map<string, string>();
    const exact = new Set<string>();
    for (const name of inventory[kind] ?? []) {
      exact.add(name);
      const k = canonicalLabelKey(name);
      if (k && !known.has(k)) known.set(k, name);
    }
    // 同じ抽出結果の中の揺れ（Calcination と calcination が 1 本のノートに同居）も畳む
    const local = new Map<string, string>();
    for (const name of labels[kind] ?? []) {
      if (exact.has(name)) continue;
      const k = canonicalLabelKey(name);
      const target = (k && (known.get(k) ?? local.get(k))) || null;
      if (target && target !== name) {
        (mapping[kind] ??= {})[name] = target;
        changes.push({ kind, from: name, to: target, via: "spelling" });
        continue;
      }
      if (k && !local.has(k)) local.set(k, name);
      unmatched[kind].push(name);
    }
  }
  return { mapping, changes, unmatched };
}

/** 2 つの寄せ方の表を合成する（後から来た表を優先。A→B と B→C は A→C に畳む） */
export function mergeMappings(a: LabelMapping, b: LabelMapping): LabelMapping {
  const out: LabelMapping = {};
  for (const kind of KINDS) {
    const m: Record<string, string> = { ...(a[kind] ?? {}) };
    for (const [from, to] of Object.entries(b[kind] ?? {})) m[from] = to;
    for (const from of Object.keys(m)) {
      let to = m[from];
      const guard = new Set<string>([from]);
      while (m[to] && !guard.has(to)) {
        guard.add(to);
        to = m[to];
      }
      m[from] = to;
    }
    if (Object.keys(m).length > 0) out[kind] = m;
  }
  return out;
}

/**
 * 寄せ方の表を抽出結果のブロックに当てる（新しい配列を返す。元は書き換えない）。
 * - 手順の見出し（role: procedure の heading）は文字列全体が一致したときだけ置き換える
 * - material / tool / output の span は span の文字列全体が一致したときだけ置き換える
 * - attribute の span はキーの部分だけ置き換え、値はそのまま残す
 */
export function applyLabelMapping(blocks: ProvIngesterBlock[], mapping: LabelMapping): ProvIngesterBlock[] {
  const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const map = (kind: VocabularyKind, s: string | undefined): string | null => {
    const hit = mapping[kind]?.[norm(s)];
    return hit && hit !== norm(s) ? hit : null;
  };
  const walk = (list: ProvIngesterBlock[]): ProvIngesterBlock[] =>
    list.map((b) => {
      const next: ProvIngesterBlock = { ...b };
      if (b.role === "procedure" && b.blockType === "heading") {
        const to = map("step", b.text);
        if (to) next.text = to;
      }
      if (b.content) {
        next.content = b.content.map((sp) => {
          if (sp.role === "material" || sp.role === "tool" || sp.role === "output") {
            const to = map(sp.role, sp.text);
            return to ? { ...sp, text: to } : sp;
          }
          if (sp.role === "attribute") {
            const a = splitAttribute(sp.text);
            const to = a ? map("attributeKey", a.key) : null;
            return a && to ? { ...sp, text: `${to}${a.rest}` } : sp;
          }
          return sp;
        });
      }
      if (b.children) next.children = walk(b.children);
      return next;
    });
  return walk(blocks);
}

/** 2 つの名前一覧を種類ごとに足し合わせる（前の一覧を優先し、重複は落とす） */
export function unionVocabulary(a: ProvVocabulary, b: ProvVocabulary): ProvVocabulary {
  const out = {} as ProvVocabulary;
  for (const kind of KINDS) {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const name of [...(a[kind] ?? []), ...(b[kind] ?? [])]) {
      if (seen.has(name)) continue;
      seen.add(name);
      list.push(name);
    }
    out[kind] = list;
  }
  return out;
}
