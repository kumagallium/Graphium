// ふつうの並べ替え（上下の移動）の横線に「ここに移動」を添える
//
// 横並べ（drop-zone-overlay.ts）・中に入れる（merge-into-text-container.ts）の受け皿には
// 案内の文字があるのに、いちばんよく使う上下の並べ替えは線 1 本だけだった。
// ブロックを掴んで動かしている人に「放すとここに入る」を同じ言葉づかいで見せる。
//
// 線そのものは BlockNote の DropCursor が描く（.prosemirror-dropcursor-block-horizontal）。
// その位置の計算（getBlockDropRect）は公開されていないので、フックが位置を返した直後
// （DropCursor は同じ dragover の中で同期的に線を置く）に線の要素を読んで、その右端に置く。
// 中央や左端に置くと前後のブロックの文字（行頭には必ず文字がある）に重なるので、
// 文字の少ない右端に寄せる。
//
// 出すのはブロックを掴んでいるとき（view.dragging がある）だけ。OS からのファイル投入
// （view.dragging が無い）や文字の選択のドラッグ（線が inline）は対象外。
// 他の受け皿と同じく body 直下の固定配置で、PM の DOM には触らない。

import type { DropCursorOptions } from "@blocknote/core";
import type { EditorView } from "prosemirror-view";
import { t } from "../i18n";

type ComputeDropPosition = NonNullable<
  NonNullable<DropCursorOptions["hooks"]>["computeDropPosition"]
>;
type ComputeDropPositionContext = Parameters<ComputeDropPosition>[0];

const CURSOR_SELECTOR = ".prosemirror-dropcursor-block-horizontal";

let el: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;
let lastKey = "";
let activeView: EditorView | null = null;

function hide() {
  if (!el) return;
  el.style.display = "none";
  lastKey = "";
  activeView = null;
  window.removeEventListener("dragend", hide, true);
  window.removeEventListener("drop", hide, true);
  window.removeEventListener("dragover", onWindowDragOver, true);
}

// エディタの外へ出ると DropCursor は線を消すが、フックは呼ばれないのでここで拾う
function onWindowDragOver(e: DragEvent) {
  if (!activeView) return;
  if (!(e.target instanceof Node) || !activeView.dom.contains(e.target)) hide();
}

function show(view: EditorView, rect: DOMRect) {
  const key = `${Math.round(rect.right)},${Math.round(rect.top)},${Math.round(rect.height)}`;
  if (key === lastKey) return;
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("data-reorder-drop-label", "");
    labelEl = document.createElement("span");
    labelEl.setAttribute("data-drop-zone-label", "");
    el.appendChild(labelEl);
    document.body.appendChild(el);
  }
  if (!lastKey) {
    // 言語はドラッグの途中では変わらないので、出し始めに 1 回だけ書く
    if (labelEl) labelEl.textContent = t("dropHint.moveHere");
    window.addEventListener("dragend", hide, true);
    window.addEventListener("drop", hide, true);
    window.addEventListener("dragover", onWindowDragOver, true);
  }
  lastKey = key;
  activeView = view;
  el.style.display = "block";
  el.style.left = `${rect.right}px`;
  el.style.top = `${rect.top + rect.height / 2}px`;
}

function placeOnCursor(view: EditorView) {
  const parent = view.dom.offsetParent ?? view.dom.parentElement;
  const cursor = parent?.querySelector<HTMLElement>(CURSOR_SELECTOR);
  if (!cursor) {
    hide();
    return;
  }
  const rect = cursor.getBoundingClientRect();
  if (rect.width === 0) {
    hide();
    return;
  }
  show(view, rect);
}

/** DropCursor の computeDropPosition フックを包み、上下の並べ替えの線に案内を添える */
export function withReorderDropLabel(inner: ComputeDropPosition): ComputeDropPosition {
  return (ctx: ComputeDropPositionContext) => {
    const result = inner(ctx);
    if (result?.orientation === "block-horizontal" && ctx.view.dragging) {
      // DropCursor はフックが返った直後に線を置く（または動かす）ので、その後に読む
      const view = ctx.view;
      queueMicrotask(() => placeOnCursor(view));
    } else {
      hide();
    }
    return result;
  };
}

/** テスト用: 表示中の案内の要素 */
export function _reorderDropLabelElement(): HTMLElement | null {
  return el && el.style.display !== "none" ? el : null;
}
