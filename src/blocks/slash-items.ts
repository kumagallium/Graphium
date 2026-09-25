// スラッシュメニューに出す項目の一覧（メインエディタと SidePeek の共通の出どころ）
//
// SidePeek はメインエディタの並行実装で、以前は項目の一覧をそれぞれに書いていた。
// そのためメイン側にだけ足された項目がピークに出ない漏れが起きた（チャートを
// ピークで作れなかった）。一覧はここ 1 か所にまとめ、新しい項目は次のどちらかに足す:
//
//   - getCommonSlashMenuItems: どのエディタでも動く項目。挿入するだけのものか、
//     受け口（ピッカー等）を「押されたエディタ」をキーに引くもの
//     （setMediaPickerCallback / setChartAssetSourceCallback / setTemplatePickerCallback
//     などの WeakMap 登録）。メインにも SidePeek にも出る
//   - getMainEditorOnlySlashMenuItems: メインエディタに固定の受け口で動く項目。
//     モジュール変数 1 つに note-app が登録したコールバックを呼ぶので、SidePeek に
//     出すと、ピークで押した結果がメイン側のノート（表の注釈）に書き込まれる。
//     ピークでも使うなら、受け口をエディタ単位の登録に直してから common へ移す
//     （テンプレートはこの手順で移した）
//
// 「新しいノート」（note-app の newNoteSlashItem）もメイン専用だが、note-app の状態を
// 閉じ込めた項目なのでここには置けず、note-app 側で一覧の先頭に足している。

import type { SlashMenuItem } from "../base/slash-menu-types";
import { isTauri } from "../lib/platform";
import { getMediaSlashMenuItems } from "../features/asset-browser/slash-menu-items";
import { getMemoSlashMenuItem } from "../features/mobile-capture/slash-menu-item";
import { getCiteSlashMenuItems } from "../features/cite-picker/slash-menu-items";
import { inlineMathSlashItem } from "../features/inline-math/spec";
import { indexTableSlashItem } from "../features/index-table";
import { logTableSlashItem } from "../features/log-table";
import { getTemplateSlashMenuItem } from "../features/template/slash-menu-item";
import { bookmarkSlashItem } from "./bookmark";
import { calloutSlashItem } from "./callout";
import { stepSlashItem } from "./step";
import { columnsSlashItem } from "./multi-column";
import { mathSlashItem } from "./math";
import { calcSlashItem } from "./calc";
import { chartSlashItem } from "./chart";
import { sharedCitationSlashItem } from "./shared-citation";

/**
 * どのエディタでも動く項目。
 * includeCite: ノート・wiki の引用はピッカーがノート一覧を要るので、
 * 一覧を持たない画面（ノート一覧を渡されていない SidePeek）では出さない。
 */
export function getCommonSlashMenuItems(options: { includeCite: boolean }): SlashMenuItem[] {
  return [
    ...getMediaSlashMenuItems(),
    bookmarkSlashItem,
    // 応用グループの先頭に置く。メインでは専用の項目（インデックステーブル・
    // 時系列テーブル）のすぐ後ろに来て、専用の一覧にあった頃と並びが変わらない
    getTemplateSlashMenuItem(),
    calloutSlashItem,
    stepSlashItem,
    columnsSlashItem,
    mathSlashItem,
    inlineMathSlashItem,
    calcSlashItem,
    getMemoSlashMenuItem(),
    chartSlashItem,
    ...(options.includeCite ? getCiteSlashMenuItems() : []),
    // 共有ライブラリはデスクトップ版だけの機能
    ...(isTauri() ? [sharedCitationSlashItem] : []),
  ];
}

/** メインエディタに固定の受け口で動く項目（SidePeek には出さない。理由は冒頭） */
export function getMainEditorOnlySlashMenuItems(): SlashMenuItem[] {
  return [indexTableSlashItem, logTableSlashItem];
}
