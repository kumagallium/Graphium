// マルチカラム → Markdown（純ロジック）
//
// Markdown はレイアウトを持たないので、カラムの中身をカラム 1 → カラム 2 の順に
// そのまま持ち上げ、ラッパー（columnList / column）は捨てる。
// 段落に落とすと空 paragraph が挟まって出力が汚れる。

import type { BlockToMarkdown } from "../markdown-block";

/** columnList / column に共通（どちらも自分は消えて子だけが残る） */
export const columnContainerToMarkdown: BlockToMarkdown = (_block, ctx) => ctx.children;
