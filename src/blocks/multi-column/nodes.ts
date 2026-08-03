// マルチカラムレイアウトの ProseMirror ノード定義（自前実装）。
//
// BlockNote core (MPL-2.0) は "columnList" / "column" というノード名を前提に
// カラム対応が焼き込まれている（UniqueID の id 管理、Backspace/Delete での
// カラム間移動、SideMenu の位置補正、moveBlocks のカラム展開、fixColumnList
// による整合性修復など）。ノード名・グループ・content 式を core の想定に
// 合わせることで、これらの挙動をそのまま利用する。
//
// 根拠は core の pm-nodes/README.md（MPL-2.0）に公開されているスキーマ仕様:
//   columnList: group "childContainer bnBlock blockGroupChild", content "column column+"
//   column:     group "bnBlock childContainer",                 content "blockContainer+"
//
// ⚠️ ノード名を変えてはいけない。core の UniqueID は
//    ["blockContainer", "columnList", "column"] に id を払い出すハードコードで、
//    別名にすると id が管理されず nodeToBlock が毎回新 id を生成してしまう。
//
// ⚠️ renderHTML は必ず data-node-type 属性を出すこと。core の SideMenu が
//    [data-node-type=columnList] / [data-node-type=column] セレクタで
//    ドラッグハンドルの位置補正を行っている。
import { Node } from "@tiptap/core";
import { propsToAttributes } from "@blocknote/core";

// column の props。width は flex-grow 比率（既定 1 = 等分）。
// リサイズ時に隣接 2 カラムの width を更新する。
export const columnPropSchema = {
  width: { default: 1 },
} as const;

// レイアウト定数 — app.css の .gph-column { min-width: min(220px, 100%) } と
// .gph-column-list { gap: 12px } の値とペア。変えるときは両方を揃えること。
// リサイズのピクセル下限クランプ（column-resize.ts）と wrap ゾーンの最小幅
// 判定（drop-to-columns.ts）が参照する。
export const COLUMN_MIN_WIDTH_PX = 220;
export const COLUMN_GAP_PX = 12;

export const ColumnListNode = Node.create({
  name: "columnList",
  group: "childContainer bnBlock blockGroupChild",
  // 最低 2 カラム。core の fixColumnList はカラム 2 未満の columnList を
  // 想定しない（throw する）ため、PM の content 制約で 2 以上を保証する。
  // カラムが 1 つになる操作では PM が自動的に columnList を解消する。
  content: "column column+",
  defining: true,

  parseHTML() {
    return [{ tag: `div[data-node-type="${this.name}"]` }];
  },

  // BlockNote の defaultBlockToHTML（Markdown/HTML 書き出しで使われる）は
  // renderHTML が {dom, contentDOM} のオブジェクト形式を返すことを要求する。
  // 配列形式（["div", {...}, 0]）だと書き出し時に throw する。
  // contentDOM を必ず返すこと — 無いと core の serializeBlocksExternalHTML が
  // カラムの中身を黙って捨てる（Markdown 書き出しでの無音全損）。
  renderHTML({ HTMLAttributes }) {
    const dom = document.createElement("div");
    dom.className = "gph-column-list";
    dom.setAttribute("data-node-type", this.name);
    for (const [attribute, value] of Object.entries(HTMLAttributes)) {
      if (attribute !== "class" && value != null) {
        dom.setAttribute(attribute, String(value));
      }
    }
    return { dom, contentDOM: dom };
  },
});

export const ColumnNode = Node.create({
  name: "column",
  group: "bnBlock childContainer",
  content: "blockContainer+",
  defining: true,

  addAttributes() {
    // propSchema と同じ定義から tiptap attribute を生成する
    // （data-width として HTML に永続化され、nodeToBlock が props に読み戻す）
    return propsToAttributes(columnPropSchema);
  },

  parseHTML() {
    return [{ tag: `div[data-node-type="${this.name}"]` }];
  },

  // columnList と同じくオブジェクト形式 + contentDOM 必須（上のコメント参照）
  renderHTML({ node, HTMLAttributes }) {
    const dom = document.createElement("div");
    dom.className = "gph-column";
    dom.setAttribute("data-node-type", this.name);
    // flex-grow でカラム幅の比率を表現する。合計値に対する割合が幅になる。
    dom.style.flexGrow = String(node.attrs.width ?? 1);
    for (const [attribute, value] of Object.entries(HTMLAttributes)) {
      if (attribute !== "class" && attribute !== "style" && value != null) {
        dom.setAttribute(attribute, String(value));
      }
    }
    return { dom, contentDOM: dom };
  },
});
