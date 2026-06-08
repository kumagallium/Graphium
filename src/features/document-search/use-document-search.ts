// ドキュメント内検索（Cmd+F）の状態管理フック。
//
// search-plugin の DecorationSet を transaction の metadata 経由で制御し、
// dispatch 後にプラグイン状態（ヒット数・現在位置）を読み戻して React state に
// 反映する。Cmd+F の購読・ヒット間ナビゲーション・該当箇所へのスクロールも
// ここで面倒を見る。エディタ単位で 1 つ使う想定（現状はメインエディタのみ）。

import { useCallback, useEffect, useRef, useState } from "react";
import { searchPluginKey, type SearchMeta, type SearchPluginState } from "./search-plugin";

export interface DocumentSearchState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  /** ヒット総数。 */
  total: number;
  /** 現在ヒットの 1-based 表示位置（ヒット 0 件のときは 0）。 */
  current: number;
}

export interface DocumentSearchControls {
  state: DocumentSearchState;
  open: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  toggleCaseSensitive: () => void;
  next: () => void;
  prev: () => void;
}

/** BlockNote editor から ProseMirror view を取り出す（未準備なら null）。 */
function getView(editor: any): any | null {
  return editor?._tiptapEditor?.view ?? null;
}

function getPluginState(view: any): SearchPluginState | undefined {
  return searchPluginKey.getState(view.state);
}

export function useDocumentSearch(editor: any): DocumentSearchControls {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0); // 1-based 表示

  // activeIndex（0-based 内部値）は ref で持つ。next/prev を連打しても
  // state 更新のタイミングに依存せず正しく回せるようにするため。
  const activeIndexRef = useRef(-1);

  const dispatchMeta = useCallback(
    (meta: SearchMeta) => {
      const view = getView(editor);
      if (!view) return;
      view.dispatch(view.state.tr.setMeta(searchPluginKey, meta));
    },
    [editor],
  );

  // 現在ヒットの DOM をスクロールして見える位置に出す。
  // dispatch 直後は ProseMirror が同期で再描画しているが、装飾要素の
  // レイアウト確定を待つため rAF 1 フレーム置く。
  const scrollActiveIntoView = useCallback(() => {
    const view = getView(editor);
    if (!view) return;
    requestAnimationFrame(() => {
      const el = view.dom.querySelector(".gph-search-match--active") as HTMLElement | null;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [editor]);

  // dispatch 後にプラグイン状態を読み戻して React state を同期する。
  const syncFromPlugin = useCallback(() => {
    const view = getView(editor);
    if (!view) return;
    const ps = getPluginState(view);
    const matchCount = ps?.matches.length ?? 0;
    const idx = ps?.activeIndex ?? -1;
    activeIndexRef.current = idx;
    setTotal(matchCount);
    setCurrent(matchCount === 0 ? 0 : idx + 1);
  }, [editor]);

  const applySearch = useCallback(
    (q: string, cs: boolean, activeIndex: number) => {
      dispatchMeta({ type: "set", query: q, caseSensitive: cs, activeIndex });
      syncFromPlugin();
      scrollActiveIntoView();
    },
    [dispatchMeta, syncFromPlugin, scrollActiveIntoView],
  );

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      // 新しいクエリは常に先頭ヒットから。
      applySearch(q, caseSensitive, 0);
    },
    [applySearch, caseSensitive],
  );

  const toggleCaseSensitive = useCallback(() => {
    const nextCs = !caseSensitive;
    setCaseSensitive(nextCs);
    applySearch(query, nextCs, 0);
  }, [applySearch, caseSensitive, query]);

  const move = useCallback(
    (delta: number) => {
      if (total === 0) return;
      const nextIdx = (activeIndexRef.current + delta + total) % total;
      applySearch(query, caseSensitive, nextIdx);
    },
    [applySearch, caseSensitive, query, total],
  );

  const next = useCallback(() => move(1), [move]);
  const prev = useCallback(() => move(-1), [move]);

  const open = useCallback(() => {
    setIsOpen(true);
    // 本文に文字選択があれば検索語に流用する（ブラウザ検索の慣習）。
    const view = getView(editor);
    let initial = query;
    if (view) {
      const { from, to } = view.state.selection;
      if (to > from) {
        const sel = view.state.doc.textBetween(from, to, " ").trim();
        // 改行を含まない単一行の選択だけを採用する。
        if (sel && !sel.includes("\n")) initial = sel;
      }
    }
    if (initial !== query) setQueryState(initial);
    if (initial) applySearch(initial, caseSensitive, 0);
  }, [editor, query, caseSensitive, applySearch]);

  const close = useCallback(() => {
    setIsOpen(false);
    dispatchMeta({ type: "clear" });
    setTotal(0);
    setCurrent(0);
    activeIndexRef.current = -1;
    // 編集に戻れるようフォーカスをエディタへ返す。
    getView(editor)?.focus();
  }, [dispatchMeta, editor]);

  // Cmd/Ctrl+F でオープン。ブラウザ標準の検索を奪う。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        if (!getView(editor)) return; // エディタ未準備なら標準動作に委ねる
        e.preventDefault();
        open();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editor, open]);

  // 検索バーを開いている間に本文が編集されたら、プラグインが decoration を
  // 再計算する（search-plugin の docChanged 分岐）。その結果をバーのヒット
  // 件数表示にも追従させるため、editor の update を購読して読み戻す。
  // メタのみの transaction（set/clear）は doc を変えないので update は発火せず、
  // 二重 sync にはならない。
  useEffect(() => {
    if (!isOpen) return;
    const tiptap = editor?._tiptapEditor;
    if (!tiptap?.on) return;
    const handler = () => syncFromPlugin();
    tiptap.on("update", handler);
    return () => tiptap.off("update", handler);
  }, [editor, isOpen, syncFromPlugin]);

  // エディタが差し替わったら（ノート切替で remount）検索を閉じてリセット。
  useEffect(() => {
    setIsOpen(false);
    setQueryState("");
    setTotal(0);
    setCurrent(0);
    activeIndexRef.current = -1;
  }, [editor]);

  return {
    state: { open: isOpen, query, caseSensitive, total, current },
    open,
    close,
    setQuery,
    toggleCaseSensitive,
    next,
    prev,
  };
}
