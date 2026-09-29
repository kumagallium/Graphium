// ノート一覧（すべてのノート）の列の幅と、狭いときに隠す順
//
// 隠す順: 作者 → 作成日 → フォルダ → ラベル → 本アイコン（知見の数）。参照先・被参照・チェック・
// 更新日は隠さない（中身を識別する・操作に要る列）。作成日順はツールバーの並べ替えから選べるので、
// 列が隠れても並べ替えは効いたまま。作者・フォルダ・ラベル・本アイコンは列ヘッダからしか
// 並べ替えられないので、その基準で並べている間や絞り込み中は隠さない（pinned）。
// 全部隠してもなお枠（表の内側）が 635px（= 隠さない列 378 + タイトル 240 + スクロールバー 17）
// を下回るとき、最後の手段としてタイトルの最小幅を 240 → 150 に詰める（枠 549px = 853 幅・
// サイドバー開きでも横スクロールを出さず、更新日を切らない）。詰めた表の幅は 528px で、
// スクロールバー込みでも 549 − 17 = 532 に収まる。
// 幅の数値は NoteListView の th の w-[…] と揃える（Tailwind は動的なクラス名を拾えないので
// あちらは数値を直に書いている。変えるときは両方を直す）。

import type { ColumnPlan, HideableColumn } from "../../lib/responsive-columns";

export type NoteListHideableColumn = "author" | "createdAt" | "folder" | "labels" | "knowledge";

/** タイトル列の最小幅（日本語で 1 行 12 字前後。これを割るなら列を隠す） */
export const NOTE_LIST_TITLE_MIN_WIDTH = 240;

/**
 * 隠せる列を全部隠した後だけ使うタイトル列の最小幅（日本語で 1 行 7〜8 字）。
 * 枠 549px（853 幅・サイドバー開き）でスクロールバー込みでも収まる上限が 154 なので 150 にしている
 */
export const NOTE_LIST_TITLE_COMPACT_MIN_WIDTH = 150;

export const NOTE_LIST_COLUMN_WIDTH = {
  checkbox: 36,
  /** 参照先・被参照。英語の "Outgoing" が nowrap で収まる幅 */
  linkCount: 72,
  knowledge: 56,
  modifiedAt: 126,
  actions: 72,
  author: 96,
  /** 「YYYY-MM-DD HH:MM」が nowrap で収まる実幅（w-[100px] は実測 126px に広がっていた） */
  createdAt: 126,
  folder: 150,
  labels: 140,
} as const;

export interface NoteListColumnOptions {
  /** 先頭のチェック列（onDeleteNotes があるとき） */
  hasCheckbox: boolean;
  /** 末尾の操作列（onDeleteNotes / onArchiveNotes があるとき） */
  hasActions: boolean;
  /** ラベル列（どのノートにもラベルが無いときは列ごと無い） */
  hasLabels: boolean;
  /**
   * 隠さず残す列。絞り込みが掛かっている列は、隠すと「なぜ少ないのか」が見えなくなる
   * （絞り込みの操作は列ヘッダにしか無い）ので、幅が足りなくても残して横スクロールに任せる
   */
  pinned?: ReadonlySet<NoteListHideableColumn>;
}

export function buildNoteListColumnPlan(
  opts: NoteListColumnOptions,
): ColumnPlan<NoteListHideableColumn> {
  const W = NOTE_LIST_COLUMN_WIDTH;
  const pinned = opts.pinned ?? new Set<NoteListHideableColumn>();
  const order: HideableColumn<NoteListHideableColumn>[] = [
    { key: "author", width: W.author },
    { key: "createdAt", width: W.createdAt },
    { key: "folder", width: W.folder },
  ];
  if (opts.hasLabels) order.push({ key: "labels", width: W.labels });
  // 本アイコン（知見の数）は最後に隠す。知見の一覧へはナレッジ画面からも行ける
  order.push({ key: "knowledge", width: W.knowledge });

  let baseWidth =
    NOTE_LIST_TITLE_MIN_WIDTH +
    W.linkCount * 2 +
    W.modifiedAt +
    (opts.hasCheckbox ? W.checkbox : 0) +
    (opts.hasActions ? W.actions : 0);
  const hideable: HideableColumn<NoteListHideableColumn>[] = [];
  for (const col of order) {
    if (pinned.has(col.key)) baseWidth += col.width;
    else hideable.push(col);
  }
  return {
    baseWidth,
    hideable,
    floorWidth: baseWidth - (NOTE_LIST_TITLE_MIN_WIDTH - NOTE_LIST_TITLE_COMPACT_MIN_WIDTH),
  };
}
