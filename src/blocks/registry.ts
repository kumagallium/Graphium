// カスタムブロックレジストリ
// 新しいカスタムブロックを追加するときはこのファイルに登録すれば、
// メインエディタ（NoteEditor）と SidePeek の両方で自動的に表示・編集可能になる。
//
// 過去に side-peek.tsx だけ KNOWN_BLOCK_TYPES から取りこぼし、
// Peek を開いた瞬間にカスタムブロックが除去されたまま自動保存されて
// データが壊れる不具合が起きたため、登録漏れを構造的に防ぐ目的で集約する。

import { defaultBlockSpecs } from "@blocknote/core";
import type { CustomBlockEntry } from "../base/schema";
import { pdfViewerBlock } from "./pdf-viewer";
import { bookmarkBlock } from "./bookmark";
import { calloutBlock } from "./callout";
import { stepBlock } from "./step";
import { mathBlock } from "./math";
import { chartBlock } from "./chart";
import { columnListBlock, columnBlock } from "./multi-column";
import { sharedCitationBlock } from "./shared-citation";

export const customBlockEntries: CustomBlockEntry[] = [
  pdfViewerBlock,
  bookmarkBlock,
  calloutBlock,
  stepBlock,
  mathBlock,
  chartBlock,
  // マルチカラムは columnList と column の 2 型セット。
  // 片方でも欠けると sanitizeBlocks がカラムを children ごと消す。
  columnListBlock,
  columnBlock,
  sharedCitationBlock,
];

export const CUSTOM_BLOCK_TYPES: ReadonlySet<string> = new Set(
  customBlockEntries.map((b) => b.type),
);

// BlockNote 標準ブロック型。エディタのスキーマ（base/editor.tsx）は
// defaultBlockSpecs を丸ごと注ぎ込むため、ここも同じソースから導出する。
// 手書きの列挙は BlockNote のアップグレードでデフォルト型が増えた時に
// 取りこぼす（実際に divider / toggleListItem が漏れて、/div で入れた
// 区切り線が読込サニタイズで除去→自動保存で恒久消失した）。
const DEFAULT_BLOCK_TYPES: ReadonlySet<string> = new Set(
  Object.keys(defaultBlockSpecs),
);

// 保存済みノートを読み込むときに「知っているブロック型」の集合。
// note-app.tsx / side-peek.tsx の sanitizeBlocks が、これに無いブロックを
// 除去して自動保存するため、カスタムブロックの登録漏れは即データ損失になる。
// 両ファイルで別々に組み立てると片方が取りこぼすので（実際に side-peek で
// 発生した）、ここ 1 箇所に集約する。
export const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...DEFAULT_BLOCK_TYPES,
  ...CUSTOM_BLOCK_TYPES,
]);

// 保存済みノートを読み込むときのブロックサニタイズ（note-app / SidePeek 共用）。
//
// 未知ブロック型の除去に加えて、カラム（columnList / column）の構造修復を行う。
// 修復が必要な理由: columnList は「column 2 本以上」、column は「子 1 個以上」が
// ProseMirror の content 制約で、これを破る JSON を initialContent に渡すと
// BlockNoteEditor.create が throw してノートが開けなくなる（メインエディタには
// エラーバウンダリが無いので画面全損）。型 filter だけだと「カラムの唯一の子が
// 未知型」のような version skew でこの不正構造が生まれ得る。
//
// - 未知型: ブロック自体は落とすが、children は持ち上げて温存する
//   （コンテナ型の中身まで道連れにしない。旧来は children ごと消していた）
// - 空になった column: drop
// - column が 1 本以下になった columnList: 解消して中身を持ち上げる
// - columnList 直下の column 以外の子: 外に持ち上げる
export function sanitizeBlocksForLoad(
  blocks: any[],
  mapContent?: (content: any) => any,
): any[] {
  const out: any[] = [];
  for (const b of blocks ?? []) {
    if (!b || typeof b.type !== "string" || !KNOWN_BLOCK_TYPES.has(b.type)) {
      // 未知型: 子だけ持ち上げて温存
      if (b?.children?.length) out.push(...sanitizeBlocksForLoad(b.children, mapContent));
      continue;
    }
    const children = b.children?.length
      ? sanitizeBlocksForLoad(b.children, mapContent)
      : b.children;

    if (b.type === "column") {
      // 空カラムは PM content 制約（blockContainer+）違反 → drop
      if (!children || children.length === 0) continue;
      out.push({ ...b, children });
      continue;
    }
    if (b.type === "columnList") {
      const cols = (children ?? []).filter((c: any) => c.type === "column");
      const strays = (children ?? []).filter((c: any) => c.type !== "column");
      if (cols.length >= 2) {
        out.push({ ...b, children: cols });
      } else if (cols.length === 1) {
        // 単一カラムは columnList ごと解消して中身を持ち上げる
        out.push(...(cols[0].children ?? []));
      }
      // column 以外の子（不正構造）は外に持ち上げて温存
      out.push(...strays);
      continue;
    }
    out.push({
      ...b,
      content: mapContent ? mapContent(b.content) : b.content,
      children,
    });
  }
  return out;
}

// カスタムインラインコンテンツ（本文の途中に埋まる独自要素）の型。
// ブロックと同じ理由でここに集約する: note-app.tsx の sanitizeInlineContent が
// この集合に無い inline を除去して自動保存するため、登録漏れは即データ損失になる
// （実際に inlineMath を足したとき、ここに無いせいで本文から数式だけが消えた）。
export const CUSTOM_INLINE_TYPES: ReadonlySet<string> = new Set([
  "inlineMath",
]);

// 保存済みノートを読み込むときに「知っているインライン型」の集合。
export const KNOWN_INLINE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "link",
  ...CUSTOM_INLINE_TYPES,
]);
