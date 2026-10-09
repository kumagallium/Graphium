// 段組みの 2 段目以降の先頭で Backspace を押したとき、段を前の段へ寄せる拡張。
//
// BlockNote 0.47 の KeyboardShortcutsExtension は「列の 1 つ目のブロックの先頭で
// Backspace → 前の列の末尾へ移す」分岐を持つ（KeyboardShortcutsExtension.ts 185〜210 行付近）。
// ところが、ブロックを消して fixColumnList（空の列の削除・列が 1 つなら段組みの解除）を
// 走らせた後に、走らせる前の位置へ挿入するので、段組みが解除される・後ろにブロックが
// あるといった場合に RangeError で落ちる。コマンドが落ちると何も起きないので、
// 利用者からは「2 段目で Backspace を押しても段が消えない」に見える。
//
// ここでは同じ状況（段落・空の選択・キャレットが先頭・2 段目以降の列の 1 つ目）を先に取り、
// 段組み全体を 1 回で組み直す。
// - 空の段落（子なし）: その行を消す。キャレットは前の段の末尾へ
// - それ以外: 前の段の末尾へ移す。キャレットは移したブロックの先頭へ
// どちらも、空になった列は消し、列が 1 つになったら段組みを解いて中身を本文へ戻す。
//
// 1 段目の先頭（段組みの上へ出す）・見出しなど段落以外（まず段落に戻す）は BlockNote に任せる。
// 上流が直したらこの拡張は外してよい。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { createExtension, getBlockInfoFromSelection } from "@blocknote/core";

const pluginKey = new PluginKey("mergeColumnOnBackspace");

/** 2 段目以降の列の先頭での Backspace を組み直した Transaction を返す。対象外なら null（純関数） */
export function buildColumnBackspaceTr(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return null;

  const blockInfo = getBlockInfoFromSelection(state);
  if (!blockInfo.isBlockContainer) return null;
  const { bnBlock, blockContent, childContainer } = blockInfo;

  // 段落以外は BlockNote が先に段落へ戻すので任せる
  if (blockContent.node.type.name !== "paragraph") return null;
  if (selection.from !== blockContent.beforePos + 1) return null;

  // 列の 1 つ目のブロックで、その列が 2 段目以降か
  const $block = state.doc.resolve(bnBlock.beforePos);
  if ($block.parent.type.name !== "column" || $block.index() !== 0) return null;
  const columnList = $block.node($block.depth - 1);
  if (columnList.type.name !== "columnList") return null;
  const columnIndex = $block.index($block.depth - 1);
  if (columnIndex < 1) return null;

  const columnListPos = $block.before($block.depth - 1);
  const isEmptyLine = blockContent.node.childCount === 0 && !childContainer;

  // 組み直した列（子のない列は後で除く）
  const columns: PMNode[] = [];
  columnList.forEach((col) => columns.push(col));
  const current = columns[columnIndex];
  const prev = columns[columnIndex - 1];
  const rest: PMNode[] = [];
  current.forEach((b, _o, i) => {
    if (i > 0) rest.push(b);
  });
  columns[columnIndex] = current.copy(Fragment.from(rest));
  if (!isEmptyLine) {
    columns[columnIndex - 1] = prev.copy(prev.content.addToEnd(bnBlock.node));
  }
  const kept = columns.filter((c) => c.childCount > 0);
  const prevKeptIndex = kept.indexOf(columns[columnIndex - 1]);

  // 列が 1 つになったら段組みを解き、その列の中身を本文へ戻す
  const unwrap = kept.length < 2;
  const replacement = unwrap
    ? kept[0].content
    : Fragment.from(columnList.copy(Fragment.from(kept)));

  const tr = state.tr.replaceWith(columnListPos, columnListPos + columnList.nodeSize, replacement);

  // 前の段の中身が本文のどこから始まるか
  let prevStart = unwrap ? columnListPos : columnListPos + 1;
  if (!unwrap) {
    for (let i = 0; i < prevKeptIndex; i++) prevStart += kept[i].nodeSize;
    prevStart += 1; // column の開き
  }
  const prevContent = columns[columnIndex - 1].content;

  if (isEmptyLine) {
    // 消した行の前（前の段の最後）の末尾へ
    const end = prevStart + prevContent.size;
    tr.setSelection(Selection.near(tr.doc.resolve(end), -1));
  } else {
    // 移したブロックの先頭へ（blockContainer と blockContent の開きの内側）
    const movedPos = prevStart + prevContent.size - bnBlock.node.nodeSize;
    tr.setSelection(TextSelection.near(tr.doc.resolve(movedPos + 2)));
  }
  return tr.scrollIntoView();
}

const tiptapExt = TiptapExtension.create({
  name: "mergeColumnOnBackspace",
  // BlockNote の KeyboardShortcutsExtension（priority 50）より先に評価させる。
  priority: 200,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Backspace") return false;
            // IME 変換中の Backspace は IME 側の動作。乗っ取らない
            if (event.isComposing || event.keyCode === 229) return false;
            if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;

            const tr = buildColumnBackspaceTr(view.state);
            if (!tr) return false;
            // 入力ルール直後の Backspace は、BlockNote と同じく変換の取り消しを優先する
            if (editor.commands.undoInputRule()) return true;
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

export const mergeColumnOnBackspaceExtension = createExtension({
  key: "merge-column-on-backspace",
  tiptapExtensions: [tiptapExt],
});
