// 一覧の表で「幅が足りないとき、優先度の低い列から隠す」ための純関数
//
// 表は「タイトル列が残りの幅を受け取る」作りなので、固定幅の列の合計が枠に近づくと
// タイトルが 1 行 5 文字ほどまで潰れて何行にも折れる。そこでタイトル列に最小幅を持たせ、
// 枠（表を包む要素）の幅が足りなくなったら、隠す順の先頭の列から 1 つずつ隠す。
// 判定はビューポートではなく枠の幅で行う（サイドバーを畳んだときなど、枠の幅が変わる
// 場面に追従するため）。一覧ビューのサイドピークは一覧の上に重なる fixed のオーバーレイで、
// 枠の幅を変えないので、ピークを開いても列の隠れ方は変わらない（この仕組みの対象外）。
//
// 境目は手で当てずに計算する:
//   必要な幅(k) = 隠せない列の幅の合計（タイトル最小幅を含む）
//               + k 個目以降（まだ見せる）列の幅の合計
//               + スクロールバー分の余裕
//   枠の幅 >= 必要な幅(k) となる最小の k 個を隠す。

/**
 * 従来型スクロールバー（Windows）の幅。縦スクロールが出ると表に使える幅がこの分減るので、
 * 境目にあらかじめ足しておく。枠の幅の測り方（offsetWidth 基準）はスクロールバーの有無で
 * 変わらないため、足しておかないと「隠さないと決めた直後にスクロールバーで足りなくなる」。
 */
export const SCROLLBAR_SLACK = 17;

export interface HideableColumn<K extends string = string> {
  key: K;
  /** 列の幅（px）。表の列の w-[…] と揃える */
  width: number;
}

export interface ColumnPlan<K extends string = string> {
  /** 隠さない列の幅の合計（タイトル列の最小幅を含む） */
  baseWidth: number;
  /** 隠せる列。先頭から先に隠す */
  hideable: readonly HideableColumn<K>[];
}

function sumWidths(cols: readonly HideableColumn[]): number {
  return cols.reduce((sum, c) => sum + c.width, 0);
}

/** 先頭から hiddenCount 個の列を隠したときに必要な枠の幅（スクロールバーの余裕を含む） */
export function requiredWidth(plan: ColumnPlan, hiddenCount: number): number {
  return plan.baseWidth + sumWidths(plan.hideable.slice(hiddenCount)) + SCROLLBAR_SLACK;
}

/**
 * 枠の幅（px）に対して、先頭から何個の列を隠すか。
 * 幅が測れていない（0 以下・NaN）ときは 0（隠さない）。全部隠してもなお足りないときは
 * 全部隠し、あとは表の min-width と外側の横スクロールに任せる。
 */
export function resolveHiddenCount(available: number, plan: ColumnPlan): number {
  if (!(available > 0)) return 0;
  const n = plan.hideable.length;
  for (let k = 0; k <= n; k += 1) {
    if (available >= requiredWidth(plan, k)) return k;
  }
  return n;
}

/** 表の min-width（隠せる列を全部隠した幅）。これより狭い枠は外側の横スクロールに任せる */
export function tableMinWidth(plan: ColumnPlan): number {
  return plan.baseWidth;
}
