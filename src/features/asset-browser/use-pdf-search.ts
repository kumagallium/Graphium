// 素材 PDF ビューア内テキスト検索（Cmd+F）の状態管理フック。
//
// 検索対象は「描画済みの text-layer DOM」。react-pdf は全ページを同時に
// レンダリングするが完了は非同期なので、ページ描画・ズーム変更のたびに
// 再インデックス（＝再検索）する。Range はページを再ラスタライズすると
// 無効になるため、状態として持つのは query と activeIndex だけにして、
// マッチ自体は毎回作り直す。
//
// Cmd+F はノート本文検索（useDocumentSearch）が document の bubble フェーズで
// 拾っている。PDF にポインタが乗っている／フォーカスがあるときだけ、capture
// フェーズで先に奪って PDF 検索に回す。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyHighlights,
  clearHighlights,
  MAX_MATCHES,
  searchPages,
  type PdfSearchMatch,
} from "./pdf-search";

export interface PdfSearchState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  total: number;
  /** 現在ヒットの 1-based 表示位置（ヒット 0 件のときは 0）。 */
  current: number;
  /** 上限で打ち切ったか（件数を "2000+" と出すため）。 */
  capped: boolean;
}

export interface PdfSearchControls {
  state: PdfSearchState;
  open: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  toggleCaseSensitive: () => void;
  next: () => void;
  prev: () => void;
}

export interface UsePdfSearchArgs {
  /** ビューア全体（Cmd+F をこの中でだけ奪う）。 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 縦スクロール領域（ヒット位置へのスクロールに使う）。 */
  scrollAreaRef: React.RefObject<HTMLElement | null>;
  /** ページ番号 → ページ要素。PdfViewer が registerPage で維持しているもの。 */
  pageRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  /**
   * 再インデックスのトリガー。ページ描画完了数・ズーム・ドキュメント URL など、
   * text-layer が作り直される要因が変わったら値を変える。
   */
  revision: unknown;
}

