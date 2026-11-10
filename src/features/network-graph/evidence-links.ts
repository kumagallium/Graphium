// チャットの横のグラフで「根拠のつながり」（緑の線）を引く線を決める。
//
// 両端とも AI が触れた（使った・読んだ）ページの線に加えて、中継を挟む線も引く。
// 中継 = AI は触れていないが、触れたページ 2 つ以上とつながるページ。実データでは
// 知見（ナレッジのページ）は出典（論文・データのノート）にだけつながり、知見どうしは
// 直接つながらない。触れたページ同士の線だけだと、知見を集めて答えた会話で線が 1 本も
// 引けず、光も走らない。同じ出典から出た知見を出典ごしに結ぶことで、どの出典で根拠が
// まとまっているかが見える。

/** 中継のページ（触れていないが、触れたページ 2 つ以上と隣り合う）の ID */
export function evidenceRelays(
  nodeIds: Iterable<string>,
  neighbors: (id: string) => Iterable<string>,
  isTouched: (id: string) => boolean,
): Set<string> {
  const relays = new Set<string>();
  for (const id of nodeIds) {
    if (isTouched(id)) continue;
    let k = 0;
    for (const m of neighbors(id)) {
      if (isTouched(m) && ++k >= 2) break;
    }
    if (k >= 2) relays.add(id);
  }
  return relays;
}

/** 根拠のつながりとして引く線か。触れたページ同士、または触れたページと中継の線（中継どうしは引かない） */
export function isEvidenceLink(
  source: string,
  target: string,
  isTouched: (id: string) => boolean,
  relays: ReadonlySet<string>,
): boolean {
  const s = isTouched(source);
  const t = isTouched(target);
  if (s && t) return true;
  return (s && relays.has(target)) || (t && relays.has(source));
}
