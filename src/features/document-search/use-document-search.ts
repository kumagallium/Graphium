// ドキュメント内検索（Cmd+F）の状態管理フック。
//
// search-plugin の DecorationSet を transaction の metadata 経由で制御し、
// dispatch 後にプラグイン状態（ヒット数・現在位置）を読み戻して React state に
// 反映する。Cmd+F の購読・ヒット間ナビゲーション・該当箇所へのスクロールも
// ここで面倒を見る。エディタ単位で 1 つ使う想定（現状はメインエディタのみ）。

import { useCallback, useEffect, useRef, useState } from "react";
import { searchPluginKey, type SearchMeta, type SearchPluginState } from "./search-plugin";
import {
  SEARCH_SCOPE_ATTR,
  clearScopeHighlights,
  comparePoints,
  findScopeRanges,
  paintScopeHighlights,
} from "./block-text-search";

/** 本文のヒット（plugin の matches の index）か、本文の外の囲いのヒット（Range）か */
type SearchItem = { kind: "doc"; index: number } | { kind: "scope"; range: Range };

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
  // 編集・画面の変化で数え直すときに使う、いまの検索語と大文字小文字の区別
  const queryRef = useRef("");
  const caseSensitiveRef = useRef(false);
  queryRef.current = query;
  caseSensitiveRef.current = caseSensitive;

  // activeIndex（0-based 内部値）は ref で持つ。next/prev を連打しても
  // state 更新のタイミングに依存せず正しく回せるようにするため。
  // 本文のヒットと、本文の外（音声ノートのブロックの中）のヒットを画面の並び順で混ぜた通し番号
  const activeIndexRef = useRef(-1);
  const itemsRef = useRef<SearchItem[]>([]);

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
      const item = itemsRef.current[activeIndexRef.current];
      const el =
        item?.kind === "scope"
          ? item.range.startContainer.parentElement
          : (view.dom.querySelector(".gph-search-match--active") as HTMLElement | null);
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    });
  }, [editor]);

  /**
   * 本文のヒット（plugin）と本文の外の囲いのヒット（DOM）を画面の並び順で混ぜ、
   * 通し番号 activeIndex を選ぶ。選んだのが本文なら plugin に、囲いなら強調で知らせる
   */
  const recompute = useCallback(
    (q: string, cs: boolean, activeIndex: number) => {
      const view = getView(editor);
      if (!view) return;
      // まず本文だけを探す（本文では何も選ばない）
      view.dispatch(view.state.tr.setMeta(searchPluginKey, { type: "set", query: q, caseSensitive: cs, activeIndex: -1 }));
      const docMatches = getPluginState(view)?.matches ?? [];
      const ranges = q ? findScopeRanges(view.dom, q, cs) : [];
      const at = (m: { from: number }) => {
        try {
          return view.domAtPos(m.from) as { node: Node; offset: number };
        } catch {
          return null;
        }
      };
      const keyed: Array<{ item: SearchItem; point: { node: Node; offset: number } | null }> = [
        ...docMatches.map((m, index) => ({ item: { kind: "doc", index } as SearchItem, point: at(m) })),
        ...ranges.map((range) => ({
          item: { kind: "scope", range } as SearchItem,
          point: { node: range.startContainer, offset: range.startOffset },
        })),
      ];
      // 位置の分からない本文のヒットは、本文どうしの順を保ったまま後ろへ
      const items =
        ranges.length === 0
          ? keyed.map((k) => k.item)
          : keyed
              .map((k, i) => ({ ...k, i }))
              .sort((a, b) => (a.point && b.point ? comparePoints(a.point, b.point) : a.point ? -1 : b.point ? 1 : 0) || a.i - b.i)
              .map((k) => k.item);
      itemsRef.current = items;
      const idx = items.length === 0 ? -1 : Math.max(0, Math.min(activeIndex, items.length - 1));
      activeIndexRef.current = idx;
      const active = items[idx];
      if (active?.kind === "doc") {
        view.dispatch(view.state.tr.setMeta(searchPluginKey, { type: "set", query: q, caseSensitive: cs, activeIndex: active.index }));
      }
      paintScopeHighlights(ranges, active?.kind === "scope" ? active.range : null);
      setTotal(items.length);
      setCurrent(items.length === 0 ? 0 : idx + 1);
    },
    [editor],
  );

  const syncFromPlugin = useCallback(() => {
    // 本文が編集されたら、選んでいる通し番号を保ったまま数え直す
    recompute(queryRef.current, caseSensitiveRef.current, activeIndexRef.current);
  }, [recompute]);

  const applySearch = useCallback(
    (q: string, cs: boolean, activeIndex: number) => {
      recompute(q, cs, activeIndex);
      scrollActiveIntoView();
    },
    [recompute, scrollActiveIntoView],
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
    clearScopeHighlights();
    itemsRef.current = [];
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
    const handler = () => queueMicrotask(syncFromPlugin);
    tiptap.on("update", handler);
    return () => tiptap.off("update", handler);
  }, [editor, isOpen, syncFromPlugin]);

  // 本文の外の囲い（音声ノートのブロック）の中身が変わったら数え直す
  // （発言の読み込み・タブの切り替え・清書のでき上がり）。本文の decoration の変化は囲いの外なので数えない
  useEffect(() => {
    if (!isOpen) return;
    const view = getView(editor);
    if (!view || typeof MutationObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const inScope = (n: Node | null) =>
      !!(n && (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(`[${SEARCH_SCOPE_ATTR}]`));
    const observer = new MutationObserver((records) => {
      const touched = records.some(
        (r) =>
          inScope(r.target) ||
          [...r.addedNodes, ...r.removedNodes].some(
            (n) => n.nodeType === 1 && ((n as Element).matches?.(`[${SEARCH_SCOPE_ATTR}]`) || !!(n as Element).querySelector?.(`[${SEARCH_SCOPE_ATTR}]`)),
          ),
      );
      if (!touched || !queryRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => recompute(queryRef.current, caseSensitiveRef.current, activeIndexRef.current), 120);
    });
    observer.observe(view.dom, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [editor, isOpen, recompute]);

  // エディタが差し替わったら（ノート切替で remount）検索を閉じてリセット。
  useEffect(() => {
    clearScopeHighlights();
    itemsRef.current = [];
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
