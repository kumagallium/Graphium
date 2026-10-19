/**
 * 配置済みノードの重なりを押し離してほぐす（決定的・幾何だけ）。
 *
 * 全体グラフの島配置は、話題だけを物理（fcose）で置き、知見・原料・ノートは
 * 「隣接ノードの平均位置」に幾何で置く。同じ話題群に属する知見は同じ平均点に
 * 落ちるので、8px 刻みの渦でずらしても山になる。拡大しても座標そのものが
 * 重なっているので解けない。ここでは、半径の和＋余白より近いペアを、その
 * 方向に沿って互いに押し離すのを数十回繰り返す。
 *
 * - fixed（留め置き・物理で置いた話題など）は動かさず、相手だけを押す
 * - 位置はほぼ変えない（重なった分だけ動く）ので「近さ＝つながり」の読みは保つ
 * - 格子ハッシュで近傍だけを見るので 1,000 件規模でも軽い
 */
export type OverlapItem = {
  id: string;
  x: number;
  y: number;
  /** 半径（px、モデル座標） */
  r: number;
  /** true なら動かさない */
  fixed?: boolean;
};

export type OverlapOptions = {
  /** ノード間に残す余白（px） */
  gap?: number;
  /** 繰り返しの上限 */
  iterations?: number;
};

export function resolveOverlaps(
  items: readonly OverlapItem[],
  opts: OverlapOptions = {},
): Map<string, { x: number; y: number }> {
  const gap = opts.gap ?? 6;
  const iterations = opts.iterations ?? 300;
  const nodes = items.map((it) => ({ ...it }));
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 2) {
    for (const n of nodes) out.set(n.id, { x: n.x, y: n.y });
    return out;
  }
  const maxR = Math.max(...nodes.map((n) => n.r));
  const cell = Math.max(1, 2 * maxR + gap);
  const key = (cx: number, cy: number) => `${cx}:${cy}`;

  for (let iter = 0; iter < iterations; iter++) {
    // 格子に振り分け
    const grid = new Map<string, number[]>();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const k = key(Math.floor(n.x / cell), Math.floor(n.y / cell));
      const list = grid.get(k);
      if (list) list.push(i);
      else grid.set(k, [i]);
    }
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = grid.get(key(cx + dx, cy + dy));
          if (!list) continue;
          for (const j of list) {
            if (j <= i) continue; // 各ペアは 1 回だけ
            const b = nodes[j];
            if (a.fixed && b.fixed) continue;
            const minDist = a.r + b.r + gap;
            let vx = b.x - a.x;
            let vy = b.y - a.y;
            let dist = Math.hypot(vx, vy);
            if (dist >= minDist) continue;
            if (dist < 1e-6) {
              // 完全に同じ点: id から決まる向きにずらす（決定的に、ペアごとに散らす）
              const angle = hashAngle(a.id + "|" + b.id);
              vx = Math.cos(angle);
              vy = Math.sin(angle);
              dist = 1;
            }
            // 少し余分に押す（1.05）と、押し戻しの往復で収束が早い
            const push = ((minDist - dist) / dist) * 1.05;
            const sx = vx * push;
            const sy = vy * push;
            if (a.fixed) {
              b.x += sx;
              b.y += sy;
            } else if (b.fixed) {
              a.x -= sx;
              a.y -= sy;
            } else {
              a.x -= sx / 2;
              a.y -= sy / 2;
              b.x += sx / 2;
              b.y += sy / 2;
            }
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
  for (const n of nodes) out.set(n.id, { x: n.x, y: n.y });
  return out;
}

/** 文字列から 0〜2π の角度を決める（決定的な散らし用） */
function hashAngle(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 3600) * (Math.PI / 1800);
}

/** 重なっているペアの数（検証用） */
export function countOverlaps(items: readonly OverlapItem[], gap = 0): number {
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + gap - 1e-6) count++;
    }
  }
  return count;
}

/**
 * 島（グループ）を保ったまま重なりをほぐす。
 *
 * 全ノードをまとめて押し離すと、混んだ島ほど外へ広がって隣の島と溶け合い、
 * 全体が 1 つの円盤になる（島配置の意味が消える）。ここでは
 *   1. グループの中だけで resolveOverlaps する（島の中の重なりをほぐす）
 *   2. 各グループを「重心＋外接半径」の円盤とみなし、円盤どうしの重なりを
 *      resolveOverlaps でほぐす（島どうしを離す）
 *   3. 2 の移動量で、グループのメンバーを丸ごと平行移動する（島の形は保つ）
 * の 3 段で行う。fixed を含むグループは円盤ごと動かさない。
 * groupOf が undefined を返すノードは、それぞれ 1 ノードのグループとして扱う。
 */
export function resolveGroupedOverlaps(
  items: readonly OverlapItem[],
  groupOf: (id: string) => string | undefined,
  opts: OverlapOptions & { islandGap?: number } = {},
): Map<string, { x: number; y: number }> {
  const groups = new Map<string, OverlapItem[]>();
  for (const it of items) {
    const key = groupOf(it.id) ?? `~${it.id}`;
    const list = groups.get(key);
    if (list) list.push(it);
    else groups.set(key, [it]);
  }
  // 1) 島の中
  const pos = new Map<string, { x: number; y: number }>();
  for (const members of groups.values()) {
    for (const [id, p] of resolveOverlaps(members, opts)) pos.set(id, p);
  }
  // 2) 島どうし（円盤）
  const discs: OverlapItem[] = [];
  for (const [key, members] of groups) {
    const cx = members.reduce((s, m) => s + pos.get(m.id)!.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + pos.get(m.id)!.y, 0) / members.length;
    let r = 0;
    for (const m of members) {
      const p = pos.get(m.id)!;
      r = Math.max(r, Math.hypot(p.x - cx, p.y - cy) + m.r);
    }
    discs.push({ id: key, x: cx, y: cy, r, fixed: members.some((m) => m.fixed) });
  }
  const discPos = resolveOverlaps(discs, { gap: opts.islandGap ?? 24, iterations: opts.iterations });
  // 3) 平行移動
  for (const d of discs) {
    const np = discPos.get(d.id)!;
    const dx = np.x - d.x;
    const dy = np.y - d.y;
    if (dx === 0 && dy === 0) continue;
    for (const m of groups.get(d.id)!) {
      if (m.fixed) continue;
      const p = pos.get(m.id)!;
      pos.set(m.id, { x: p.x + dx, y: p.y + dy });
    }
  }
  return pos;
}
