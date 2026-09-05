// カスタムブロックレジストリ
// 新しいカスタムブロックを追加するときはこのファイルに登録すれば、
// メインエディタ（NoteEditor）と SidePeek の両方で自動的に表示・編集可能になる。
//
// 過去に side-peek.tsx だけ KNOWN_BLOCK_TYPES から取りこぼし、
// Peek を開いた瞬間にカスタムブロックが除去されたまま自動保存されて
// データが壊れる不具合が起きたため、登録漏れを構造的に防ぐ目的で集約する。

import { defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { inlineLabelStyleSpecs } from "../features/inline-label/styles";
import type { CustomBlockEntry } from "../base/schema";
import { pdfViewerBlock } from "./pdf-viewer";
import { bookmarkBlock } from "./bookmark";
import { calloutBlock } from "./callout";
import { stepBlock } from "./step";
import { mathBlock } from "./math";
import { chartBlock } from "./chart";
import { calcBlock } from "./calc";
import { columnListBlock, columnBlock } from "./multi-column";
import { sharedCitationBlock } from "./shared-citation";
import { dataTableBlock } from "./data-table";

// この配列に載せるのは「BlockNote が知らないブロック型」だけ。
// 標準型（image / video / audio）の spec 差し替えはここに置かない —— 外部メディア
// ゲートの差し替えは base/editor.tsx が schema を組む所で標準 spec に被せている
// （blocks/remote-content）。ここに混ぜると markdown.ts の変換レジストリと
// CUSTOM_BLOCK_TYPES が「標準型なのにカスタム扱い」になってしまう。
export const customBlockEntries: CustomBlockEntry[] = [
  pdfViewerBlock,
  bookmarkBlock,
  calloutBlock,
  stepBlock,
  mathBlock,
  chartBlock,
  calcBlock,
  // マルチカラムは columnList と column の 2 型セット。
  // 片方でも欠けると sanitizeBlocks がカラムを children ごと消す。
  columnListBlock,
  columnBlock,
  sharedCitationBlock,
  dataTableBlock,
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
      // 未知 style の除去（下記）は BlockNote の throw を防ぐ共通処理。
      // mapContent（呼び出し元ごとの inline 検査）とは独立に必ず通す。
      content: sanitizeContentStyles(mapContent ? mapContent(b.content) : b.content),
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
  "inlineImage",
]);

// 保存済みノートを読み込むときに「知っているインライン型」の集合。
export const KNOWN_INLINE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "link",
  ...CUSTOM_INLINE_TYPES,
]);

// 保存済みノートを読み込むときに「知っている style キー」の集合。
// BlockNote は styleSchema に無い style キーを含むコンテンツで throw するため
// （silent drop ではなく画面全損）、未来のビルドが保存したノートを
// このビルドが開けるように、未知キーは読込時に剥がす。
// ブロック型と同じく schema の実物（defaultStyleSpecs / inlineLabelStyleSpecs）
// から導出する — 手書きの列挙は style を足した時に取りこぼす。
export const KNOWN_STYLE_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(defaultStyleSpecs),
  ...Object.keys(inlineLabelStyleSpecs),
]);

// inline ノードの styles / ネスト content から未知 style キーを取り除く。
// 剥がすのは throw 回避のための最終手段で、識別情報は失われる（たとえば
// tableRowIdentity は次の保存で再採番される）。既知キーには一切触れない。
function sanitizeInlineStyles(inline: any): any {
  if (!inline || typeof inline !== "object") return inline;
  let next = inline;
  const styles = inline.styles;
  if (styles && typeof styles === "object") {
    const unknown = Object.keys(styles).filter((key) => !KNOWN_STYLE_KEYS.has(key));
    if (unknown.length > 0) {
      const kept = Object.fromEntries(
        Object.entries(styles).filter(([key]) => KNOWN_STYLE_KEYS.has(key)),
      );
      next = { ...next, styles: kept };
    }
  }
  if (Array.isArray(next.content)) {
    const content = next.content.map(sanitizeInlineStyles);
    if (content.some((c: any, i: number) => c !== next.content[i])) {
      next = { ...next, content };
    }
  }
  return next;
}

// ブロックの content（inline 配列 / テーブル content）から未知 style キーを剥がす。
// テーブルはセル内 inline の styles に永続 mark が入るため、rows/cells も再帰する。
export function sanitizeContentStyles(content: any): any {
  if (!content) return content;
  if (Array.isArray(content)) {
    const next = content.map(sanitizeInlineStyles);
    return next.some((c: any, i: number) => c !== content[i]) ? next : content;
  }
  if (typeof content === "object" && Array.isArray(content.rows)) {
    const rows = content.rows.map((row: any) => {
      if (!Array.isArray(row?.cells)) return row;
      const cells = row.cells.map((cell: any) => {
        if (Array.isArray(cell)) return sanitizeContentStyles(cell);
        if (cell && typeof cell === "object" && Array.isArray(cell.content)) {
          const inner = sanitizeContentStyles(cell.content);
          return inner === cell.content ? cell : { ...cell, content: inner };
        }
        return cell;
      });
      return cells.some((c: any, i: number) => c !== row.cells[i]) ? { ...row, cells } : row;
    });
    return rows.some((r: any, i: number) => r !== content.rows[i]) ? { ...content, rows } : content;
  }
  return content;
}
