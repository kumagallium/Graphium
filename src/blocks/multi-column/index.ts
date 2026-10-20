// マルチカラムレイアウト（columnList / column）の登録エントリー
//
// ⚠️ registry.ts の customBlockEntries に **両方** 必ず登録すること。
// columnList と column は別のブロック型で、どちらか一方でも
// KNOWN_BLOCK_TYPES から漏れると sanitizeBlocks（note-app.tsx / side-peek.tsx）が
// カラムを children ごと除去したまま自動保存し、カラム内の全ブロック
// （本文・表・画像）が道連れでユーザーのデータから消える。
//
// BlockNote 0.56 からは core の「layout block」として宣言する（`layoutOnly: true`。
// 自分の content を持たず、子ブロックを自分のノードに直接抱える。枠は renderFrame が描き、
// core が子を slot に入れる）。columnList は column だけを 2 つ以上持ち（1 つになれば
// core が解消する）、column は columnList 以外のどのブロックも持てる。column は
// `placeable: "namedOnly"`（columnList の中にしか置けない）。
// 枠の data-id / data-node-type / data-width は core が付ける（column-resize.ts と
// drop-to-columns.ts の [data-node-type="column"] セレクタはそのまま効く）。
import { createBlockSpec } from "@blocknote/core";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";
import { columnPropSchema } from "./nodes";

export { columnResizeExtension } from "./column-resize";

const ColumnListBlock = createBlockSpec(
  {
    type: "columnList",
    propSchema: {},
    content: "none",
    layoutOnly: true,
    children: { allow: ["column"], min: 2 },
  },
  {
    // 段組み全体はドラッグしない（ハンドルは中の列・ブロックに付く）
    meta: { draggable: false },
    parse: (el) =>
      el.classList.contains("gph-column-list") || el.getAttribute("data-node-type") === "columnList"
        ? {}
        : undefined,
    renderFrame: () => {
      const dom = document.createElement("div");
      dom.className = "gph-column-list";
      return { dom, slot: dom };
    },
  },
);

const ColumnBlock = createBlockSpec(
  {
    type: "column",
    propSchema: columnPropSchema,
    content: "none",
    layoutOnly: true,
    placeable: "namedOnly",
    children: { allow: "blocks", exclude: ["columnList"] },
  },
  {
    // 列の末尾の空段落で Enter を押しても列の外へ出ない（0.55 までの content
    // "blockContainer+" の振る舞いと同じ）
    experimental_keyboard: { emptyChildEnter: "stay" },
    parse: (el) =>
      el.classList.contains("gph-column") || el.getAttribute("data-node-type") === "column"
        ? {}
        : undefined,
    renderFrame: (block) => {
      const dom = document.createElement("div");
      dom.className = "gph-column";
      // flex-grow でカラム幅の比率を表現する。合計値に対する割合が幅になる。
      dom.style.flexGrow = String(block.props.width ?? 1);
      return {
        dom,
        slot: dom,
        update: (next) => {
          dom.style.flexGrow = String(next.props.width ?? 1);
        },
      };
    },
  },
);

// createBlockSpec はファクトリ（options を受けて spec を返す関数）を返す。ここで呼んで
// 素の spec にしておく（テストや他の組み立て口が `.spec` をそのまま blockSpecs に置けるように。
// base/editor.tsx は関数でも素でも受ける）
export const columnListBlock: CustomBlockEntry = {
  type: "columnList",
  spec: ColumnListBlock(),
};

export const columnBlock: CustomBlockEntry = {
  type: "column",
  spec: ColumnBlock(),
};

// スラッシュメニュー用アイテム（現在のブロックの後ろに 2 カラムを挿入）
export const columnsSlashItem = {
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.columns"); },
  get subtext() { return t("slash.columnsSub"); },
  get group() { return t("slash.advancedGroup"); },
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;

    // カラム内から実行された場合は、最外の columnList の後ろに挿入する。
    // column の content は "blockContainer+" で columnList を受け入れないため、
    // カラム内ブロックを reference に "after" 挿入すると TransformError で
    // 何も起きない（カラムのネストはスキーマ上そもそも不可能）。
    let insertRef = currentBlock;
    for (let b = currentBlock; b; ) {
      const parent = editor.getParentBlock(b);
      if (parent?.type === "columnList") insertRef = parent;
      b = parent;
    }

    const inserted = editor.insertBlocks(
      [
        {
          type: "columnList",
          children: [
            { type: "column", children: [{ type: "paragraph" }] },
            { type: "column", children: [{ type: "paragraph" }] },
          ],
        },
      ],
      insertRef,
      "after",
    );

    // 現在のブロックが空（スラッシュだけ）なら削除して置き換える。
    // ただしカラムの唯一の子は削除しない（column の content は blockContainer+
    // で空を許さないため、削除すると TransformError になる）
    const content = currentBlock.content;
    const isEmpty =
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] ||
        (content[0].type === "text" &&
          content[0].text.replace("/", "").trim() === ""));
    const parent = editor.getParentBlock(currentBlock);
    const isOnlyChildOfColumn =
      parent?.type === "column" && (parent.children?.length ?? 0) <= 1;
    if (isEmpty && !isOnlyChildOfColumn) {
      editor.removeBlocks([currentBlock]);
    }

    // カーソルを 1 カラム目の先頭段落へ
    const firstParagraph = inserted?.[0]?.children?.[0]?.children?.[0];
    if (firstParagraph) {
      editor.setTextCursorPosition(firstParagraph, "start");
    }
  },
  aliases: [
    "columns", "column", "layout", "2col",
    "カラム", "からむ", "段組み", "だんぐみ", "列", "横並び",
  ],
};
