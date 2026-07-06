// WKWebView/Safari の IME 変換確定は compositionend → keydown(Enter, isComposing=false)
// の順で届き、確定 Enter が「普通の Enter」に見える（詳細: src/lib/ime-enter.ts）。
//
// prosemirror-view にも同趣旨のガード（inOrNearComposition）があるが、
// (1) event.preventDefault() を呼ばないため WebKit 側の既定動作（段落分割）は素通しになり、
// (2) BlockNote の Enter keymap（split / hardBreak / liftListItem）自体は
//     composition ガードを一切持たない。
// ネスト箇条書きでは確定コミットの DOM 変異が blockContainer 入れ子の外側に及び、
// 素通しした Enter と噛み合って「文字の複製 + 余計な改行」になる
// （デスクトップ実機で報告。浅いリストでは変異が単一 <p> 内に収まるため発症しにくい）。
//
// この拡張は handleDOMEvents.keydown（prosemirror-view の組み込みハンドラより先に
// 評価される）で確定 Enter を preventDefault + 消費し、keymap にもエンジンにも
// 届かせない。確定文字列は compositionend 時点でコミット済みなので、この Enter を
// no-op にするのが正しい挙動。誤爆しても「窓内の Enter を 1 回無視する」だけで、
// 50ms 窓の外の通常 Enter には影響しない。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { createExtension } from "@blocknote/core";
import { isWebKitConfirmEnter } from "../lib/ime-enter";

const pluginKey = new PluginKey("imeConfirmEnterGuard");

const tiptapExt = TiptapExtension.create({
  name: "imeConfirmEnterGuard",
  // 他の keymap 系（BlockNote KeyboardShortcuts=50, preserveChildIndent=200）より
  // 先に評価されるよう最上位に置く。
  priority: 300,
  addProseMirrorPlugins() {
    // composition 追跡はエディタごと（この関数はエディタ生成ごとに呼ばれる）。
    let composing = false;
    let lastCompositionEndAt = 0;
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleDOMEvents: {
            // 観測のみ（false を返して prosemirror-view の composition 処理は
            // そのまま走らせる）。
            compositionstart: () => {
              composing = true;
              return false;
            },
            compositionend: () => {
              composing = false;
              lastCompositionEndAt = Date.now();
              return false;
            },
            keydown: (_view, event) => {
              // 変換中のキー（Chrome 順: keyCode 229 / isComposing=true）はここでは
              // 触らない — prosemirror-view の composition 帳簿付けに任せる。
              // 消費してよいのは WebKit 順の確定 Enter だけ。
              if (
                isWebKitConfirmEnter({
                  isEnter: event.key === "Enter",
                  composingNow: composing,
                  isComposing: event.isComposing,
                  keyCode: event.keyCode,
                  msSinceCompositionEnd: Date.now() - lastCompositionEndAt,
                })
              ) {
                event.preventDefault();
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

export const imeConfirmEnterGuardExtension = createExtension({
  key: "ime-confirm-enter-guard",
  tiptapExtensions: [tiptapExt],
});
