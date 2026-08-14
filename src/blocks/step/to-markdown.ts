// step コンテナ → Markdown（純ロジック）
//
// カードの枠は捨て、タイトルを H2、中身をその下に置く。移行前の
// 「procedure ラベル付き H2 + スコープ」と同じ体裁なので、工程の階層が
// 外部の Markdown ツールでもそのまま読める。

import type { BlockToMarkdown } from "../markdown-block";

export const stepToMarkdown: BlockToMarkdown = (_block, ctx) => [
  {
    type: "heading",
    props: { level: 2 },
    content: ctx.inlines,
    children: ctx.children,
  },
];
