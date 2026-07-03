// エディタ本文内の外部リンク（http(s)）クリックで、BlockNote 標準の
// window.open（新規タブで開く）を抑止する拡張。
//
// BlockNote(Tiptap) の Link 拡張（priority 1000）は clickHandler プラグインを持ち、
// リンククリック時に `window.open(href, target)` を呼んで新規タブを開く。
// Graphium ではリンクを「サイドピークのリーダー」で開きたいので、この標準動作を止める。
//
// ProseMirror の `handleClick` は `someProp` で最初に true を返したプラグインで
// 打ち切られる。Tiptap は priority の高い拡張のプラグインを先に並べるため、
// Link（1000）より高い priority でこの拡張を差し込み、リンククリックで true を返して
// Link の clickHandler を評価させない。
//
// 実際のサイドピーク表示は note-app.tsx の document クリックハンドラが担当する
// （本文内 a[href] を拾って setMaterialSidePeekEntry する）。ここは「抑止」専任。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { createExtension } from "@blocknote/core";

const pluginKey = new PluginKey("openLinkInSidePeek");

const tiptapExt = TiptapExtension.create({
  name: "openLinkInSidePeek",
  // Link 拡張は priority 1000。それより高くして handleClick を先に評価する。
  priority: 10000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement | null;
            const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!anchor) return false;
            const href = anchor.getAttribute("href") ?? "";
            // 外部 http(s) リンクのみ横取りする（内部アンカーや mailto: 等は素通し）。
            if (!/^https?:\/\//i.test(href)) return false;
            // true を返して BlockNote の Link clickHandler（window.open）を打ち切る。
            // サイドピーク表示は note-app の click ハンドラ側で行う。
            return true;
          },
        },
      }),
    ];
  },
});

export const openLinkInSidePeekExtension = createExtension({
  key: "open-link-in-side-peek",
  tiptapExtensions: [tiptapExt],
});
