// 1 ドキュメント内検索（Cmd+F）のコア。
//
// BlockNote は内部で TipTap / ProseMirror を使っている。検索ハイライトは
// ProseMirror の「decoration」（ドキュメントを書き換えず、ビューだけに
// 装飾を重ねる仕組み）で実装する。DOM を直接 <mark> で書き換える方式は
// ProseMirror が次の再描画で巻き戻すため使わない。
//
// プラグインは常時 editor に登録され、検索バーが閉じている間は空の
// DecorationSet を返すだけ。検索の開始・更新・移動・終了はすべて
// transaction の metadata（setMeta）で制御する。React 側は dispatch 後に
// `searchPluginKey.getState(view.state)` でヒット数・現在位置を読み取る。

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { createExtension } from "@blocknote/core";
import { Extension as TiptapExtension } from "@tiptap/core";

export const searchPluginKey = new PluginKey<SearchPluginState>("documentSearch");

/** ヒット 1 件の ProseMirror 位置範囲。 */
export interface SearchMatch {
  from: number;
  to: number;
}

/** プラグインが保持する状態。 */
export interface SearchPluginState {
  query: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  /** 現在フォーカス中のヒット index。ヒット 0 件のときは -1。 */
  activeIndex: number;
  decorations: DecorationSet;
}

/** transaction で送る制御コマンド。 */
export type SearchMeta =
  | { type: "set"; query: string; caseSensitive: boolean; activeIndex: number }
  | { type: "clear" };

// ── マッチ探索 ────────────────────────────────────────────

interface TextRun {
  text: string;
  /** この run の先頭文字の ProseMirror 位置。 */
  pos: number;
}

// ドキュメントを「連続するテキストの塊（run）」に分解する。
// 同じ textblock 内の隣接テキストノード（太字などマークで分割されたもの）は
// 位置的に連続するため 1 つの run に連結する。これにより「he**ll**o」のような
// マーク跨ぎの単語もヒットできる。block 境界（非テキストノード）で run を切る
// ので、別ブロックを跨いだ誤マッチは起きない。
function collectTextRuns(doc: { descendants: (f: (node: any, pos: number) => void) => void }): TextRun[] {
  const runs: TextRun[] = [];
  let current: TextRun | null = null;
  const flush = () => {
    if (current) {
      runs.push(current);
      current = null;
    }
  };
  doc.descendants((node: any, pos: number) => {
    if (node.isText && typeof node.text === "string") {
      // 直前の run と位置的に連続していれば連結、そうでなければ新しい run。
      if (current && current.pos + current.text.length === pos) {
        current.text += node.text;
      } else {
        flush();
        current = { text: node.text, pos };
      }
    } else {
      flush();
    }
  });
  flush();
  return runs;
}

/** doc 全体から query のヒット範囲を文書順に返す。 */
export function findMatches(
  doc: any,
  query: string,
  caseSensitive: boolean,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return matches;

  for (const run of collectTextRuns(doc)) {
    const hay = caseSensitive ? run.text : run.text.toLowerCase();
    let idx = 0;
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      matches.push({ from: run.pos + idx, to: run.pos + idx + query.length });
      idx += needle.length; // 非重複マッチ
    }
  }
  return matches;
}

// ── decoration 構築 ──────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildDecorations(
  doc: any,
  matches: SearchMatch[],
  activeIndex: number,
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class:
        i === activeIndex
          ? "gph-search-match gph-search-match--active"
          : "gph-search-match",
    }),
  );
  return DecorationSet.create(doc, decos);
}

const EMPTY_STATE: SearchPluginState = {
  query: "",
  caseSensitive: false,
  matches: [],
  activeIndex: -1,
  decorations: DecorationSet.empty,
};

// ── プラグイン本体 ───────────────────────────────────────

function createSearchPlugin(): Plugin<SearchPluginState> {
  return new Plugin<SearchPluginState>({
    key: searchPluginKey,
    state: {
      init(): SearchPluginState {
        return EMPTY_STATE;
      },
      apply(tr, value, _oldState, newState: EditorState): SearchPluginState {
        const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;

        if (meta) {
          if (meta.type === "clear") {
            // case-sensitive 設定だけは次の検索のために引き継ぐ。
            return { ...EMPTY_STATE, caseSensitive: value.caseSensitive };
          }
          // meta.type === "set"
          const matches = findMatches(newState.doc, meta.query, meta.caseSensitive);
          const activeIndex =
            matches.length === 0 ? -1 : clamp(meta.activeIndex, 0, matches.length - 1);
          return {
            query: meta.query,
            caseSensitive: meta.caseSensitive,
            matches,
            activeIndex,
            decorations: buildDecorations(newState.doc, matches, activeIndex),
          };
        }

        // metadata 無し。検索バーが開いていて（query あり）本文が変わったら、
        // 編集に追従してハイライトを再計算する。
        if (value.query && tr.docChanged) {
          const matches = findMatches(newState.doc, value.query, value.caseSensitive);
          const activeIndex =
            matches.length === 0 ? -1 : clamp(value.activeIndex, 0, matches.length - 1);
          return {
            ...value,
            matches,
            activeIndex,
            decorations: buildDecorations(newState.doc, matches, activeIndex),
          };
        }

        // それ以外（カーソル移動など本文非変更）は decoration を maps して維持。
        if (tr.docChanged && value.decorations !== DecorationSet.empty) {
          return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) };
        }

        return value;
      },
    },
    props: {
      decorations(state) {
        return searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * BlockNote の editor 生成時に `extensions` へ渡す検索拡張。
 * 既存の preserveChildIndentOnBackspace と同じ createExtension パターン。
 */
export const documentSearchExtension = createExtension({
  key: "document-search",
  tiptapExtensions: [
    TiptapExtension.create({
      name: "documentSearch",
      addProseMirrorPlugins() {
        return [createSearchPlugin()];
      },
    }),
  ],
});
