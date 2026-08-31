// BlockNote 内蔵 UI（スラッシュメニュー既定項目・テーブル/ドラッグハンドル・
// フォーマットツールバー・ファイルパネル・リンクツールバー・プレースホルダ等）の辞書。
//
// BlockNote は ja 辞書を同梱しているが、語彙がアプリの i18n（src/i18n/ja.ts）と
// ずれる箇所がある（ビデオ/動画、オーディオ/音声、表/テーブル、全角数字など）。
// ここで同梱 ja に上書きを重ねて、アプリ全体の表記・トーンに揃える。
// en は BlockNote 既定をそのまま使う。

import type { Dictionary } from "@blocknote/core";
import { en as bnEn, ja as bnJa } from "@blocknote/core/locales";
import type { Locale } from "../i18n";

// スラッシュメニュー: タイトルを「種類を変更」メニュー（editor.turnIntoType.*）と
// 揃える。数字は半角、リスト名は「〜リスト」形式。
// 既定の画像/動画/音声の項目はアプリ独自のスラッシュ項目に差し替えて非表示だが、
// 語彙は他の UI（ファイルパネル等）と揃うよう一緒に直しておく。
const jaSlashMenuOverrides: Dictionary["slash_menu"] = {
  ...bnJa.slash_menu,
  heading: { ...bnJa.slash_menu.heading, title: "見出し1" },
  heading_2: { ...bnJa.slash_menu.heading_2, title: "見出し2" },
  heading_3: { ...bnJa.slash_menu.heading_3, title: "見出し3" },
  heading_4: { ...bnJa.slash_menu.heading_4, title: "見出し4" },
  heading_5: { ...bnJa.slash_menu.heading_5, title: "見出し5" },
  heading_6: { ...bnJa.slash_menu.heading_6, title: "見出し6" },
  paragraph: { ...bnJa.slash_menu.paragraph, title: "テキスト" },
  bullet_list: { ...bnJa.slash_menu.bullet_list, title: "箇条書きリスト" },
  numbered_list: {
    ...bnJa.slash_menu.numbered_list,
    title: "番号付きリスト",
    subtext: "番号付きリストを表示するために使用",
  },
  toggle_list: { ...bnJa.slash_menu.toggle_list, title: "トグルリスト" },
  check_list: {
    ...bnJa.slash_menu.check_list,
    subtext: "チェックボックス付きリストを表示するために使用",
  },
  table: { ...bnJa.slash_menu.table, title: "テーブル", subtext: "テーブルに使用" },
  emoji: { ...bnJa.slash_menu.emoji, subtext: "絵文字を挿入" },
  video: { ...bnJa.slash_menu.video, title: "動画", subtext: "動画を挿入" },
  audio: { ...bnJa.slash_menu.audio, title: "音声", subtext: "音声を挿入" },
};

// 同梱 ja 辞書は一部の英語 alias を落としている（emoji には "emoji" すら無く、
// toggle_list には "toggle" 系が無い等）。日本語 UI でも英語コマンドで検索する
// 使い方（/emoji, /toggle, /heading1）が成り立つよう、en の aliases を
// 各項目にマージして日英どちらの入力でもヒットさせる。
const jaSlashMenu = Object.fromEntries(
  Object.entries(jaSlashMenuOverrides).map(([key, item]) => {
    const enAliases =
      (bnEn.slash_menu as Record<string, { aliases?: string[] }>)[key]?.aliases ?? [];
    const aliases = [...(item.aliases ?? [])];
    for (const alias of enAliases) {
      if (!aliases.some((a) => a.toLowerCase() === alias.toLowerCase())) {
        aliases.push(alias);
      }
    }
    return [key, { ...item, aliases }];
  }),
) as Dictionary["slash_menu"];

const ja: Dictionary = {
  ...bnJa,
  slash_menu: jaSlashMenu,
  placeholders: {
    ...bnJa.placeholders,
    default: "テキストを入力するか、'/' でコマンドを選択",
  },
  file_blocks: {
    add_button_text: {
      ...bnJa.file_blocks.add_button_text,
      video: "動画を追加",
      audio: "音声を追加",
    },
  },
  formatting_toolbar: {
    ...bnJa.formatting_toolbar,
    strike: { ...bnJa.formatting_toolbar.strike, tooltip: "取り消し線" },
    file_replace: {
      tooltip: {
        ...bnJa.formatting_toolbar.file_replace.tooltip,
        video: "動画を置換",
        audio: "音声を置換",
      },
    },
    file_rename: {
      tooltip: {
        ...bnJa.formatting_toolbar.file_rename.tooltip,
        video: "動画の名前を変更",
        audio: "音声の名前を変更",
      },
      input_placeholder: {
        ...bnJa.formatting_toolbar.file_rename.input_placeholder,
        video: "動画の名前を変更",
        audio: "音声の名前を変更",
      },
    },
    file_download: {
      tooltip: {
        ...bnJa.formatting_toolbar.file_download.tooltip,
        video: "動画をダウンロード",
        audio: "音声をダウンロード",
      },
    },
    file_delete: {
      tooltip: {
        ...bnJa.formatting_toolbar.file_delete.tooltip,
        video: "動画を削除",
        audio: "音声を削除",
      },
    },
  },
  file_panel: {
    upload: {
      ...bnJa.file_panel.upload,
      file_placeholder: {
        ...bnJa.file_panel.upload.file_placeholder,
        video: "動画をアップロード",
        audio: "音声をアップロード",
      },
      upload_error: "アップロードに失敗しました",
    },
    embed: {
      ...bnJa.file_panel.embed,
      embed_button: {
        ...bnJa.file_panel.embed.embed_button,
        video: "動画を埋め込む",
        audio: "音声を埋め込む",
      },
      url_placeholder: "URL を入力",
    },
  },
  link_toolbar: {
    ...bnJa.link_toolbar,
    form: {
      title_placeholder: "タイトルを編集",
      url_placeholder: "URL を編集",
    },
  },
  drag_handle: {
    ...bnJa.drag_handle,
    // 「この行/列を見出しにする」トグルなので名詞で表す
    header_row_menuitem: "見出し行",
    header_column_menuitem: "見出し列",
  },
  suggestion_menu: {
    no_items_title: "候補が見つかりません",
  },
};

const dictionaries: Record<Locale, Dictionary> = { en: bnEn, ja };

/** アプリのロケールに対応する BlockNote 辞書を返す */
export function getBlockNoteDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
