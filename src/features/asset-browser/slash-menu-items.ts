// スラッシュメニュー: 既存メディアから挿入
// /image, /video, /audio で既存メディアのピッカーモーダルを開く

import { t } from "../../i18n";
import type { SlashMenuItem } from "../../base/slash-menu-types";
import type { MediaType } from "./media-index";

// メディアピッカーを開くコールバック。
// エディタ単位で登録する（main editor / SidePeek / list-SidePeek の各々が
// 自分用のピッカーを持つ）。スラッシュアイテムは click 時の editor を
// キーにレジストリを引いて、呼び出し元エディタのピッカーを開く。
// 単一の global 変数だと、NoteEditorInner が unmount されている画面
// （notes 一覧から listSidePeek を開いたとき等）でピッカーが死ぬ。
export type MediaPickerRequest = { type: MediaType; editor: any };
const _pickerCallbacks = new WeakMap<object, (type: MediaType) => void>();

export function setMediaPickerCallback(
  editor: any,
  fn: ((type: MediaType) => void) | null,
) {
  if (!editor) return;
  if (fn) _pickerCallbacks.set(editor, fn);
  else _pickerCallbacks.delete(editor);
}

function createMediaSlashItem(
  titleKey: string,
  subtextKey: string,
  mediaType: MediaType,
  aliases: string[],
): SlashMenuItem {
  return {
    // ラベルは getter で遅延評価する。呼び出し側は生成した項目を useMemo で保持するため、
    // ここで t() を即時評価すると言語を切り替えても古いラベルが残る。
    get title() { return t(titleKey); },
    get subtext() { return t(subtextKey); },
    get group() { return t("asset.slashGroup"); },
    aliases,
    onItemClick: (editor: any) => {
      _pickerCallbacks.get(editor)?.(mediaType);
    },
  };
}

/** デフォルトスラッシュメニューから除外する title 一覧 */
export const DEFAULT_MEDIA_SLASH_TITLES = ["Image", "Video", "Audio"];

/** スラッシュメニューに追加するメディア挿入アイテム（デフォルトの Image/Video/Audio を差し替え） */
export function getMediaSlashMenuItems(): SlashMenuItem[] {
  return [
    createMediaSlashItem(
      "asset.slashImage",
      "asset.slashImageSub",
      "image",
      ["image", "画像", "がぞう", "photo", "picture", "写真"],
    ),
    createMediaSlashItem(
      "asset.slashVideo",
      "asset.slashVideoSub",
      "video",
      ["video", "動画", "どうが", "movie", "film"],
    ),
    createMediaSlashItem(
      "asset.slashAudio",
      "asset.slashAudioSub",
      "audio",
      ["audio", "音声", "おんせい", "sound", "music"],
    ),
    createMediaSlashItem(
      "asset.slashDocument",
      "asset.slashDocumentSub",
      "document",
      // 旧 /pdf のエイリアスも残しつつ、word / docx / 文書 / 資料 も拾えるようにする
      ["document", "pdf", "word", "docx", "ドキュメント", "文書", "ぶんしょ", "資料", "しりょう", "論文", "ろんぶん", "paper"],
    ),
  ];
}
