// HTML5 ドラッグセッションの監視
//
// WKWebView ではドラッグ中のイベント配送と invoke 応答が同じプロセス間通信路を
// 通る。ドラッグ中に大きな転送（画像の読み戻し・OCR ワーカーの起動）を始めると
// 通信路が宙吊りになり UI 全体が固まる事例があったため、「今ドラッグ中か」を
// ここで一元管理し、重い処理の開始をドラッグ終了まで遅らせる。

/** dragend が失われた場合（ドラッグ元要素の DOM 消滅など）に備えた待機上限 */
const FAILSAFE_MS = 10_000;

let dragging = false;
let waiters: Array<() => void> = [];

function settle() {
  dragging = false;
  const ws = waiters;
  waiters = [];
  for (const w of ws) w();
}

// capture で購読: エディタ・素材パネルなどアプリ内のあらゆるドラッグを拾う。
// 保守的に「どこかでドラッグ中なら待つ」side に倒す
if (typeof window !== "undefined") {
  window.addEventListener("dragstart", () => {
    dragging = true;
  }, true);
  window.addEventListener("dragend", settle, true);
  window.addEventListener("drop", settle, true);
}

export function isDragActive(): boolean {
  return dragging;
}

/** ドラッグ中なら終了（drop / dragend）まで待つ。上限つきで永久には待たない */
export function waitForDragIdle(): Promise<void> {
  if (!dragging) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== done);
      resolve();
    }, FAILSAFE_MS);
    waiters.push(done);
  });
}
