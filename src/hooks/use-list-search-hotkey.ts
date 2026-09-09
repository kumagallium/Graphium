// 一覧ビューの検索欄への Cmd/Ctrl+F。
//
// ノート一覧・素材・ナレッジ…と一覧ビューはそれぞれ検索欄を持つが、これらが
// 出ている間は本文エディタが unmount されているため Cmd+F を誰も拾わず、
// ブラウザ標準の検索が出ていた。ここで拾って「いま見えている一覧の検索欄」へ
// フォーカスを送る。
//
// Cmd+F の三段構え（先に取った者が stopPropagation で止める）:
//   1. 素材 PDF 内検索  … document の capture フェーズ（ビューアに hover/focus 時のみ）
//   2. ノート本文検索   … document の bubble フェーズ（エディタが居るときだけ）
//   3. 一覧の検索欄     … ここ。bubble フェーズで、上の 2 つが取らなかったときだけ動く
//
// 一覧ごとに配線せず、検索欄側に目印（data-list-search）を付けて DOM から探す。
// ビューを 1 つ足すたびに配線を忘れて効かない、を避けるため。

import { useEffect } from "react";

/** 検索欄に付ける目印。listSearchInputProps 経由で付けること。 */
export const LIST_SEARCH_ATTR = "data-list-search";

/** 一覧の検索 input に広げる props。 */
export const listSearchInputProps = { [LIST_SEARCH_ATTR]: "" } as const;

/** 画面に出ているか（display:none / 閉じたパネルの中を除く）。 */
function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

/** いま入力中か（モーダルの検索欄・一覧のインライン改名などに割り込まない）。 */
function isEditing(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * 見えている一覧の検索欄を探す。複数見つかったときは DOM 順の最後を採る
 * （モーダルは body 末尾に portal されるので、後から重なった側が勝つ）。
 */
function findListSearchInput(): HTMLInputElement | null {
  const all = document.querySelectorAll<HTMLInputElement>(`input[${LIST_SEARCH_ATTR}]`);
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i];
    if (!el.disabled && isVisible(el)) return el;
  }
  return null;
}

/** アプリ全体で 1 つだけ使う。note-app のルートから呼ぶ想定。 */
export function useListSearchHotkey(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 先に PDF / 本文検索が取っていたら何もしない
      if (e.defaultPrevented) return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "f") return;
      const input = findListSearchInput();
      if (!input) return; // 一覧が出ていなければブラウザ標準に委ねる
      // 既に検索欄に居るなら選び直すだけ。別の入力欄に居るなら奪わない。
      const active = document.activeElement;
      if (active !== input && isEditing(active)) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
