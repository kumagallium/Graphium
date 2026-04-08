// スラッシュメニュー: 既存メディアから挿入
// /image, /video, /audio で既存メディアのピッカーモーダルを開く

import { t } from "../../i18n";
import type { MediaType } from "./media-index";

// メディアピッカーを開くグローバルコールバック
// note-app.tsx 側で登録する
let _openPickerCallback: ((type: MediaType) => void) | null = null;

export function setMediaPickerCallback(
  fn: typeof _openPickerCallback,
) {
  _openPickerCallback = fn;
}

type SlashMenuItem = {
  title: string;
  subtext?: string;
  group: string;
  aliases?: string[];
  onItemClick: (editor: any) => void;
};

function createMediaSlashItem(
  titleKey: string,
  subtextKey: string,
  mediaType: MediaType,
  aliases: string[],
): SlashMenuItem {
  return {
    title: t(titleKey),
    subtext: t(subtextKey),
    group: t("asset.slashGroup"),
    aliases,
    onItemClick: (_editor: any) => {
      _openPickerCallback?.(mediaType);
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
      "asset.slashPdf",
      "asset.slashPdfSub",
      "pdf",
      ["pdf", "document", "論文", "ろんぶん", "paper"],
    ),
  ];
}
