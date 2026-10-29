// スラッシュメニューの項目を「既定 + 追加」から 1 本の並びにする純関数（editor.tsx が使う）。
//
// BlockNote の SuggestionMenu はグループが切り替わる所に見出しを描くだけなので、同じグループの
// 項目が離れて並ぶと見出しが二度出る。ここでグループ単位にまとめる。
// グループの並びは groupOrder に挙がったものを先頭からその順に、挙がっていないものは
// 最初に現れた順で後ろに続ける。グループの中の順序は渡された順のまま
// （Array.prototype.sort は安定ソート）。

export type MergeableSlashItem = { title: string; group?: string };

export function mergeSlashMenuItems<T extends MergeableSlashItem>(
  defaults: readonly T[],
  extras: readonly T[],
  groupOrder: readonly string[] = [],
): T[] {
  const combined = [...defaults, ...extras];
  // 同じ題名 + グループは 1 つにする（既定と追加で重なったときは既定を残す）
  const seen = new Set<string>();
  const unique = combined.filter((item) => {
    const key = `${item.title}|${item.group ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const order: string[] = [...groupOrder];
  for (const item of unique) {
    const g = item.group ?? "";
    if (!order.includes(g)) order.push(g);
  }
  return unique.sort(
    (a, b) => order.indexOf(a.group ?? "") - order.indexOf(b.group ?? ""),
  );
}
