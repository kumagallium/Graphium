// 段組み（columnList）の隣の段落で、文字の Backspace / Delete がブロックを
// 動かしてしまう BlockNote の不具合を避ける拡張。
//
// BlockNote 0.47 の KeyboardShortcutsExtension は、
// - Backspace: 「前の兄弟が columnList なら、現在のブロックを最後の列の末尾へ移す」
//   （KeyboardShortcutsExtension.ts 155〜181 行付近）
// - Delete: 「次の兄弟が columnList なら、最初の列の 1 つ目を引き出す」
//   （同 443〜475 行付近）
// という分岐を持つが、どちらも「選択が空で、キャレットがブロックの先頭（末尾）」
// を確かめていない。そのため、段組みの直後の段落で文字の途中・末尾から Backspace を
// 押すと 1 文字も消えずに段落ごと列へ吸い込まれ、押し続けると列が解消されて中の画像が
// 消えていく（Delete は鏡像で、段組みの直前の段落から列のブロックが引き出される）。
//
// ここでは「文字を消すだけでよい状況」に限って true を返し、BlockNote の keymap を
// 飛ばす。true は PM のキー処理を止めるだけで preventDefault はしないので、ブラウザ
// 標準の 1 文字削除がそのまま働く。キャレットが先頭（末尾）のときは今までどおり
// BlockNote の処理に流す（列へ移す・merge・前の内容なしブロックの削除など）。
//
// 上流が直したらこの拡張は外してよい。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { createExtension, getBlockInfoFromSelection } from "@blocknote/core";

const pluginKey = new PluginKey("keepTextDeleteBesideColumnList");

/** Backspace / Delete が「ブラウザ標準の文字削除」で済む状況かどうか（純関数） */
export function shouldLetBrowserDeleteText(
  state: EditorState,
  key: string,
): boolean {
  if (key !== "Backspace" && key !== "Delete") return false;
  if (!state.selection.empty) return false;

  const blockInfo = getBlockInfoFromSelection(state);
  if (!blockInfo.isBlockContainer) return false;
  const { bnBlock, blockContent } = blockInfo;
  const caret = state.selection.from;

  if (key === "Backspace") {
    // キャレットが先頭なら BlockNote の処理（列へ移す等）に任せる
    if (caret === blockContent.beforePos + 1) return false;
    return state.doc.resolve(bnBlock.beforePos).nodeBefore?.type.name === "columnList";
  }

  // Delete: キャレットが末尾なら BlockNote の処理に任せる
  if (caret === blockContent.afterPos - 1) return false;
  return state.doc.resolve(bnBlock.afterPos).nodeAfter?.type.name === "columnList";
}

const tiptapExt = TiptapExtension.create({
  name: "keepTextDeleteBesideColumnList",
  // BlockNote の KeyboardShortcutsExtension（priority 50）より先に評価させる。
  priority: 200,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleDOMEvents: {
            keydown: (view, event) => {
              // IME 変換中の削除は IME 側の動作。触らない
              if (event.isComposing || event.keyCode === 229) return false;
              // 単語削除（Option+Backspace 等）は別の確かめが要るので標準に任せる
              if (event.ctrlKey || event.metaKey || event.altKey) return false;
              return shouldLetBrowserDeleteText(view.state, event.key);
            },
          },
        },
      }),
    ];
  },
});

export const keepTextDeleteBesideColumnListExtension = createExtension({
  key: "keep-text-delete-beside-column-list",
  tiptapExtensions: [tiptapExt],
});
