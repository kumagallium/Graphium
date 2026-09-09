// カラム化ゾーンの「受け皿」表示
//
// 縦のドロップカーソル（core の DropCursor が描く線）だけだと、Notion 系の
// エディタを知らない人には「線の左右どちらに入るのか」「そもそも何が起きる
// のか」が読み取れない。判定に使ったヒットゾーンそのものを面で描いて、
// 「ここに新しい列ができる」を先に見せる。
//
// 実装方針は [data-cell-drop-box]（セルへの画像ドロップ）と同じ:
//   - ProseMirror の DOM には一切触らない。body 直下の固定配置オーバーレイ
//     （PM は toDOM ノードの DOM を操作中でも差し替えるので、エディタ内の
//      要素に印を付けても消える）
//   - dragover は毎フレーム飛んでくるので、同じ矩形なら書き込まない
//
// 後始末: dragover が来なくなる経路（エディタ外へ出る / ドロップ / ESC で
// キャンセル）を自前で拾う必要があるため、表示中だけ window に capture で
// dragend / drop / dragleave を張る。

import type { ColumnDropZoneRect } from "./drop-to-columns";

let el: HTMLElement | null = null;
let lastKey = "";

function hide() {
  if (!el) return;
  el.style.display = "none";
  lastKey = "";
  window.removeEventListener("dragend", hide, true);
  window.removeEventListener("drop", hide, true);
}

export function showColumnDropZone(rect: ColumnDropZoneRect) {
  const key = `${rect.left},${rect.top},${rect.width},${rect.height}`;
  if (key === lastKey) return; // 毎フレームの同一値書き込みを避ける
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("data-column-drop-zone", "");
    document.body.appendChild(el);
  }
  if (!lastKey) {
    window.addEventListener("dragend", hide, true);
    window.addEventListener("drop", hide, true);
  }
  lastKey = key;
  el.style.display = "block";
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

export function hideColumnDropZone() {
  hide();
}
