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

// 測った縦横比を url ごとに覚えておく。
// BlockNote 0.47 は node view の update を実装しておらず、リサイズ確定・寄せ・
// キャプションなど updateBlock のたびに画像ブロックの DOM を作り直す。作り直し直後は
// img に src が無く（resolveFileUrl の then で非同期に入る）変数も無いので、何も
// しないと load までの間だけ上限なしの幅で見えて、そのあと縮む。前回の比率を
// render の直後に同期で置いて、その 1 フレームをなくす。
// 同じ url なら同じ画像なので比率は変わらない。差し替わっていても load で測り直して
// 上書きする。件数は上限つき（古い順に捨てる）。
const RATIO_CACHE_LIMIT = 500;
const ratioCache = new Map<string, number>();

function rememberRatio(key: string, ratio: number | null): void {
  if (!key) return;
  if (ratio === null) {
    ratioCache.delete(key);
    return;
  }
  // 再挿入して「最近使った」順に保つ
  ratioCache.delete(key);
  ratioCache.set(key, ratio);
  if (ratioCache.size > RATIO_CACHE_LIMIT) {
    const oldest = ratioCache.keys().next().value;
    if (oldest !== undefined) ratioCache.delete(oldest);
  }
}

/** テスト用: 覚えた縦横比を捨てる */
export function resetImageAspectCache(): void {
  ratioCache.clear();
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
 * - cacheKey（ブロックの url）を渡すと、測った比率を覚え、DOM の作り直しの直後に
 *   同期で置く（上のキャッシュの説明を参照）。
 * - 変数が無い間は CSS 側のフォールバックで上限が効かない（app.css 参照）。
 * - リスナーは img / 層 2 自身に付けるだけ。要素ごと破棄されれば一緒に消えるので、
 *   destroy での後始末は要らない。
 */
export function trackImageAspectRatio(root: HTMLElement | DocumentFragment, cacheKey = ""): void {
  if (typeof root.querySelector !== "function") return;
  const wrapper = root.querySelector<HTMLElement>(".bn-file-block-content-wrapper");
  const img = root.querySelector<HTMLImageElement>("img.bn-visual-media");
  if (!wrapper || !img) return;

  const apply = () => {
    const ratio = imageAspectRatio(img);
    rememberRatio(cacheKey, ratio);
    if (ratio === null) wrapper.style.removeProperty(IMAGE_ASPECT_VAR);
    else wrapper.style.setProperty(IMAGE_ASPECT_VAR, String(ratio));
  };

  // 作り直された直後は、前回測った比率を先に置く（load で正しい値に置き換わる）
  const remembered = cacheKey ? ratioCache.get(cacheKey) : undefined;
  if (remembered !== undefined) wrapper.style.setProperty(IMAGE_ASPECT_VAR, String(remembered));

  img.addEventListener("load", apply);
  img.addEventListener("error", apply);
  // すでに読み込み済み（キャッシュ等）なら load は来ない
  if (img.complete && img.naturalWidth > 0) apply();
}

// ---- 大きさを決めた画像は高さの上限を外す ----
//
// 上限（画面の高さの 1/2）は「挿入したまま」の画像だけに掛ける。端をつまんで大きさを
// 決めた画像（BlockNote の previewWidth がある）は、本文の幅いっぱいまで自由に大きくできる。
// 層 2 の最大幅の式は var(--graphium-image-cap, var(--graphium-image-max-h)) を使う
// （app.css）。大きさを決めた画像だけ、層 2 に --graphium-image-cap を inline で置き、
// 祖先の --graphium-image-max-h-sized（画面では実質無制限、用紙の中・印刷では 150mm）を指す。
// inline の var() は層 2 自身の祖先の値で解決されるので、印刷ルートや用紙の中でも効く。

/** 層 2 に置く CSS 変数名（app.css と揃える） */
export const IMAGE_CAP_VAR = "--graphium-image-cap";
const IMAGE_CAP_SIZED = "var(--graphium-image-max-h-sized)";

/**
 * 画像ブロックの描画結果に、「大きさを決めたか」に応じた上限の切り替えを置く。
 *
 * - previewWidth があれば、描画の時点で層 2 に上限の差し替えを置く（DOM の作り直しでも
 *   render が呼ばれるたびに付く）。
 * - previewWidth が無ければ、端のハンドルを押した時点で上限を外す。BlockNote のリサイズは
 *   ドラッグ中に層 2 の style.width を書き換えるだけなので、上限が効いたままだと広がらない。
 *   離して previewWidth が確定すればブロックごと作り直されて上の規則に移る。確定しなかった
 *   （動かさずに離した）ときは元に戻す。
 * - ハンドルは hover のたびに BlockNote が付け外しするので、リスナーは層 2 で拾う
 *   （バブリング）。BlockNote 自身のハンドラが先に層 2 の clientWidth を読んで基準幅を
 *   決めるので、上限を外すのはその後になる。外すと幅が fit-content で跳ねるので、
 *   いまの幅を style.width に固定してから外す。
 */
export function trackImageSizing(root: HTMLElement | DocumentFragment, previewWidth: unknown): void {
  if (typeof root.querySelector !== "function") return;
  const wrapper = root.querySelector<HTMLElement>(".bn-file-block-content-wrapper");
  if (!wrapper) return;

  if (typeof previewWidth === "number" && previewWidth > 0) {
    wrapper.style.setProperty(IMAGE_CAP_VAR, IMAGE_CAP_SIZED);
    return;
  }

  const onHandleDown = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".bn-resize-handle")) return;
    if (wrapper.style.getPropertyValue(IMAGE_CAP_VAR)) return; // ドラッグ中の二重押下

    const prevWidth = wrapper.style.width;
    const fixedWidth = `${wrapper.getBoundingClientRect().width}px`;
    wrapper.style.width = fixedWidth;
    wrapper.style.setProperty(IMAGE_CAP_VAR, IMAGE_CAP_SIZED);

    const onRelease = () => {
      window.removeEventListener("mouseup", onRelease);
      window.removeEventListener("touchend", onRelease);
      window.removeEventListener("touchcancel", onRelease);
      // BlockNote の mouseup（先に登録済み）が updateBlock で DOM を作り直していれば
      // 層 2 は切り離されている。残っている = 確定しなかったので元に戻す。
      setTimeout(() => {
        if (!wrapper.isConnected) return;
        wrapper.style.removeProperty(IMAGE_CAP_VAR);
        if (wrapper.style.width === fixedWidth) wrapper.style.width = prevWidth;
      }, 0);
    };
    window.addEventListener("mouseup", onRelease);
    window.addEventListener("touchend", onRelease);
    window.addEventListener("touchcancel", onRelease);
  };
  wrapper.addEventListener("mousedown", onHandleDown);
  wrapper.addEventListener("touchstart", onHandleDown);
}
