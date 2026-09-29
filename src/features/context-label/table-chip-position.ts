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
