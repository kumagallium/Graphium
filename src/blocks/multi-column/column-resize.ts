// カラム境界のドラッグで隣接 2 カラムの幅比率（width prop）を変更する拡張。
//
// 仕組み:
// - カラム間の gap（.gph-column-list の column-gap）±数 px を「境界ヒット領域」とし、
//   mousemove でヒット中は columnList に .gph-col-resize-hover クラスを付けて
//   cursor: col-resize を出す（CSS は app.css 側）
// - mousedown で境界を掴んだらドラッグ開始。ドラッグ中は隣接 2 カラムの
//   flex-grow を DOM に直接書いてライブプレビューし、mouseup で
//   ProseMirror トランザクション 1 回（setNodeMarkup ×2）として確定する。
//   1 トランザクションなので undo も 1 回で戻る。
// - タッチは対象外（モバイル・狭幅では CSS の flex-wrap で縦積みになる）。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createExtension } from "@blocknote/core";

const pluginKey = new PluginKey("columnResize");

// 境界ヒット領域の半径（px）。gap 8px + 余裕。
const HIT_RADIUS = 6;
// カラムの最小幅比率（合計に対する割合ではなく flex-grow の下限）
const MIN_WIDTH = 0.2;

type Boundary = {
  /** 境界の左側カラムの DOM 要素 */
  left: HTMLElement;
  /** 境界の右側カラムの DOM 要素 */
  right: HTMLElement;
  list: HTMLElement;
};

/** clientX/Y がカラム境界（gap）上にあるか判定し、隣接カラムを返す */
function hitTestBoundary(view: EditorView, event: MouseEvent): Boundary | null {
  const target = event.target as HTMLElement | null;
  if (!target) return null;
  const list = target.closest<HTMLElement>('[data-node-type="columnList"]');
  if (!list || !view.dom.contains(list)) return null;

  // columnList 直下の column 要素を左から順に見て、
  // 「このカラムの右端」と「次のカラムの左端」の間（gap）に clientX があるか
  const columns = Array.from(
    list.querySelectorAll<HTMLElement>(':scope > [data-node-type="column"]'),
  );
  for (let i = 0; i < columns.length - 1; i++) {
    const rightEdge = columns[i].getBoundingClientRect().right;
    const nextLeftEdge = columns[i + 1].getBoundingClientRect().left;
    if (
      event.clientX >= rightEdge - HIT_RADIUS &&
      event.clientX <= nextLeftEdge + HIT_RADIUS
    ) {
      return { left: columns[i], right: columns[i + 1], list };
    }
  }
  return null;
}

/** DOM のカラム要素から PM ドキュメント上の位置を得る */
function findColumnPos(view: EditorView, dom: HTMLElement): number | null {
  try {
    // posAtDOM は要素「内」の位置を返すので -1 して要素自身の位置にする
    const inside = view.posAtDOM(dom, 0);
    const $pos = view.state.doc.resolve(inside);
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === "column") {
        return $pos.before(d);
      }
    }
  } catch {
    /* DOM が既にドキュメント外の場合など */
  }
  return null;
}

const tiptapExt = TiptapExtension.create({
  name: "columnResize",
  addProseMirrorPlugins() {
    let dragging: {
      boundary: Boundary;
      startX: number;
      leftStart: number; // flex-grow 開始値
      rightStart: number;
      leftPx: number; // ドラッグ開始時のピクセル幅
      rightPx: number;
    } | null = null;
    let hoverList: HTMLElement | null = null;

    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (dragging) return false; // ドラッグ中は document リスナーが処理
              const hit = view.editable ? hitTestBoundary(view, event) : null;
              const list = hit?.list ?? null;
              if (hoverList && hoverList !== list) {
                hoverList.classList.remove("gph-col-resize-hover");
              }
              if (list) list.classList.add("gph-col-resize-hover");
              hoverList = list;
              return false;
            },
            mousedown(view, event) {
              if (!view.editable || event.button !== 0) return false;
              const boundary = hitTestBoundary(view, event);
              if (!boundary) return false;

              const leftRect = boundary.left.getBoundingClientRect();
              const rightRect = boundary.right.getBoundingClientRect();
              dragging = {
                boundary,
                startX: event.clientX,
                leftStart: parseFloat(boundary.left.style.flexGrow || "1") || 1,
                rightStart: parseFloat(boundary.right.style.flexGrow || "1") || 1,
                leftPx: leftRect.width,
                rightPx: rightRect.width,
              };
              boundary.list.classList.add("gph-col-resizing");

              const onMove = (e: MouseEvent) => {
                if (!dragging) return;
                const dx = e.clientX - dragging.startX;
                // ピクセル幅の増減を flex-grow 比率に換算する。
                // 2 カラム合計の grow / 合計 px = 単位 px あたりの grow
                const totalGrow = dragging.leftStart + dragging.rightStart;
                const totalPx = dragging.leftPx + dragging.rightPx;
                if (totalPx <= 0) return;
                const growPerPx = totalGrow / totalPx;
                let newLeft = dragging.leftStart + dx * growPerPx;
                let newRight = dragging.rightStart - dx * growPerPx;
                if (newLeft < MIN_WIDTH) {
                  newRight -= MIN_WIDTH - newLeft;
                  newLeft = MIN_WIDTH;
                }
                if (newRight < MIN_WIDTH) {
                  newLeft -= MIN_WIDTH - newRight;
                  newRight = MIN_WIDTH;
                }
                dragging.boundary.left.style.flexGrow = String(newLeft);
                dragging.boundary.right.style.flexGrow = String(newRight);
              };

              const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                if (!dragging) return;
                const { boundary } = dragging;
                boundary.list.classList.remove("gph-col-resizing");

                const newLeft = parseFloat(boundary.left.style.flexGrow || "1") || 1;
                const newRight = parseFloat(boundary.right.style.flexGrow || "1") || 1;
                const leftPos = findColumnPos(view, boundary.left);
                const rightPos = findColumnPos(view, boundary.right);
                dragging = null;
                if (leftPos == null || rightPos == null) return;

                // 1 トランザクションで両カラムの width を確定（undo 1 回で戻せる）
                const { tr, doc } = view.state;
                const leftNode = doc.nodeAt(leftPos);
                const rightNode = doc.nodeAt(rightPos);
                if (leftNode?.type.name !== "column" || rightNode?.type.name !== "column") {
                  return;
                }
                tr.setNodeMarkup(leftPos, undefined, {
                  ...leftNode.attrs,
                  width: newLeft,
                });
                tr.setNodeMarkup(rightPos, undefined, {
                  ...rightNode.attrs,
                  width: newRight,
                });
                view.dispatch(tr);
              };

              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
              event.preventDefault();
              return true;
            },
          },
        },
        view() {
          return {
            destroy() {
              hoverList?.classList.remove("gph-col-resize-hover");
              hoverList = null;
              dragging = null;
            },
          };
        },
      }),
    ];
  },
});

export const columnResizeExtension = createExtension({
  key: "columnResize",
  tiptapExtensions: [tiptapExt],
});
