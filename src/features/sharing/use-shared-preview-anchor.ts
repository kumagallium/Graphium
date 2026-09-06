// 共有エントリのプレビューで「この段落に」コメントを付ける仕掛け。
//
// なぜフックに出したか:
//   詳細パネル（サイドピーク）と全画面表示（SharedNoteView）の両方で同じ操作を
//   出す。段落の拾い方（DOM 起点 → カーソル位置）と強調表示（動的 <style>）を
//   二重に持つと、片方だけ挙動がずれて「同じ画面なのに付け方が違う」ことになる。
//
// 守っていること:
//   - エディタの DOM を直接いじらない。強調は CSS 側に持つ
//     （BlockNote が描き直すと直書きしたスタイルは消えるため）
//   - 動的 <style> はプレビューごとの目印（data-preview-scope）で閉じる。
//     ノート編集画面と同じ id 選択子を使うので、スコープ無しだと本文側の
//     同じ id のブロックまで塗る
//
// 設計詳細: docs/internal/team-shared-storage-design.md §21 A / §22 B

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type React from "react";
import type { SharedEntryType } from "../../lib/storage/shared";
// メモの ¶ チップと同じ関数で抜粋を作る（作成時と表示時の見え方を揃える）。
// features/mobile-capture の index はモバイル取り込みの UI まで引き込むため直接参照する
import { resolveMemoBlockLabel } from "../mobile-capture/block-label";
import type { SharedCommentAnchor } from "./SharedCommentsThread";

export type SharedPreviewAnchor = {
  /** プレビューの外枠に付ける ref（この中だけを段落の探索範囲にする） */
  previewRef: React.MutableRefObject<HTMLDivElement | null>;
  /** 動的 <style> を効かせる目印。`data-preview-scope` に入れる */
  previewScopeId: string;
  /** プレビューのクリック（段落の指定を付け外しする） */
  handlePreviewClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 読み取り専用エディタの実体を受け取る（SharedEntryBody の onEditorReady） */
  handleEditorReady: (editor: any) => void;
  /** いま選んでいる段落（未選択なら null） */
  pendingAnchor: SharedCommentAnchor | null;
  clearAnchor: () => void;
  /** ¶ チップのライブ解決（消えていれば付けた時点の控えに戻す） */
  anchorLabel: (blockId: string, fallback: string) => string;
  /** コメントのカード / ¶ チップ → 該当ブロックへスクロール + 一時ハイライト */
  jumpToBlock: (blockId: string) => void;
};

