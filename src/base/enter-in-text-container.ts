// 引用・Callout の中の Enter を「ブロック内の改行」にする拡張
//
// BlockNote の既定では Enter は新しいブロックを作るので、引用・Callout の中で
// 改行しようとするとブロックの外に出てしまう（改行は Shift+Enter）。
// 引用・Callout は複数行を書く入れ物なので、Enter を改行（hardBreak）にし、
// 抜けるときは箇条書きと同じ感覚にする:
//   - 文字の途中・末尾で Enter          → 改行
//   - 最後の空の行で Enter              → その空行を消して、下に新しい段落を作る
//   - 中身が空のブロックで Enter        → ふつうの段落に戻す（空の箇条書きと同じ）
// Shift+Enter は今までどおり改行（BlockNote の既定）。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { createExtension } from "@blocknote/core";
import { MERGE_TARGET_TYPES } from "./merge-into-text-container";

const pluginKey = new PluginKey("enterInTextContainer");

export type EnterAction = "break" | "exit" | "unwrap";

/** Enter を押したときにすること。引用・Callout の外なら null（既定の処理に任せる） */
export function enterActionFor(state: EditorState): EnterAction | null {
  const { $from, $to, empty } = state.selection;
  const parent = $from.parent;
  if (!MERGE_TARGET_TYPES.has(parent.type.name) || $to.parent !== parent) return null;
  if (!empty) return "break"; // 選択範囲は改行で置き換える
  if (parent.content.size === 0) return "unwrap";
  const atEnd = $from.parentOffset === parent.content.size;
  if (atEnd && $from.nodeBefore?.type.name === "hardBreak") return "exit";
  return "break";
}

const tiptapExt = TiptapExtension.create({
  name: "enterInTextContainer",
  // BlockNote の KeyboardShortcuts（priority 50）より先に評価させる。
  // IME の確定 Enter は imeConfirmEnterGuard（300）が先に消費する
  priority: 200,
  addProseMirrorPlugins() {
    const editor = (this.options as { editor: any }).editor;
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleKeyDown: (view, event) => {
            if (event.key !== "Enter") return false;
            if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
            if (event.isComposing || event.keyCode === 229) return false;
            const action = enterActionFor(view.state);
            if (!action) return false;

            if (action === "break") {
              const { state } = view;
              const marks = state.storedMarks ?? state.selection.$from.marks();
              const tr = state.tr.replaceSelectionWith(state.schema.nodes.hardBreak.create(), false);
              tr.ensureMarks(marks);
              view.dispatch(tr.scrollIntoView());
              return true;
            }

            const blockId = view.state.selection.$from.node(-1)?.attrs?.id;
            if (typeof blockId !== "string") return false;

            if (action === "unwrap") {
              editor.updateBlock(blockId, { type: "paragraph", props: {} });
              editor.setTextCursorPosition(blockId, "start");
              return true;
            }

            // exit: 末尾の空行（最後の hardBreak）を消して、下に段落を作る
            editor.transact((tr: any) => {
              const pos = tr.selection.from;
              tr.delete(pos - 1, pos);
              const [inserted] = editor.insertBlocks([{ type: "paragraph" }], blockId, "after");
              editor.setTextCursorPosition(inserted.id, "start");
            });
            return true;
          },
        },
      }),
    ];
  },
});

export const enterInTextContainerExtension = createExtension(({ editor }) => ({
  key: "enterInTextContainer",
  tiptapExtensions: [tiptapExt.configure({ editor })],
}));
