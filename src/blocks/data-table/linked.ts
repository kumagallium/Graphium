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
