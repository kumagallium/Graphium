// スラッシュメニューに出す項目の一覧（メインエディタと SidePeek の共通の出どころ）
//
// SidePeek はメインエディタの並行実装で、以前は項目の一覧をそれぞれに書いていた。
// そのためメイン側にだけ足された項目がピークに出ない漏れが起きた（チャートを
// ピークで作れなかった）。一覧はここ 1 か所にまとめ、新しい項目は次のどちらかに足す:
//
//   - getCommonSlashMenuItems: どのエディタでも動く項目。挿入するだけのものか、
//     受け口（ピッカー・表の登録先等）を「押されたエディタ」をキーに引くもの
//     （setMediaPickerCallback / setChartAssetSourceCallback /
//     setRegisterIndexTableCallback / setRegisterLogTableCallback などの WeakMap 登録）。
//     メインにも SidePeek にも出る
//   - getMainEditorOnlySlashMenuItems: メインエディタに固定の受け口で動く項目。
//     モジュール変数 1 つに note-app が登録したコールバックを呼ぶので、SidePeek に
//     出すと、ピークで押した結果がメイン側のノート（表の注釈・ラベル・リンク）に
//     書き込まれる。ピークでも使うなら、受け口をエディタ単位の登録に直してから
//     common へ移す
//
// 「新しいノート」はどちらのエディタにも出すが、リンクの記録先（linkStore・noteLinks）が
// エディタごとに違うので、この一覧には置けない。組み立ては block-link/new-note-slash-item.ts
// の buildNewNoteSlashItem に一本化してあり、メインと SidePeek がそれぞれの記録先を渡して
// 作り、一覧の先頭に足している（変数名は newNoteSlashItem）。

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
    // 先頭に置く。メインでは一覧がメイン専用の項目（テンプレート）の直後に続くので、
    // 同じグループの中でその後ろに並ぶ
    indexTableSlashItem,
    ...getMediaSlashMenuItems(),
    bookmarkSlashItem,
    logTableSlashItem,
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
  return [getTemplateSlashMenuItem()];
}
