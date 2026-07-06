// WKWebView（Tauri デスクトップ / Safari）で、ネストした箇条書きの中で日本語 IME の
// 変換を確定すると、prosemirror-view の readDOMChange が確定コミット時の DOM 再構成を
// 誤解釈し、次のどちらかの壊れ方をする（実機トレースで確定）:
//
//  - 複製: 確定文字が「元ブロック」に入りつつ、直後に同じ確定文字を持つ新規ブロックが
//          もう 1 つ生成される（例: 「だfsf」→「だfsf」「だfsf」の 2 行）
//  - 空行: 元ブロックが空のまま残り、確定文字が直後の新規ブロックに移る
//          （例: 「図が」の前に空の箇条書きが 1 行入る）
//
// どちらも共通して「compositionstart 時点には存在しなかった id のブロックが、
// 元ブロックの直後に 1 つ生成される」。prosemirror-view 1.42.0 でも composition/
// domchange 系のコードは変わっておらず直らない（上流 prosemirror#934 系の未修正バグ）。
//
// この拡張は「変換確定の既知の正しい結果」を自分で復元する:
//  1. compositionstart で対象 textblock（カーソルのある block）の id と、カーソル前後の
//     内容（marks 込み）と、その時点の全 blockContainer id を記録する。
//  2. compositionend の直後（PM の一連の transaction が落ち着いた次 tick）に、対象 block が
//     「前置 + 確定文字 + 後置」になっているか検証する。壊れていれば正しい内容に上書きし、
//     直後にできた「新規 id の余計な block」を削除する。
//
// 誤爆を避けるため、壊れを検出したときだけ dispatch する（正常時は完全に no-op）。
// composition 中に Enter を押した場合（改行を伴う）は対象外にする。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Fragment } from "prosemirror-model";
import { createExtension } from "@blocknote/core";

const pluginKey = new PluginKey("imeCompositionHeal");

type Captured = {
  blockId: string;
  before: Fragment;
  after: Fragment;
  preIds: Set<string>;
  hadEnter: boolean;
};

