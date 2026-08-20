// 既存ノートの PROV ラベル語彙を集める。
//
// ingester は毎回ゼロから命名するので、同じ「プラネタリーボールミル」でも
// ノートごとに表記が揺れ、ラベルが際限なく増えていく。取り込みの前に
// 「この書庫で既に使われている名前」を渡し、概念が一致するならそれを
// 使い回させる。
//
// 語彙はノートインデックス（inlineLabels / steps）から作る。インデックスは
// 既にこの情報を持っているので、スキーマの変更は要らない。
//
// prompt に載せる量は書庫の規模と無関係に一定にする（頻出順に切る）。
// ノートが 1,000 件になっても送る量は変わらない。

import type { NoteIndexEntry } from "../navigation/index-file";

export type ProvVocabulary = {
  step: string[];
  material: string[];
  tool: string[];
  output: string[];
  /** パラメータは `key: value` の key だけ。値（300 rpm 等）は語彙ではない */
  attributeKey: string[];
};

export type VocabularyKind = keyof ProvVocabulary;

/** 種類ごとの上限。名前は 40 件、パラメータキーは 30 件 */
const LIMITS: Record<VocabularyKind, number> = {
  step: 40,
  material: 40,
  tool: 40,
  output: 40,
  attributeKey: 30,
};

/** ラベルとして扱う文字数の上限（これを超えるものは散文の断片とみなして捨てる） */
const MAX_LABEL_LENGTH = 40;

/** prompt に載せる語彙ブロック全体の文字数上限 */
export const VOCABULARY_CHAR_BUDGET = 4000;

const EMPTY: ProvVocabulary = { step: [], material: [], tool: [], output: [], attributeKey: [] };

/** `rpm: 300` → `rpm`。キーが無ければ null（activity-graph-adapter の splitAttrLabel と同じ規則） */
function attributeKeyOf(label: string): string | null {
  const m = label.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
  return m ? m[1].trim() : null;
}

function normalize(text: string): string | null {
  const s = text.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s || s.length > MAX_LABEL_LENGTH) return null;
  // 数字・記号だけの断片はラベルではない
  if (!/[\p{L}]/u.test(s)) return null;
  return s;
}

type Counter = Map<string, { surface: string; count: number }>;

function bump(counter: Counter, raw: string) {
  const s = normalize(raw);
  if (!s) return;
  const key = s.toLowerCase();
  const hit = counter.get(key);
  if (hit) hit.count += 1;
  else counter.set(key, { surface: s, count: 1 });
}

function top(counter: Counter, limit: number): string[] {
  return [...counter.values()]
    .sort((a, b) => b.count - a.count || a.surface.localeCompare(b.surface))
    .slice(0, limit)
    .map((e) => e.surface);
}

/**
 * ノートインデックスから PROV ラベル語彙を集める。
 * ゴミ箱・アーカイブのノートは数えない（消したはずの名前が復活するのを防ぐ）。
 */
export function collectLabelVocabulary(notes: NoteIndexEntry[] | null | undefined): ProvVocabulary {
  if (!notes || notes.length === 0) return EMPTY;

  const counters: Record<VocabularyKind, Counter> = {
    step: new Map(),
    material: new Map(),
    tool: new Map(),
    output: new Map(),
    attributeKey: new Map(),
  };

  for (const note of notes) {
    if (note.deletedAt || note.archivedAt) continue;
    for (const s of note.steps ?? []) bump(counters.step, s.text ?? "");
    for (const il of note.inlineLabels ?? []) {
      if (il.label === "attribute") {
        const key = attributeKeyOf(il.text ?? "");
        if (key) bump(counters.attributeKey, key);
      } else if (il.label === "material" || il.label === "tool" || il.label === "output") {
        bump(counters[il.label], il.text ?? "");
      }
    }
  }

  return {
    step: top(counters.step, LIMITS.step),
    material: top(counters.material, LIMITS.material),
    tool: top(counters.tool, LIMITS.tool),
    output: top(counters.output, LIMITS.output),
    attributeKey: top(counters.attributeKey, LIMITS.attributeKey),
  };
}

/** 語彙が空（＝取り込みが初めて）かどうか */
export function isVocabularyEmpty(v: ProvVocabulary | null | undefined): boolean {
  if (!v) return true;
  return (
    v.step.length === 0 &&
    v.material.length === 0 &&
    v.tool.length === 0 &&
    v.output.length === 0 &&
    v.attributeKey.length === 0
  );
}
