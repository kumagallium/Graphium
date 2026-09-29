// 画像ブロックの「高さの上限」に使う縦横比（幅 ÷ 高さ）を測って、CSS 変数に載せる。
//
// 高さの上限は CSS だけでは掛けられない。img に max-height を掛けると、幅が 100% の
// まま高さだけ切られて縦に潰れるか、リサイズハンドル・選択枠・リサイズの基準幅が
// 見た目の画像からずれる（BlockNote のリサイズは層 2 の clientWidth が基準）。
// そこで「層 2（.bn-file-block-content-wrapper）の最大幅 = 高さ上限 × 縦横比」にする。
// img は width: 100% のままなので縦横比は保たれ、層 2 自体が縮むので、ハンドル・
// 選択枠・キャプション幅・リサイズの基準幅がすべて見た目と一致する。
// CSS 側は app.css の「画像ブロックの高さ上限」を参照。
//
// 縦横比は画像を読み込むまで分からない。BlockNote は src を resolveFileUrl の後で
// 非同期に入れるので、描画の時点では寸法が無く、img の load を待つ。

/** 層 2 に置く CSS 変数名（app.css と揃える） */
export const IMAGE_ASPECT_VAR = "--graphium-image-ar";

// 極端な縦横比の丸め。
// - 下限: 幅 1px・高さ 1000px のような画像で「上限 × 縦横比」が 0.4px になり、
//   画像がほぼ見えなくなるのを防ぐ。代わりに極端な縦長だけ、上限を最大 2 倍まで
//   超えて表示される（幅が 0.1 × 上限を下回らない）。
// - 上限: 横長側は min(100%, …) の 100% が勝つので実質効かない。値を有限に保つだけ。
const MIN_ASPECT = 0.1;
const MAX_ASPECT = 100;

/**
 * 画像の寸法から縦横比（幅 ÷ 高さ）を求める。
 * 寸法が無い・0・非有限のときは null（= 上限を掛けない）。
 */
export function computeAspectRatio(width: number, height: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const ratio = width / height;
  if (!Number.isFinite(ratio)) return null;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, ratio));
}

/** img の現在の寸法から縦横比を求める（読み込み前・失敗時は null） */
function imageAspectRatio(img: HTMLImageElement): number | null {
  return computeAspectRatio(img.naturalWidth, img.naturalHeight);
}

/**
 * 画像ブロックの描画結果に、縦横比を層 2 の CSS 変数として追従させる。
 *
 * - 層 2（.bn-file-block-content-wrapper）は BlockNote が作ったブロックの外側 DOM。
 *   ProseMirror が管理する編集可能な中身ではないので style を書いてよい。
 * - img が読み込み済みならその場で、まだなら load で設定する。src が後から変わって
 *   再び load したときは測り直す。読み込み失敗（error）では変数を外して上限を掛けない。
 * - 変数が無い間は CSS 側のフォールバックで上限が効かない（app.css 参照）。
 * - リスナーは img / 層 2 自身に付けるだけ。要素ごと破棄されれば一緒に消えるので、
 *   destroy での後始末は要らない。
 */
export function trackImageAspectRatio(root: HTMLElement | DocumentFragment): void {
  if (typeof root.querySelector !== "function") return;
  const wrapper = root.querySelector<HTMLElement>(".bn-file-block-content-wrapper");
  const img = root.querySelector<HTMLImageElement>("img.bn-visual-media");
  if (!wrapper || !img) return;

  const apply = () => {
    const ratio = imageAspectRatio(img);
    if (ratio === null) wrapper.style.removeProperty(IMAGE_ASPECT_VAR);
    else wrapper.style.setProperty(IMAGE_ASPECT_VAR, String(ratio));
  };

  img.addEventListener("load", apply);
  img.addEventListener("error", apply);
  // すでに読み込み済み（キャッシュ等）なら load は来ない
  if (img.complete && img.naturalWidth > 0) apply();
}
