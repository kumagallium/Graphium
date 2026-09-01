// ──────────────────────────────────────────────
// 本文カラムより広いテーブルを、ページ左右の余白へ張り出させる（2026-09）
//
// 本文は 828px の中央カラムで組んでいるので、BlockNote のテーブルのスクロール枠
// （.tableWrapper / overflow-x:auto）は内側 720px しかない。列数の多い表はセルの
// --default-cell-min-width で縮まないため必ず溢れ、右側が切られる。macOS は
// オーバーレイスクロールバーなのでスクロールできること自体が見えず、
// 「表が消えた」ように見える（1512px 幅・右パネル open・8 列の表で 28% が不可視）。
//
// 一方、中央寄せで余った余白と .bn-editor の左右 54px（ドラッグハンドル溝）が
// 片側 100px 以上遊んでいる。そこをテーブルにだけ使わせる。
//
// 「余白の上に重ねる」実装（z-index で浮かせる）は採らない。浮かせると右パネル /
// サイドピークだけでなく SideMenu・ラベルバッジ・FormattingToolbar とも重なり順を
// 調整することになり、際限がなくなる。ここでやるのはエディタペイン
// （[data-label-wrapper]、overflow:auto）の *内側* でブロックの幅を広げるだけなので、
// ペインの外へは構造上出られない ＝ 右パネルやサイドピークに被らないことが
// z-index を一切触らずに保証される。
//
// 算出したはみ出し量は CSS 変数 --gph-table-bleed としてペインに載せる。
// 実際の適用は app.css の .tableWrapper ルールが行う。
// ──────────────────────────────────────────────

import { useEffect } from "react";

/** 本文中央カラムの最大幅。note-app.tsx の maxWidth: 828 と合わせる。 */
export const CONTENT_COLUMN_WIDTH = 828;

/** .bn-editor の padding-inline（ドラッグハンドル用の溝）。 */
export const EDITOR_GUTTER = 54;

export type TableBleedInput = {
  /** エディタペインの内寸（スクロールバーを除く = clientWidth） */
  paneWidth: number;
  /** ページ外側パディング（左） */
  padLeft: number;
  /** ページ外側パディング（右）。ラベルバッジがあるときは 80px に広がる */
  padRight: number;
  /** doc.fullWidth。中央カラムを解除しているときは余白が無い */
  fullWidth: boolean;
};

/**
 * テーブルが右へ張り出してよい量（px）。
 *
 * 中央寄せで片側に余っている分 + ハンドル溝までを使い、ページ外側のパディング
 * （ラベルバッジが入る右 80px を含む）は食わずに残す。ペイン幅から算出するので、
 * 右パネルの開閉やウィンドウリサイズに追従し、ペイン自体に横スクロールバーが
 * 出ることはない。
 */
export function computeTableBleed({
  paneWidth,
  padLeft,
  padRight,
  fullWidth,
}: TableBleedInput): number {
  const avail = paneWidth - padLeft - padRight;
  if (!Number.isFinite(avail) || avail <= 0) return 0;
  const columnWidth = fullWidth ? avail : Math.min(CONTENT_COLUMN_WIDTH, avail);
  return Math.max(0, Math.round((avail - columnWidth) / 2 + EDITOR_GUTTER));
}

/**
 * エディタペインに --gph-table-bleed を載せ続ける。
 * ペインの幅が変わる要因（ウィンドウリサイズ・右パネルの開閉・サイドピークの
 * 出入り）はすべてペイン自身の寸法変化として現れるので、ResizeObserver 1 本で足りる。
 */
export function useWideTableBleed(
  paneEl: HTMLElement | null,
  opts: Omit<TableBleedInput, "paneWidth">,
): void {
  const { padLeft, padRight, fullWidth } = opts;

  useEffect(() => {
    if (!paneEl) return;

    const apply = () => {
      const bleed = computeTableBleed({
        paneWidth: paneEl.clientWidth,
        padLeft,
        padRight,
        fullWidth,
      });
      paneEl.style.setProperty("--gph-table-bleed", `${bleed}px`);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(paneEl);
    return () => {
      ro.disconnect();
      paneEl.style.removeProperty("--gph-table-bleed");
    };
  }, [paneEl, padLeft, padRight, fullWidth]);
}