const tiptapExt = TiptapExtension.create({
  name: "imeCompositionHeal",
  priority: 250,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        view(view) {
          let captured: Captured | null = null;

          // カーソルを含む最も内側の blockContainer とその textblock を返す。
          const findTarget = (state = view.state) => {
            const sel = state.selection;
            const $from = sel.$from;
            if (!$from.parent.isTextblock) return null;
            let bcDepth = -1;
            for (let d = $from.depth; d >= 0; d--) {
              if ($from.node(d).type.name === "blockContainer") {
                bcDepth = d;
                break;
              }
            }
            if (bcDepth < 0) return null;
            const blockId = ($from.node(bcDepth).attrs as { id?: string }).id;
            if (!blockId) return null;
            return { $from, blockId };
          };

          const collectIds = (state = view.state) => {
            const ids = new Set<string>();
            state.doc.descendants((n) => {
              if (n.type.name === "blockContainer") {
                const id = (n.attrs as { id?: string }).id;
                if (id) ids.add(id);
              }
              return true;
            });
            return ids;
          };

          const onCompStart = () => {
            try {
              const state = view.state;
              const t = findTarget(state);
              if (!t) {
                captured = null;
                return;
              }
              const sel = state.selection;
              const tbStart = t.$from.start(); // textblock の inline 内容の先頭
              const tbEnd = t.$from.end();
              const before = state.doc.slice(tbStart, sel.from).content;
              const after = state.doc.slice(sel.to, tbEnd).content;
              captured = {
                blockId: t.blockId,
                before,
                after,
                preIds: collectIds(state),
                hadEnter: false,
              };
            } catch {
              captured = null;
            }
          };

          const onKeyDown = (e: KeyboardEvent) => {
            if (captured && e.key === "Enter") captured.hadEnter = true;
          };

          const onCompEnd = (e: CompositionEvent) => {
            const cap = captured;
            captured = null;
            if (!cap || cap.hadEnter) return;
            const confirmed = e.data ?? "";
            // 描画の直前（requestAnimationFrame）に検証・修復する。
            // setTimeout(0) だと「壊れた状態が 1 フレーム描画されてから直る」ちらつきが
            // 出るため、ブラウザが paint する前のこのフックで直して壊れた状態を見せない。
            requestAnimationFrame(() => heal(cap, confirmed));
          };

          const heal = (cap: Captured, confirmed: string) => {
            try {
              if (view.composing || view.isDestroyed) return;
              const state = view.state;
              const schema = state.schema;

              // 対象 block を id で探す。
              let targetPos: number | null = null;
              let targetNode: import("prosemirror-model").Node | null = null;
              state.doc.descendants((n, pos) => {
                if (targetPos !== null) return false;
                if (
                  n.type.name === "blockContainer" &&
                  (n.attrs as { id?: string }).id === cap.blockId
                ) {
                  targetPos = pos;
                  targetNode = n;
                  return false;
                }
                return true;
              });
              if (targetPos === null || !targetNode) return;
              const tNode = targetNode as import("prosemirror-model").Node;

              const tb = tNode.childCount > 0 ? tNode.child(0) : null;
              if (!tb || !tb.isTextblock) return;
              const tbContentStart = targetPos + 2; // blockContainer(+1) → blockContent(+1)
              const tbContentEnd = tbContentStart + tb.content.size;

              // あるべき内容 = 前置 + 確定文字 + 後置
              const marks = state.storedMarks ?? cap.before.lastChild?.marks ?? [];
              let correct = cap.before;
              if (confirmed) correct = correct.append(Fragment.from(schema.text(confirmed, marks)));
              correct = correct.append(cap.after);

              const contentOk = tb.content.eq(correct);

              // 直後の兄弟が「compositionstart 時に無かった id」なら余計な生成物。
              const $t = state.doc.resolve(targetPos);
              const parent = $t.parent;
              const idx = $t.index();
              let spuriousFrom: number | null = null;
              let spuriousTo: number | null = null;
              if (idx + 1 < parent.childCount) {
                const sib = parent.child(idx + 1);
                const sibId = (sib.attrs as { id?: string }).id;
                if (
                  sib.type.name === "blockContainer" &&
                  sibId &&
                  !cap.preIds.has(sibId)
                ) {
                  spuriousFrom = targetPos + tNode.nodeSize;
                  spuriousTo = spuriousFrom + sib.nodeSize;
                }
              }

              // 正常（内容が正しく、余計な生成物も無い）なら何もしない。
              if (contentOk && spuriousFrom === null) return;

              let tr = state.tr;
              if (!contentOk) {
                tr = tr.replaceWith(tbContentStart, tbContentEnd, correct);
              }
              if (spuriousFrom !== null && spuriousTo !== null) {
                tr = tr.delete(tr.mapping.map(spuriousFrom), tr.mapping.map(spuriousTo));
              }
              // カーソルを確定文字の直後（後置の前）へ。
              // 対象 block とその手前の位置は修復で動かない（内容の in-place 置換と、
              // 対象より後ろの余計 block 削除しかしない）ので tbContentStart は不変。
              // よって mapping せず、新 doc の位置として直接使う。
              const caret = Math.min(
                tbContentStart + cap.before.size + confirmed.length,
                tr.doc.content.size,
              );
              try {
                tr = tr.setSelection(TextSelection.create(tr.doc, caret));
              } catch {
                /* selection 復元に失敗しても内容修復は活かす */
              }
              tr.setMeta("imeCompositionHeal", true);
              tr.setMeta("addToHistory", false);
              view.dispatch(tr);
            } catch {
              /* fail-safe: 何かあれば PM の結果をそのまま残す（正常入力を壊さない） */
            }
          };

          view.dom.addEventListener("compositionstart", onCompStart, true);
          view.dom.addEventListener("keydown", onKeyDown, true);
          view.dom.addEventListener("compositionend", onCompEnd, true);
          return {
            destroy() {
              view.dom.removeEventListener("compositionstart", onCompStart, true);
              view.dom.removeEventListener("keydown", onKeyDown, true);
              view.dom.removeEventListener("compositionend", onCompEnd, true);
            },
          };
        },
      }),
    ];
  },
});

export const imeCompositionHealExtension = createExtension({
  key: "ime-composition-heal",
  tiptapExtensions: [tiptapExt],
});
