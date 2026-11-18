// calc の書き戻し宣言を、データ表の「計算列」として読む
//
// 本文の表では calc の書き戻し（⇥）はセルに値を書く。データ表はセルを持たない
// （行は素材のまま）ので、同じ宣言（tableMetaStore.calcWritebacks）を**表示の列**
// として横に足すだけにする。式は calc に見えたまま、素材もノートの行も変わらない。
// 式を消せば列も消える。
//
// 純関数だけを置く。データ表の描画・チャートの読み取り・calc の列公開が同じ結果を
// 使えるように、ここ 1 箇所で「どの列をどう足すか」を決める。

import type { DataTableData } from "./data";

export type LinkedColumn = {
  /** 列名（calc の書き戻し先として選んだ名前） */
  name: string;
  /** データ行ごとの文字列。行数より短い分は空になる */
  texts: string[];
  /** 出所の calc ブロックの名前（バッジ表示用。無名なら undefined） */
  calcName?: string;
};

/** ストアの書き戻し宣言から、このデータ表宛ての列を文書順で集める。同名は先勝ち */
export function linkedColumnsFor(
  blockId: string,
  calcWritebacks: Record<string, unknown[]> | null | undefined,
): LinkedColumn[] {
  const out: LinkedColumn[] = [];
  const seen = new Set<string>();
  for (const requests of Object.values(calcWritebacks ?? {})) {
    for (const raw of requests ?? []) {
      const r = raw as { tableBlockId?: unknown; column?: unknown; texts?: unknown; calcName?: unknown };
      if (!r || r.tableBlockId !== blockId) continue;
      if (typeof r.column !== "string" || !Array.isArray(r.texts)) continue;
      const name = r.column.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        texts: r.texts.map((t) => (t == null ? "" : String(t))),
        ...(typeof r.calcName === "string" && r.calcName ? { calcName: r.calcName } : {}),
      });
    }
  }
  return out;
}

/**
 * 素材の表に計算列を足す。素材に同名の列があれば、その計算列は足さない
 * （素材の列は書き換えない、が原則。名前が被ったら素材が勝つ）。
 * 戻り値の linked は実際に足した列（表示のバッジと列数の計算に使う）。
 */
export function mergeLinkedColumns(
  data: DataTableData | null,
  linked: LinkedColumn[],
): { data: DataTableData; linked: LinkedColumn[] } | null {
  if (!data) return null;
  const fresh = linked.filter((l) => !data.headers.includes(l.name));
  if (fresh.length === 0) return { data, linked: [] };
  return {
    data: {
      headers: [...data.headers, ...fresh.map((l) => l.name)],
      rows: data.rows.map((row, i) => [...row, ...fresh.map((l) => l.texts[i] ?? "")]),
    },
    linked: fresh,
  };
}

// ── 同じ入力なら同じ結果オブジェクトを返す版 ──
//
// mergeLinkedColumns は呼ぶたびに全行を作り直す。チャートは本文を編集するたびに表を引き直す
// ので、そのたびに新しい行の配列になると、数値化と描き直しの「前回と同じ」の判定が効かない
// （計算列つきのデータ表を参照するチャートだけが、1 文字ごとに重くなる）。
// 素材の表（data の同一性）と計算列（列名と texts の中身）が前回と同じなら、前回の結果を返す。
// mergeLinkedColumns 自体のふるまいは変えない

type MergeResult = { data: DataTableData; linked: LinkedColumn[] } | null;

const mergeCache = new WeakMap<DataTableData, Array<{ linked: LinkedColumn[]; result: MergeResult }>>();
/** 1 つの素材の表に対して覚える組み合わせの数（複数のチャート・表が別の計算列で引く分） */
const MERGE_CACHE_PER_DATA = 4;

function sameTexts(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameLinked(a: LinkedColumn[], b: LinkedColumn[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((col, i) => col.name === b[i].name && col.calcName === b[i].calcName && sameTexts(col.texts, b[i].texts));
}

export function mergeLinkedColumnsCached(data: DataTableData | null, linked: LinkedColumn[]): MergeResult {
  if (!data) return null;
  const entries = mergeCache.get(data) ?? [];
  const hit = entries.find((e) => sameLinked(e.linked, linked));
  if (hit) return hit.result;
  const result = mergeLinkedColumns(data, linked);
  mergeCache.set(data, [{ linked, result }, ...entries].slice(0, MERGE_CACHE_PER_DATA));
  return result;
}
