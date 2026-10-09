// 段組みの段の境目で Backspace / Delete を押したとき、隣の段の行を寄せる拡張。
//
// BlockNote 0.47 の KeyboardShortcutsExtension は、
// - Backspace: 「列の 1 つ目のブロックの先頭 → 前の列の末尾へ移す」（185〜210 行付近）
// - Delete: 「列の最後のブロックの末尾 → 次の列の 1 つ目を引き寄せる」（480〜530 行付近）
// という分岐を持つ。どちらもブロックを消して fixColumnList（空の列の削除・列が 1 つなら
// 段組みの解除）を走らせた後に、走らせる前の位置へ挿入する。そのため段組みが解除される
// 場合などに RangeError で落ちて何も起きない（「2 段目で Backspace しても段が消えない」）か、
// 位置がずれて段組みの後ろの行よりさらに下へ挿入され、行の順序が崩れる。
//
// ここでは同じ状況を先に取り、段組み全体を 1 回の replaceWith で組み直す。
// - Backspace（2 段目以降の列の先頭・段落）: 空の段落（子なし）はその行を消し、キャレットは
//   前の段の末尾へ。それ以外は前の段の末尾へ移し、キャレットは移したブロックの先頭へ
// - Delete（最後の列以外の列の末尾・子なし）: 次の段の 1 つ目が空の段落（子なし）なら消し、
//   それ以外は今の段の末尾へ引き寄せる。キャレットはその場に残す
// どちらも、空になった列は消し、列が 1 つになったら段組みを解いて中身を本文へ戻す。
//
// 1 段目の先頭の Backspace（段組みの上へ出す）・最後の段の末尾の Delete（段組みの後ろの行を
// 引き込む）・見出しなど段落以外の Backspace（まず段落に戻す）は BlockNote に任せる。
// 上流が直したらこの拡張は外してよい。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { createExtension, getBlockInfoFromSelection } from "@blocknote/core";

const pluginKey = new PluginKey("mergeColumnAtEdge");

/** 空の段落（子なし）か。寄せる代わりに消す対象 */
function isEmptyLine(block: PMNode): boolean {
  return block.childCount === 1 && block.firstChild!.type.name === "paragraph" && block.firstChild!.childCount === 0;
}

/**
 * 段組みを columns（列ごとの組み直し後の中身）で置き換える。子のない列は消し、
 * 列が 1 つになったら段組みを解く。columnStart(i) は columns[i] の中身が新しい本文で
 * 始まる位置（消えた列は null）
 */
function replaceColumns(
  state: EditorState,
  columnListPos: number,
  columnList: PMNode,
  columns: PMNode[],
): { tr: Transaction; columnStart: (i: number) => number | null } {
  const kept = columns.filter((c) => c.childCount > 0);
  const unwrap = kept.length < 2;
  const replacement = unwrap ? kept[0].content : Fragment.from(columnList.copy(Fragment.from(kept)));
  const tr = state.tr.replaceWith(columnListPos, columnListPos + columnList.nodeSize, replacement);

  const columnStart = (i: number) => {
    const index = kept.indexOf(columns[i]);
    if (index < 0) return null;
    if (unwrap) return columnListPos;
    let pos = columnListPos + 1; // columnList の開き
    for (let j = 0; j < index; j++) pos += kept[j].nodeSize;
    return pos + 1; // column の開き
  };
  return { tr, columnStart };
}

/** Backspace / Delete を段の境目で組み直した Transaction を返す。対象外なら null（純関数） */
export function buildColumnEdgeTr(state: EditorState, key: "Backspace" | "Delete"): Transaction | null {
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return null;

  const blockInfo = getBlockInfoFromSelection(state);
  if (!blockInfo.isBlockContainer) return null;
  const { bnBlock, blockContent, childContainer } = blockInfo;
  if (blockContent.node.type.spec.content !== "inline*") return null;

  const $block = state.doc.resolve(bnBlock.beforePos);
  if ($block.parent.type.name !== "column") return null;
  const columnList = $block.node($block.depth - 1);
  if (columnList.type.name !== "columnList") return null;
  const columnListPos = $block.before($block.depth - 1);
  const columnIndex = $block.index($block.depth - 1);

  const columns: PMNode[] = [];
  columnList.forEach((col) => columns.push(col));
  const current = columns[columnIndex];

  if (key === "Backspace") {
    // 段落以外は BlockNote が先に段落へ戻すので任せる
    if (blockContent.node.type.name !== "paragraph") return null;
    if (selection.from !== blockContent.beforePos + 1) return null;
    // 2 段目以降の列の 1 つ目
    if ($block.index() !== 0 || columnIndex < 1) return null;

    const prev = columns[columnIndex - 1];
    const drop = isEmptyLine(bnBlock.node);
    columns[columnIndex] = current.copy(current.content.cut(bnBlock.node.nodeSize));
    if (!drop) columns[columnIndex - 1] = prev.copy(prev.content.addToEnd(bnBlock.node));

    const { tr, columnStart } = replaceColumns(state, columnListPos, columnList, columns);
    const prevEnd = columnStart(columnIndex - 1)! + columns[columnIndex - 1].content.size;
    if (drop) {
      // 消した行の前（前の段の最後）の末尾へ
      tr.setSelection(Selection.near(tr.doc.resolve(prevEnd), -1));
    } else {
      // 移したブロックの先頭へ（blockContainer と blockContent の開きの内側）
      tr.setSelection(TextSelection.near(tr.doc.resolve(prevEnd - bnBlock.node.nodeSize + 2)));
    }
    return tr.scrollIntoView();
  }

  // Delete: 子を持つブロックは BlockNote が先に子を引き上げるので任せる
  if (childContainer) return null;
  if (selection.from !== blockContent.afterPos - 1) return null;
  // 最後の列以外の列の、最後のブロック
  if ($block.index() !== current.childCount - 1 || columnIndex >= columns.length - 1) return null;

  const next = columns[columnIndex + 1];
  const pulled = next.firstChild!;
  // 今の段の中でのキャレットの位置（今の段は末尾に足すだけなので、組み直し後も同じ）
  const caretInColumn = selection.from - $block.start();
  columns[columnIndex + 1] = next.copy(next.content.cut(pulled.nodeSize));
  if (!isEmptyLine(pulled)) columns[columnIndex] = current.copy(current.content.addToEnd(pulled));

  const { tr, columnStart } = replaceColumns(state, columnListPos, columnList, columns);
  tr.setSelection(TextSelection.create(tr.doc, columnStart(columnIndex)! + caretInColumn));
  return tr.scrollIntoView();
}

const tiptapExt = TiptapExtension.create({
  name: "mergeColumnAtEdge",
  // BlockNote の KeyboardShortcutsExtension（priority 50）より先に評価させる。
  priority: 200,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Backspace" && event.key !== "Delete") return false;
            // IME 変換中の削除は IME 側の動作。乗っ取らない
            if (event.isComposing || event.keyCode === 229) return false;
            if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;

            const tr = buildColumnEdgeTr(view.state, event.key);
            if (!tr) return false;
            // 入力ルール直後の Backspace は、BlockNote と同じく変換の取り消しを優先する
            if (event.key === "Backspace" && editor.commands.undoInputRule()) return true;
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

export const mergeColumnAtEdgeExtension = createExtension({
  key: "merge-column-at-edge",
  tiptapExtensions: [tiptapExt],
});
