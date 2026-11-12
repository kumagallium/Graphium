// 一覧（ノート・ナレッジ）の「参照先」「被参照」の数字
//
// 向きを矢印で添え、つながりの多いページ（参照先 3 以上・被参照 2 以上）だけ色を付ける。
// ノート一覧とナレッジ一覧で同じ見た目にするための部品。0 件のときは何も描かない
// （空の見せ方は表ごとの流儀に合わせるので、呼ぶ側が決める）。

export function LinkCountBadge({ direction, count }: { direction: "outgoing" | "incoming"; count: number }) {
  if (count <= 0) return null;
  const strong = direction === "outgoing" ? count >= 3 : count >= 2;
  const tone = !strong
    ? "text-muted-foreground"
    : direction === "outgoing"
      ? "bg-info-bg text-info font-medium"
      : "bg-label-sample-bg text-label-sample font-medium";
  return (
    <span className={`inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded-full tabular-nums ${tone}`}>
      {direction === "outgoing" ? <>{count} &rarr;</> : <>&larr; {count}</>}
    </span>
  );
}