export function usePdfSearch({
  containerRef,
  scrollAreaRef,
  pageRefs,
  revision,
}: UsePdfSearchArgs): PdfSearchControls {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0); // 1-based 表示
  const [capped, setCapped] = useState(false);

  // activeIndex は ref で持つ（連打しても state 更新のタイミングに依存しない）。
  const activeIndexRef = useRef(-1);
  const matchesRef = useRef<PdfSearchMatch[]>([]);

  /** 現在ヒットをスクロール領域の中央に出す。Range には scrollIntoView が無いので rect で計算する。 */
  const scrollActiveIntoView = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    const match = matchesRef.current[activeIndexRef.current];
    if (!scrollArea || !match) return;
    const rect = match.range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const areaRect = scrollArea.getBoundingClientRect();
    const delta = rect.top - areaRect.top - areaRect.height / 2 + rect.height / 2;
    // ヒットが既に視野の中央付近にあるなら動かさない（打鍵ごとに揺れないように）。
    if (Math.abs(delta) < 8) return;
    scrollArea.scrollTop += delta;
  }, [scrollAreaRef]);

  /**
   * 現在の DOM から検索し直してハイライトと件数を更新する。
   * activeIndex は「ヒット数が変わっても近い位置に留まる」よう素直にクランプする。
   */
  const runSearch = useCallback(
    (q: string, cs: boolean, desiredIndex: number, scroll: boolean) => {
      const pages: Array<[number, Element]> = [];
      pageRefs.current.forEach((el, pageNumber) => {
        if (el) pages.push([pageNumber, el]);
      });
      // 検索は DOM 依存の処理なので、想定外の形の text-layer で投げられても
      // アプリごと落とさない（0 件として扱い、バーは開いたままにする）。
      let matches: PdfSearchMatch[] = [];
      if (q.trim()) {
        try {
          matches = searchPages(pages, q, cs);
        } catch (e) {
          console.error("[pdf-search] search failed", e);
          matches = [];
        }
      }
      matchesRef.current = matches;
      const index = matches.length === 0 ? -1 : Math.min(Math.max(desiredIndex, 0), matches.length - 1);
      activeIndexRef.current = index;
      setTotal(matches.length);
      setCapped(matches.length >= MAX_MATCHES);
      setCurrent(index < 0 ? 0 : index + 1);
      applyHighlights(matches, index);
      if (scroll) requestAnimationFrame(scrollActiveIntoView);
    },
    [pageRefs, scrollActiveIntoView],
  );

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      // 新しいクエリは常に先頭ヒットから。
      runSearch(q, caseSensitive, 0, true);
    },
    [runSearch, caseSensitive],
  );

  const toggleCaseSensitive = useCallback(() => {
    const nextCs = !caseSensitive;
    setCaseSensitive(nextCs);
    runSearch(query, nextCs, 0, true);
  }, [runSearch, caseSensitive, query]);

  const move = useCallback(
    (delta: number) => {
      const count = matchesRef.current.length;
      if (count === 0) return;
      const nextIdx = (activeIndexRef.current + delta + count) % count;
      activeIndexRef.current = nextIdx;
      setCurrent(nextIdx + 1);
      applyHighlights(matchesRef.current, nextIdx);
      requestAnimationFrame(scrollActiveIntoView);
    },
    [scrollActiveIntoView],
  );

  const next = useCallback(() => move(1), [move]);
  const prev = useCallback(() => move(-1), [move]);

  const open = useCallback(() => {
    setIsOpen(true);
    // PDF 内に文字選択があれば検索語に流用する（ブラウザ検索の慣習）。
    let initial = query;
    const selection = window.getSelection();
    const container = containerRef.current;
    if (selection && container && !selection.isCollapsed) {
      const anchor = selection.anchorNode;
      const anchorEl =
        anchor?.nodeType === Node.ELEMENT_NODE
          ? (anchor as Element)
          : (anchor?.parentElement ?? null);
      if (anchorEl && container.contains(anchorEl)) {
        const sel = selection.toString().replace(/\s+/g, " ").trim();
        if (sel && sel.length <= 120) initial = sel;
      }
    }
    if (initial !== query) setQueryState(initial);
    if (initial) runSearch(initial, caseSensitive, 0, true);
  }, [containerRef, query, caseSensitive, runSearch]);

  const close = useCallback(() => {
    setIsOpen(false);
    matchesRef.current = [];
    activeIndexRef.current = -1;
    setTotal(0);
    setCapped(false);
    setCurrent(0);
    clearHighlights();
  }, []);

  // Cmd/Ctrl+F。PDF にポインタが乗っている／フォーカスがあるときだけ奪う。
  // capture フェーズで stopPropagation すると、document の bubble で待っている
  // ノート本文検索には届かない（＝どちらか一方だけが開く）。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "f") return;
      const container = containerRef.current;
      if (!container) return;
      const hovered = container.matches(":hover");
      const focused =
        document.activeElement instanceof Node && container.contains(document.activeElement);
      if (!hovered && !focused) return; // ノート本文側に譲る
      e.preventDefault();
      e.stopPropagation();
      open();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [containerRef, open]);

  // ページ描画・ズーム・ドキュメント差し替えで text-layer が作り直されたら、
  // Range が無効になっているので検索し直す（表示位置は動かさない）。
  // ページ描画完了は全ページ分が連続で飛んでくるので、少し待って 1 回にまとめる。
  useEffect(() => {
    if (!isOpen || !query.trim()) return;
    const timer = setTimeout(() => {
      runSearch(query, caseSensitive, activeIndexRef.current, false);
    }, 120);
    return () => clearTimeout(timer);
    // runSearch を依存に入れると scrollActiveIntoView の同一性で毎回走るため、
    // 再インデックスの契機は revision と検索条件に限定する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, isOpen, query, caseSensitive]);

  // アンマウント時にハイライトを残さない。
  useEffect(() => clearHighlights, []);

  return {
    state: { open: isOpen, query, caseSensitive, total, current, capped },
    open,
    close,
    setQuery,
    toggleCaseSensitive,
    next,
    prev,
  };
}
