// 画像・動画・ファイルを「本体を掴んで」動かせるようにする拡張。
//
// BlockNote は画像の <img> に draggable={false} をハードコードしている
// （@blocknote/react の VisualMedia / FileNameWithIcon）。そのため本体を
// ドラッグしても何も起きず、⠿ ハンドルを見つけられない人には
// 「画像は動かせない」ように見える。Notion / Docs はどちらも本体で掴める。
//
// 方式: mousedown の瞬間だけ draggable を立て、dragstart でハンドル経由と
// 同じ中身（blocknote/html + text/html + text/plain、ドラッグ元の NodeSelection）
// を自前で組む。
//   - 中身がハンドル経由と同一になるので、カラム化ドロップ（drop-to-columns）や
//     別エディタ（SidePeek）へのドラッグもそのまま効く
//   - dragstart で true を返して PM 既定の dragstart を止める。既定は
//     dataTransfer.clearData() で blocknote/html を消してしまい、別エディタ
//     （SidePeek）へのドラッグが壊れる
//
// **core の blockDragStart に dataTransfer を渡さない。** blockDragStart は
// dragstart の最中に「掴んだブロックの複製」（.bn-drag-preview）を body に
// 追加する。ハンドルから始めたドラッグなら問題ないが、本文の画像そのものから
// 始めたドラッグでは WebKit（デスクトップ版の WKWebView）がこれでドラッグを
// 取り消す — ドロップ位置の表示が出ず画像を動かせない。取り消しかけの
// ドラッグの後にはウィンドウ全体でマウスが効かなくなる（文字だけ打てる）
// こともあった（Playwright WebKit で再現・切り分け済み）。
// blockDragStart は dataTransfer: null で呼び、「このエディタがドラッグ元」の
// 印（isDragOrigin）を立てる用途にだけ使う。
//
// テキストを持つブロックには**付けない**。段落や表の本体を draggable に
// すると、文字の選択ドラッグが drag & drop に化けて執筆が壊れる。
//
// draggable は属性なので、本文を監視している MutationObserver
// （caption-layer / prov-indicator / icon-layer はいずれも childList と
//  characterData だけを見る）を起こさない。

import { NodeSelection, Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { createExtension } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { applyDragGhost, primeDragGhost } from "./drag-ghost";

const pluginKey = new PluginKey("mediaBodyDrag");

/** 本体で掴ませる要素。音声（再生コントロールがある）とチャート・表・PDF
 *  ビューア（中身を操作する）は対象外にして、静止した見た目のものだけ。 */
const MEDIA_SELECTOR = [
  "[data-file-block] .bn-visual-media", // 画像・動画のプレビュー
  "[data-file-block] .bn-file-name-with-icon", // プレビューなしのファイル行
].join(", ");

/** 掴んだ要素を含むブロック（blockContainer）の直前位置。見つからなければ null */
function blockPosOf(view: EditorView, el: HTMLElement): number | null {
  const container = el.closest('[data-node-type="blockContainer"]');
  if (!container) return null;
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(container, 0));
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === "blockContainer") return $pos.before(d);
    }
  } catch {
    // DOM と文書がずれている瞬間は諦めてハンドル経由に任せる
  }
  return null;
}

export const mediaBodyDragExtension = createExtension(({ editor }) => {
  // mousedown で立てた draggable を戻すための参照。ドラッグ後に true が
  // 残ると、次のクリックでも意図せずドラッグが始まる
  let armed: HTMLElement | null = null;
  // ドラッグ中か（後始末を 1 回だけにするため）
  let dragging = false;
  // sideMenu は editor 型に生えていない（拡張は getExtension で引く）
  const sideMenu = () => editor.getExtension(SideMenuExtension);
  const disarm = () => {
    if (!armed) return;
    armed.draggable = false;
    armed = null;
  };

  // ドラッグの後始末。dragend はドラッグ元の要素に届くが、ドロップで画像が
  // 移動すると元の要素は作り直されて文書から外れ、dragend がどこにも届かない。
  // drop（落とし先で必ず起きる）と、ドラッグ後の最初の mousemove でも拾う
  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener("drop", onWindowDrop, true);
    window.removeEventListener("dragend", onWindowDrop, true);
    window.removeEventListener("mousemove", finishDrag, true);
    sideMenu()?.blockDragEnd();
    disarm();
  };
  // drop の処理（PM / BlockNote のハンドラ）が終わってから片付ける
  const onWindowDrop = () => {
    setTimeout(finishDrag, 0);
  };

  return {
    key: "mediaBodyDrag",
    prosemirrorPlugins: [
      new Plugin({
        key: pluginKey,
        view: () => ({ destroy: finishDrag }),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              disarm();
              if (!view.editable || event.button !== 0) return false;
              const target = event.target as HTMLElement | null;
              // リサイズハンドルの上は掴ませない（幅変更のドラッグが死ぬ）
              if (target?.closest(".bn-resize-handle")) return false;
              const media = target?.closest<HTMLElement>(MEDIA_SELECTOR);
              if (!media) return false;
              media.draggable = true;
              armed = media;
              // 縮小ゴーストは掴んだ瞬間に読み込ませる（drag-ghost.ts）
              if (media instanceof HTMLImageElement) primeDragGhost(media.src);
              else primeDragGhost(media.querySelector("img")?.src);
              return false;
            },
            dragstart(view, event) {
              if (!armed) return false;
              const dt = event.dataTransfer;
              if (!dt) return false;
              const outer = armed.closest<HTMLElement>('[data-node-type="blockOuter"]');
              const id = outer?.getAttribute("data-id");
              const block = id ? editor.getBlock(id) : undefined;
              const pos = blockPosOf(view, armed);
              if (!block || pos === null) return false;

              // ドラッグ元の印だけ立てる（dataTransfer: null なら core は複製を作らない）
              sideMenu()?.blockDragStart({ dataTransfer: null, clientY: event.clientY }, block);

              // ドラッグ元のブロックを選択する。ドロップ時に PM がこの選択を
              // 消して落とし先に入れる（= 移動）。ハンドル経由と同じ形
              const cur = view.state.selection;
              if (!(cur instanceof NodeSelection && cur.from === pos)) {
                view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
              }
              const slice = view.state.selection.content();
              dt.clearData();
              dt.setData("blocknote/html", view.serializeForClipboard(slice).dom.innerHTML);
              dt.setData("text/html", editor.blocksToHTMLLossy([block]));
              dt.setData("text/plain", editor.blocksToMarkdownLossy([block]));
              dt.effectAllowed = "move";

              // 画像は縮小ゴーストにする（読み込み済みのときだけ。drag-ghost.ts）
              const img = armed instanceof HTMLImageElement ? armed : armed.querySelector("img");
              if (img?.src) applyDragGhost(dt, img.src);

              dragging = true;
              window.addEventListener("drop", onWindowDrop, true);
              window.addEventListener("dragend", onWindowDrop, true);
              // ドラッグ中は mousemove が来ない。来たらドラッグは終わっている
              setTimeout(() => {
                if (dragging) window.addEventListener("mousemove", finishDrag, true);
              }, 0);
              // PM 既定の dragstart を止める（dataTransfer を上書きさせない）
              return true;
            },
            dragend() {
              if (dragging) finishDrag();
              else disarm();
              return false;
            },
            // ドラッグにならなかった単なるクリック
            mouseup() {
              if (!dragging) disarm();
              return false;
            },
          },
        },
      }),
    ],
  };
});