export function useSharedPreviewAnchor(entryType: SharedEntryType): SharedPreviewAnchor {
  // プレビュー（read-only エディタ）の DOM とエディタ実体。
  // 「段落に付ける」「該当ブロックへ飛ぶ」の両方でここを起点にする
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewEditorRef = useRef<any>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<SharedCommentAnchor | null>(null);
  const previewScopeId = useId();
  const previewStyleRef = useRef<HTMLStyleElement | null>(null);

  const handleEditorReady = useCallback((editor: any) => {
    previewEditorRef.current = editor;
  }, []);

  /** プレビュー内のブロック要素（自分のプレビューの中だけを探す。本文側の同 id を掴まない） */
  const findBlockEl = useCallback((blockId: string): HTMLElement | null => {
    const root = previewRef.current;
    if (!root || !blockId) return null;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(blockId)
        : blockId;
    return root.querySelector(
      `[data-id="${escaped}"][data-node-type="blockOuter"]`,
    ) as HTMLElement | null;
  }, []);

  /** 現在の本文からブロックの抜粋を出す（消えていれば付けた時点の控えに戻す） */
  const anchorLabel = useCallback((blockId: string, fallback: string): string => {
    try {
      const block = previewEditorRef.current?.getBlock?.(blockId);
      return resolveMemoBlockLabel(block) || fallback;
    } catch {
      // ブロックが消えている / エディタがまだ無い → 墓標（付けた時点の抜粋）
      return fallback;
    }
  }, []);

  /**
   * プレビューで段落を選ぶ = その段落にコメントを付ける指定。
   *
   * read-only のエディタではキャレットが立たない環境があるため、
   * まず DOM（blockOuter の data-id）から拾い、取れないときだけ
   * エディタのカーソル位置に頼る。
   */
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 段落を持つのはノート / ナレッジのプレビューだけ（素材・URL には付けない）
      if (entryType !== "note" && entryType !== "knowledge") return;
      const target = e.target as HTMLElement | null;
      const el = target?.closest?.('[data-node-type="blockOuter"]') as HTMLElement | null;
      const blockId =
        el?.getAttribute("data-id") ??
        previewEditorRef.current?.getTextCursorPosition?.()?.block?.id ??
        null;
      if (!blockId) return;
      let label = "";
      try {
        label = resolveMemoBlockLabel(previewEditorRef.current?.getBlock?.(blockId));
      } catch {
        // 抜粋が取れなくてもブロックの指定自体は成立する
      }
      // 同じ段落をもう一度クリックしたら指定を外す（付け外しを同じ操作で行う）
      setPendingAnchor((prev) =>
        prev?.blockId === blockId ? null : { blockId, blockText: label },
      );
    },
    [entryType],
  );

  /** コメントのカード / ¶ チップ → プレビューの該当ブロックへスクロール + 一時ハイライト */
  const jumpToBlock = useCallback(
    (blockId: string) => {
      const el = findBlockEl(blockId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // ノート編集画面の highlightBlockIds と違い、ここは一時的な目印だけで足りる
      // （常時の印はエディタに出さない ＝ #587 の決定）
      el.style.transition = "background-color 0.2s ease";
      el.style.backgroundColor = "rgba(59, 130, 246, 0.12)";
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => {
        el.style.backgroundColor = "";
        highlightTimerRef.current = null;
      }, 1600);
    },
    [findBlockEl],
  );

  useEffect(
    () => () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  /**
   * 選んでいる段落の常時ハイライト（+ 段落が押せることを示す cursor / hover）。
   *
   * ノート編集画面の highlightBlockIds と同じ方式・同じ見た目にする
   * （動的 <style> でブロックの外枠に当てる）。
   */
  const anchoredBlockId = pendingAnchor?.blockId ?? null;
  const previewClickable = entryType === "note" || entryType === "knowledge";
  useEffect(() => {
    const scope = `[data-preview-scope="${previewScopeId}"]`;
    const rules: string[] = [];
    if (previewClickable) {
      rules.push(
        `${scope} [data-node-type="blockOuter"] { cursor: pointer; }`,
        `${scope} [data-node-type="blockOuter"]:hover { background: rgba(59, 130, 246, 0.04); }`,
      );
    }
    if (anchoredBlockId) {
      const escaped =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(anchoredBlockId)
          : anchoredBlockId;
      rules.push(
        `${scope} [data-id="${escaped}"][data-node-type="blockOuter"] {
  background: rgba(59, 130, 246, 0.08);
  border-left: 2px solid rgba(59, 130, 246, 0.5);
  transition: background 0.2s ease;
}`,
      );
    }
    if (rules.length === 0) {
      previewStyleRef.current?.remove();
      previewStyleRef.current = null;
      return;
    }
    let styleEl = previewStyleRef.current;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.dataset.sharedPreviewHighlight = previewScopeId;
      document.head.appendChild(styleEl);
      previewStyleRef.current = styleEl;
    }
    styleEl.textContent = rules.join("\n");
  }, [previewScopeId, previewClickable, anchoredBlockId]);

  // 画面を閉じたら <style> も片付ける（別のエントリを開くと key remount される）
  useEffect(
    () => () => {
      previewStyleRef.current?.remove();
      previewStyleRef.current = null;
    },
    [],
  );

  const clearAnchor = useCallback(() => setPendingAnchor(null), []);

  return {
    previewRef,
    previewScopeId,
    handlePreviewClick,
    handleEditorReady,
    pendingAnchor,
    clearAnchor,
    anchorLabel,
    jumpToBlock,
  };
}
