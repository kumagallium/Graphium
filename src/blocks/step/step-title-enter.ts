// step タイトルでの Enter を「ステップの中身へ入る」動作にする
//
// BlockNote の既定 Enter はブロック分割で、step タイトルで押すと step ノードが
// 分割されて **カードの外**（次の兄弟）に新しいブロックができてしまう。
// タイトルは「見出し → その中身」という文脈なので、Enter では
// カーソル以降のタイトル文字列を先頭の子ブロック（paragraph）として
// blockGroup の先頭に差し込み、そこへカーソルを移す（Notion のトグルと同じ流儀）。
//
// PM ツリー: blockContainer > step(タイトル inline) + blockGroup(子ブロック)?
// blockGroup は子が無いと存在しないので、その場合はここで作る。
//
// IME: 確定 Enter は ime-confirm-enter-guard（priority 300）が先に握るため、
// この拡張は priority 200 でその後ろ・BlockNote 既定（100）の前に置く。
// view.composing / isComposing のガードも重ねる。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { createExtension } from "@blocknote/core";

const pluginKey = new PluginKey("stepTitleEnter");

const tiptapExt = TiptapExtension.create({
  name: "stepTitleEnter",
  priority: 200,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Enter") return false;
            // Shift+Enter はタイトル内ソフト改行、Mod+Enter は既定に委ねる
            if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
              return false;
            }
            if (view.composing || event.isComposing) return false;

            // 矢印キー直後の Enter では、ProseMirror の selection 同期
            // （selectionchange 経由・非同期）が済んでおらず state.selection が
            // 1 手古いことがある（inline-label/shortcuts.ts と同じ罠）。
            // 保留分を flush してから最新 state で判定する。
            try {
              (view as any).domObserver?.flush?.();
            } catch {
              /* PM 内部 API のため念のため握りつぶす */
            }

            const { state } = view;
            const { $from, $to } = state.selection;
            if ($from.parent.type?.name !== "step") return false;
            // タイトルをまたがない範囲選択のみ扱う（跨ぐ選択は既定に委ねる）
            if (!$from.sameParent($to)) return false;

            const containerDepth = $from.depth - 1;
            const container = $from.node(containerDepth);
            if (container?.type?.name !== "blockContainer") return false;

            const stepEnd = $from.end($from.depth);
            const selFrom = $from.pos;
            const selTo = $to.pos;

            // カーソル（選択終端）以降のタイトル残りを子 paragraph に持っていく
            const tail = state.doc.slice(selTo, stepEnd).content;
            const schema = state.schema;
            const paragraph = schema.nodes.paragraph.createAndFill(
              null,
              tail.size ? tail : undefined,
            );
            if (!paragraph) return false;
            const bc = schema.nodes.blockContainer.createAndFill(null, paragraph);
            if (!bc) return false;

            const tr = state.tr;
            if (selFrom < stepEnd) tr.delete(selFrom, stepEnd);
            // 削除後、step ノードは selFrom で閉じる → その直後の位置
            const posAfterStep = selFrom + 1;

            const hasGroup =
              container.childCount > 1 &&
              container.child(1).type?.name === "blockGroup";
            if (hasGroup) {
              // 既存 blockGroup の先頭に差し込む
              tr.insert(posAfterStep + 1, bc);
            } else {
              // 子が無い step: blockGroup ごと作る
              const group = schema.nodes.blockGroup?.createAndFill(null, bc);
              if (!group) return false;
              tr.insert(posAfterStep, group);
            }
            // どちらの分岐でも新 paragraph の本文開始位置は posAfterStep + 3
            // （blockGroup/bc の開きトークンを 2 つ + paragraph の開き 1 つ…
            //   hasGroup 分岐は挿入起点が +1 なので bc(+1) + paragraph(+1) で同じ）
            const caret = TextSelection.near(tr.doc.resolve(posAfterStep + 3), 1);
            tr.setSelection(caret).scrollIntoView();
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

export const stepTitleEnterExtension = createExtension({
  key: "step-title-enter",
  tiptapExtensions: [tiptapExt],
});
