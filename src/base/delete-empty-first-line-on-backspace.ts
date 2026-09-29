// 本文の一行目が空の段落のとき、Backspace でその行を消す拡張。
//
// BlockNote の標準 Backspace は「空のブロックを消して前のブロックへ移る」作りで、
// 前のブロックが無い本文の先頭では何もしない。Graphium のタイトル欄は本文の外
// （textarea）にあるので、本文の一行目にできた空行は Backspace では消せず、
// 次の行へ移って Delete するか、選択して消すしかなかった。
//
// ここでは「本文の最上位の 1 つ目・空の段落・後ろに行がある」ときだけ、その行を
// 消してカーソルを次の行の先頭に置く。タイトル欄へは戻さない — 空行が続くときに
// Backspace を連打すると、タイトルの文字まで消してしまうため。
//
// 見出し・箇条書きの空行は標準どおり 1 回目で段落に戻り、2 回目でこの拡張が消す
// （2 行目以降と同じ段取り）。子を持つ場合は、子を一段浮かせて同じ位置に残す
// （標準の空ブロック削除が子を兄弟に上げるのと同じ扱い）。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "prosemirror-state";
import { createExtension, getBlockInfoFromSelection } from "@blocknote/core";

const pluginKey = new PluginKey("deleteEmptyFirstLineOnBackspace");

const tiptapExt = TiptapExtension.create({
  name: "deleteEmptyFirstLineOnBackspace",
  // BlockNote の KeyboardShortcutsExtension（priority 50）より先に評価させる。
  // 対象の条件では標準側は何もしないので、先に取っても標準動作を奪わない。
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

            // 空の段落だけ。見出し・箇条書きなどは標準動作（まず段落に戻す）に任せる
            if (blockContent.node.type.name !== "paragraph") return false;
            if (blockContent.node.childCount !== 0) return false;

            // 本文の最上位の 1 つ目か（doc > blockGroup > blockContainer の先頭）。
            // 入れ子の先頭やカラムの先頭は、標準動作（インデント解除・カラム外へ
            // 出す）に任せる
            const $block = state.doc.resolve(bnBlock.beforePos);
            if ($block.depth !== 1 || $block.parent.type.name !== "blockGroup") return false;
            if ($block.index() !== 0) return false;

            // 後ろに何も無い（ノートがこの 1 行だけ）なら消さない
            if (!childContainer && $block.parent.childCount < 2) return false;

            const tr = state.tr;
            if (childContainer) {
              // 子は一段浮かせて、消す行の位置にそのまま残す
              tr.replaceWith(bnBlock.beforePos, bnBlock.afterPos, childContainer.node.content);
            } else {
              tr.delete(bnBlock.beforePos, bnBlock.afterPos);
            }
            // 新しい一行目の先頭へ。画像など文字の無いブロックならブロックごと選ぶ
            tr.setSelection(Selection.near(tr.doc.resolve(bnBlock.beforePos), 1));

            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

export const deleteEmptyFirstLineOnBackspaceExtension = createExtension({
  key: "delete-empty-first-line-on-backspace",
  tiptapExtensions: [tiptapExt],
});
