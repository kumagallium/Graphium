// 画像・動画・ファイルを「本体を掴んで」動かせるようにする拡張。
//
// BlockNote は画像の <img> に draggable={false} をハードコードしている
// （@blocknote/react の VisualMedia / FileNameWithIcon）。そのため本体を
// ドラッグしても何も起きず、⠿ ハンドルを見つけられない人には
// 「画像は動かせない」ように見える。Notion / Docs はどちらも本体で掴める。
//
// 方式: mousedown の瞬間だけ draggable を立て、dragstart を SideMenu の
// ハンドルとまったく同じ経路（editor.sideMenu.blockDragStart）へ横流しする。
//   - ドラッグの中身（blocknote/html + 選択のノード化）がハンドル経由と
//     同一になるので、カラム化ドロップ（drop-to-columns）もそのまま効く
//   - dragstart で true を返して PM 既定の dragstart を止める。既定は
//     dataTransfer.clearData() で blocknote/html を消してしまい、別エディタ
//     （SidePeek）へのドラッグが壊れる
//
// テキストを持つブロックには**付けない**。段落や表の本体を draggable に
// すると、文字の選択ドラッグが drag & drop に化けて執筆が壊れる。
//
// draggable は属性なので、本文を監視している MutationObserver
// （caption-layer / prov-indicator / icon-layer はいずれも childList と
//  characterData だけを見る）を起こさない。

import { Plugin, PluginKey } from "prosemirror-state";
import { createExtension } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";

const pluginKey = new PluginKey("mediaBodyDrag");

/** 本体で掴ませる要素。音声（再生コントロールがある）とチャート・表・PDF
 *  ビューア（中身を操作する）は対象外にして、静止した見た目のものだけ。 */
const MEDIA_SELECTOR = [
  "[data-file-block] .bn-visual-media", // 画像・動画のプレビュー
  "[data-file-block] .bn-file-name-with-icon", // プレビューなしのファイル行
].join(", ");

export const mediaBodyDragExtension = createExtension(({ editor }) => {
  // mousedown で立てた draggable を戻すための参照。ドラッグ後に true が
  // 残ると、次のクリックでも意図せずドラッグが始まる
  let armed: HTMLElement | null = null;
  // sideMenu は editor 型に生えていない（拡張は getExtension で引く）
  const sideMenu = () => editor.getExtension(SideMenuExtension);
  const disarm = () => {
    if (!armed) return;
    armed.draggable = false;
    armed = null;
  };

  return {
    key: "mediaBodyDrag",
    prosemirrorPlugins: [
      new Plugin({
        key: pluginKey,
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
              return false;
            },
            dragstart(_view, event) {
              if (!armed) return false;
              const outer = armed.closest<HTMLElement>('[data-node-type="blockOuter"]');
              const id = outer?.getAttribute("data-id");
              const block = id ? editor.getBlock(id) : undefined;
              if (!block) return false;
              sideMenu()?.blockDragStart(
                { dataTransfer: event.dataTransfer, clientY: event.clientY },
                block,
              );
              // blockDragStart は core の不可視プレビュー（.bn-drag-preview,
              // opacity .001）を setDragImage する。画像ブロックには editor.tsx の
              // handleDOMEvents.dragstart（view.props 側なので**こちらより先**に
              // 走る）が縮小ゴーストを用意しているので、掴んだ画像のものだけ戻す
              if (armed instanceof HTMLImageElement && event.dataTransfer) {
                const ghost = document.querySelector<HTMLImageElement>(
                  'img[data-drag-ghost="true"]',
                );
                if (ghost?.src && ghost.src === armed.src) {
                  try {
                    event.dataTransfer.setDragImage(ghost, 24, 24);
                  } catch {
                    // ゴーストは見た目だけ。失敗しても既定表示で続ける
                  }
                }
              }
              // PM 既定の dragstart を止める（dataTransfer を上書きさせない）
              return true;
            },
            dragend() {
              if (armed) sideMenu()?.blockDragEnd();
              disarm();
              return false;
            },
            // ドラッグにならなかった単なるクリック
            mouseup() {
              disarm();
              return false;
            },
          },
        },
      }),
    ],
  };
});
