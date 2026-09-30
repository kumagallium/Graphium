// 画像ブロックをドラッグするときの縮小ゴースト（小さな分身）
//
// 画像ブロックの選択ドラッグは、既定だと画像の実寸ゴーストが出る（幅いっぱいの
// 画像だと画面を覆い、どこに落ちるのか分からなくなる）。小さな分身に差し替える。
//
// 守ること（破るとデスクトップ版＝WKWebView で画像だけドラッグできなくなる）:
//   - **dragstart の中で DOM を追加しない** — Chromium はドラッグを中止する。
//     body 直下に 1 個だけ常設する
//   - **表示範囲の外に置かない** — setDragImage に渡す要素は文書の表示範囲内に
//     ないと、WebKit はドラッグ用の画像を作れない（BlockNote の .bn-drag-preview
//     と同じく左上に置き、opacity をごく小さくして見えなくする。0 にすると
//     ドラッグ画像まで消える）。以前は top/left -1000px に置いていて、画像だけ
//     ドロップ位置の表示が出ず動かせない・入力が止まる不具合になった
//   - **dragstart の瞬間に src を差し替えない** — 読み込みが間に合わず空の画像を
//     渡すことになる。mousedown（掴んだ瞬間）で先に差し替えておき、dragstart では
//     読み込み済みのときだけ使う。間に合わなければ既定のゴーストのまま続ける

let dragGhost: HTMLImageElement | null = null;

function ensureDragGhost(): HTMLImageElement {
  if (dragGhost?.isConnected) return dragGhost;
  const img = document.createElement("img");
  img.setAttribute("data-drag-ghost", "true");
  img.setAttribute("aria-hidden", "true");
  img.alt = "";
  img.style.cssText =
    "position:fixed;top:0;left:0;width:120px;height:auto;opacity:0.001;z-index:-1;pointer-events:none;";
  document.body.appendChild(img);
  dragGhost = img;
  return img;
}

/** 掴んだ瞬間（mousedown）に呼ぶ。ドラッグが始まる前に分身の画像を読み込ませる */
export function primeDragGhost(src: string | null | undefined): void {
  if (!src) return;
  try {
    const ghost = ensureDragGhost();
    if (ghost.src !== src) ghost.src = src;
  } catch {
    // ゴーストは見た目だけ。失敗しても既定表示で続ける
  }
}

/**
 * dragstart から呼ぶ。src の分身が読み込み済みならドラッグ画像に差し替えて true。
 * 未準備（先回りの読み込みが間に合っていない等）なら何もせず false。
 */
export function applyDragGhost(dataTransfer: DataTransfer | null | undefined, src: string): boolean {
  if (!dataTransfer || !src) return false;
  const ghost = dragGhost?.isConnected ? dragGhost : null;
  if (!ghost || ghost.src !== src || !ghost.complete || ghost.naturalWidth === 0) return false;
  try {
    dataTransfer.setDragImage(ghost, 24, 24);
    return true;
  } catch {
    return false;
  }
}
