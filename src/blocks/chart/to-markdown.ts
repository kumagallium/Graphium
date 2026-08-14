// チャート → Markdown（純ロジック）
//
// 図そのものは Markdown に持ち込めない。ただしデータ本体（参照先テーブル）は
// 標準 table として書き出されるので、ここで残すべきは「そのデータをどう見て
// いたか」— キャプションと、何を何に対して描いたか。図が消えたことに気づけない
// のが一番まずいので、静かに落とさず斜体 1 行の痕跡を残す。

import { parseChartBlockConfig, seriesConfigDisplayName } from "./chart-config";
import { textParagraph, type BlockToMarkdown } from "../markdown-block";

export const chartToMarkdown: BlockToMarkdown = (block, ctx) => {
  // 設定は props.config の JSON が正（旧形式は props.sourceBlockId を見て移行される）。
  // 個々の prop を直接読むと、設定項目が config に移った時に静かに陳腐化する。
  const config = parseChartBlockConfig(
    String(block.props?.config ?? ""),
    String(block.props?.sourceBlockId ?? ""),
  );

  // 系列の「Y vs X」を重複なく並べる。ヒストグラムは X が無く Y の分布を見る図
  const pairs: string[] = [];
  for (const series of config.series) {
    const y = seriesConfigDisplayName(series).trim();
    if (!y) continue;
    const x = String(series.xColumn ?? "").trim();
    const pair = config.chartType === "histogram" || !x ? y : `${y} vs ${x}`;
    if (!pairs.includes(pair)) pairs.push(pair);
  }

  const caption = config.caption.trim();
  const detail = [caption, pairs.join(", ")].filter(Boolean).join(" — ");
  const label = detail ? `Chart (${config.chartType}): ${detail}` : `Chart (${config.chartType})`;

  return [textParagraph(label, { italic: true }, ctx.children)];
};
