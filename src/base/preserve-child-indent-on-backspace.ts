// 「子を持つ空の list item で Backspace」を押した時、
// その list item だけを削除して、子要素のインデント階層を保つ拡張。
//
// BlockNote の標準 Backspace は、空ブロック + 子要素ありのケースで
// 子要素を現在ブロックの「兄弟階層」に挿入してから現在ブロックを削除する
// （= 子のインデントが 1 段下がる）。
// ノートの執筆中、ある行だけ消したいケースで「下のぶら下がりが全部
// 浮き上がる」のは直感に反するため、Graphium ではこのケースだけ、
// 子要素を **前の兄弟ブロックの子** として付け替える挙動に置き換える。
//
// 前の兄弟ブロックが存在しない（自分が先頭の子）など、ぶら下げ先が
// 自然に決まらないケースは BlockNote 標準動作に流す（false を返す）。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import {
  createExtension,
  getBlockInfoFromResolvedPos,
  getBlockInfoFromSelection,
} from "@blocknote/core";

const pluginKey = new PluginKey("preserveChildIndentOnBackspace");

const tiptapExt = TiptapExtension.create({
  name: "preserveChildIndentOnBackspace",
  // BlockNote の KeyboardShortcutsExtension は priority 50。
  // それより高い priority の ProseMirror plugin が先に handleKeyDown を
  // 評価するので、200 にして標準 Backspace を上書きできるようにする。
  priority: 200,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Backspace") return false;
            // IME 変換中の Backspace は IME 側で文字を消す動作。乗っ取らない。
            if (event.isComposing || event.keyCode === 229) return false;

            const { state } = view;
            if (!state.selection.empty) return false;

            const blockInfo = getBlockInfoFromSelection(state);
            if (!blockInfo.isBlockContainer) return false;

            const { bnBlock, blockContent, childContainer } = blockInfo;

            // このカスタム動作の対象は「中身が空 + 子要素あり」だけ。
            // 中身が残っているケースは「行内の文字を消す」操作なので
            // 標準動作（前の文字を消す）に流す。
            if (blockContent.node.childCount !== 0) return false;
            if (!childContainer) return false;

            // カーソルがブロック先頭でない場合は標準動作
            if (state.selection.from !== blockContent.beforePos + 1) {
              return false;
            }

            // 前の兄弟ブロックを取得（同じ親 blockGroup 内の 1 つ前）
            const $pos = state.doc.resolve(bnBlock.beforePos);
            const indexInParent = $pos.index();
            if (indexInParent === 0) {
              // 自分が先頭の子。ぶら下げ先になる兄が無いので
              // 標準動作（liftListItem 等）に任せる。
              return false;
            }
            const prevBlockBeforePos = $pos.posAtIndex(indexInParent - 1);
            const prevBlockInfo = getBlockInfoFromResolvedPos(
              state.doc.resolve(prevBlockBeforePos),
            );
            if (!prevBlockInfo.isBlockContainer) return false;

            // ぶら下げ先の blockGroup（無ければ作る）に挿入してから現在ブロックを削除。
            // 現在ブロックは前の兄弟より後ろの position なので、
            // 先に delete しても prev 系の position はずれない。
            const childContent = childContainer.node.content;
            const tr = state.tr;
            tr.delete(bnBlock.beforePos, bnBlock.afterPos);

            if (prevBlockInfo.childContainer) {
              // 既存の blockGroup の末尾子の直後に挿入
              const insertPos = prevBlockInfo.childContainer.afterPos - 1;
              tr.insert(insertPos, childContent);
            } else {
              // 前の兄弟に blockGroup が無いので新規作成して bnBlock の末尾に挿入
              const blockGroupType = state.schema.nodes.blockGroup;
              if (!blockGroupType) return false;
              const newGroup = blockGroupType.create(null, childContent);
              const insertPos = prevBlockInfo.bnBlock.afterPos - 1;
              tr.insert(insertPos, newGroup);
            }

            // カーソルを前の兄弟の本文末尾に置く（連続 Backspace で自然に消せるように）
            const selectionPos = prevBlockInfo.blockContent.afterPos - 1;
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(selectionPos), -1),
            );

            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

export const preserveChildIndentOnBackspaceExtension = createExtension({
  key: "preserve-child-indent-on-backspace",
  tiptapExtensions: [tiptapExt],
});
