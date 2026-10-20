// マルチカラムレイアウト（columnList / column）の prop とレイアウト定数。
//
// BlockNote 0.56 から、段組みは core の「layout block」（`layoutOnly: true` のブロック spec。
// 自分の content を持たず、自分のノードが子ブロックを直接抱える）として宣言する
// （index.ts）。それまでは ProseMirror ノードを手書きして createBlockSpecFromTiptapNode に
// 渡していたが、0.56 の core は layout block を spec の `layoutOnly` / `children` で見分け、
// 手書きノードは「子を持たない普通のブロック」として扱って段組みを丸ごと落とす。
//
// ⚠️ 型名（"columnList" / "column"）を変えてはいけない。core の UniqueID は
//    ["blockContainer", "columnList", "column"] に id を払い出すハードコードで、
//    別名にすると id が管理されず nodeToBlock が毎回新 id を生成してしまう。
//    core の SideMenu も [data-node-type=columnList] / [data-node-type=column] で
//    ドラッグハンドルの位置補正を行っている（枠の data-node-type は core が付ける）。

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
