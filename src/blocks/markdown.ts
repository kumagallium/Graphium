// カスタムブロックの Markdown 変換レジストリ
//
// 新しいカスタムブロックを追加したら、その隣に to-markdown.ts を書いてここに
// 登録する。登録しないと Markdown 書き出しで未知ブロック扱いになり、
// content: "none" のブロック（チャート・計算・PDF 等）は本文テキストを持たない
// ので跡形もなく消える。
//
// 集約する理由は registry.ts と同じで「人の記憶に頼ると必ず漏れる」から。
// 実際に 3 通りの壊れ方をしていた:
//   - chart: 変換は書かれていたが props.xColumn を読んでいた。設定が props.config
//     の JSON に移った後も古い prop を見ていて、常に "(Chart)" しか出なかった
//   - calc: 変換が無く、式も結果も書き出しから丸ごと消えていた
//   - pdf:  型名を "pdfViewer" と綴っていた（実際は "pdf"）。テストが同じ綴りで
//     書かれていたため緑のまま、実データには一度も効いていなかった
// registry.test.ts が customBlockEntries との差分を検出する。
//
// このファイルは純ロジックだけを import する（React / echarts / react-pdf を
// 引き込まない）。ヘッドレス変換とユニットテストがブラウザ抜きで動くため。

import type { BlockToMarkdown } from "./markdown-block";
import { pdfViewerToMarkdown } from "./pdf-viewer/to-markdown";
import { bookmarkToMarkdown } from "./bookmark/to-markdown";
import { calloutToMarkdown } from "./callout/to-markdown";
import { stepToMarkdown } from "./step/to-markdown";
import { mathToMarkdown } from "./math/to-markdown";
import { chartToMarkdown } from "./chart/to-markdown";
import { calcToMarkdown } from "./calc/to-markdown";
import { columnContainerToMarkdown } from "./multi-column/to-markdown";
import { sharedCitationToMarkdown } from "./shared-citation/to-markdown";
import { dataTableToMarkdown } from "./data-table/to-markdown";

/** ブロック type → Markdown 落とし込み。キーは registry.ts の CUSTOM_BLOCK_TYPES と一致させる */
export const blockMarkdownConverters: Record<string, BlockToMarkdown> = {
  pdf: pdfViewerToMarkdown,
  bookmark: bookmarkToMarkdown,
  callout: calloutToMarkdown,
  step: stepToMarkdown,
  math: mathToMarkdown,
  chart: chartToMarkdown,
  calc: calcToMarkdown,
  columnList: columnContainerToMarkdown,
  column: columnContainerToMarkdown,
  sharedCitation: sharedCitationToMarkdown,
  dataTable: dataTableToMarkdown,
};

export type { BlockToMarkdown, MarkdownBlock, MarkdownBlockContext } from "./markdown-block";
