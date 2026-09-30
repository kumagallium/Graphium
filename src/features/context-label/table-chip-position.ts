// テーブルのラベルチップの横位置（純関数）。
//
// チップは「表の右端に右揃え」で置くのが設計。ただし表が狭いと、左上の
// 「表 N ⤢」（名前の行）とチップが同じ行を取り合って重なる。表が十分広いときは
// 従来の位置のまま、狭いときだけ名前の行の右隣まで押し出す。
// DOM は測らない（測定は prov-indicator が行い、ここへ数値で渡す）。

/** 名前の行とチップの間の隙間（px） */
export const TABLE_CHIP_CAPTION_GAP = 6;

export type TableChipRightInput = {
  /** 表の左端（ビューポート座標） */
  tableLeft: number;
  /** 表の右端（ビューポート座標。横スクロール中はクランプ済みの値） */
  tableRight: number;
  /** 名前の行の実幅。名前の行が描かれていない・測れないときは null */
  captionWidth: number | null;
  /** チップ自身の実幅。まだ描かれていない・測れないときは null */
  chipWidth: number | null;
  gap?: number;
};

/**
 * チップの右端の x 座標。
 * `max(表の右端, 名前の行の右端 + 隙間 + チップの幅)`。
 * 名前の行かチップの幅が取れないときは、従来どおり表の右端。
 */
export function resolveTableChipRight({
  tableLeft,
  tableRight,
  captionWidth,
  chipWidth,
  gap = TABLE_CHIP_CAPTION_GAP,
}: TableChipRightInput): number {
  if (
    captionWidth == null ||
    chipWidth == null ||
    !(captionWidth > 0) ||
    !(chipWidth > 0)
  ) {
    return tableRight;
  }
  return Math.max(tableRight, tableLeft + captionWidth + gap + chipWidth);
}

/** チップを 2 段目に積むときの、名前の行からの持ち上げ量（px）。
 * 表の上余白の予約（caption-layer の margin-top: 26px = 名前の行 1 行分）と同じ値 */
export const TABLE_CHIP_STACK_OFFSET = 26;

/** チップの右端を、入れ物の右端から何 px 内側で止めるか */
export const TABLE_CHIP_CONTAINER_INSET = 4;

export type TableChipPlacement = {
  /** チップの右端の x 座標 */
  right: number;
  /** true: 名前の行の右隣に置けないので、名前の行の上（2 段目）に積む */
  stacked: boolean;
};

/**
 * チップの置き場所（右端 + 段）。
 *
 * `resolveTableChipRight` は表が狭いとチップを名前の行の右隣へ押し出すが、その先に上限が
 * 無く、ステップのカードの中の狭い表ではカードの右の罫線より外へ出てしまう。
 * 押し出した右端が入れ物の右端（maxRight。カード・ブロックグループの内側）を超えるときは、
 * 右隣に置くのをやめ、名前の行の上（2 段目）へ積む。
 *
 * 2 段目を選ぶ理由: 表ブロックの上には、名前の行の上余白（caption-layer が入れる margin-top
 * 26px）が既に 1 行分ある。ラベル付きの表ではその下に名前の行とチップの行（padding-top
 * 26px、data-block-label-space）があるので、上の 1 行分は空いていて、予約を増やさずに使える。
 * 表の右端に右揃えで別の 2 段目を作る案は、その分の余白を新たに予約する必要がある。
 *
 * 2 段目の右端は「表の右端。ただし表の左端からチップ 1 つ分は右（表より狭い表で
 * 左へはみ出さない）。かつ maxRight まで」。押し出しが起きない（従来どおりの）ときは
 * 今までと同じ位置・同じ段。
 */
export function resolveTableChipPlacement(
  input: TableChipRightInput & {
    /** 入れ物の右端の上限。取れないときは null（上限なし = 従来どおり） */
    maxRight?: number | null;
  }
): TableChipPlacement {
  const { maxRight = null, ...rest } = input;
  const right = resolveTableChipRight(rest);
  // 押し出しが起きていない、または上限内に収まる
  if (right <= rest.tableRight || maxRight == null || right <= maxRight) {
    return { right, stacked: false };
  }
  const chipWidth = rest.chipWidth ?? 0;
  const anchored = Math.max(rest.tableRight, rest.tableLeft + chipWidth);
  return { right: Math.min(anchored, maxRight), stacked: true };
}
