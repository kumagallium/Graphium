// チャート → Markdown（純ロジック）
//
// 図そのものは Markdown に持ち込めない。ただしデータ本体（参照先テーブル）は
// 標準 table として書き出されるので、ここで残すべきは「そのデータをどう見て
// いたか」— キャプションと、何を何に対して描いたか。図が消えたことに気づけない
// のが一番まずいので、静かに落とさず斜体 1 行の痕跡を残す。
//
// 系列名は画面の凡例と同じ規則で解決する（スタック時はテーブル名、それ以外は
// 列名）。凡例と書き出しで別の名前が出ると、図と Markdown を並べた人が
// 対応を取れない。

import {
  assetFileIdFromKey,
  assetSourceLabel,
  isStackActive,
  parseChartBlockConfig,
  seriesConfigDisplayName,
  stackSeriesDisplayName,
  type ChartBlockConfig,
} from "./chart-config";
import { textParagraph, type BlockToMarkdown, type MarkdownBlockContext } from "../markdown-block";

/** 系列の表示名。view.tsx の凡例と同じ解決順にする */
function seriesNames(config: ChartBlockConfig, ctx: MarkdownBlockContext): string[] {
  // 軸の種類はデータを読まないと決まらないので渡さない。category 軸のときだけ
  // 画面はスタックを外すが、その差はここでは名前の出所が変わるだけで済む
  const stacked = isStackActive(config);
  // 参照先の名前: ノート内テーブルはキャプション、素材は素材名（画面の段名と同じ規則）
  const sourceLabel = (key: string): string | undefined => {
    const fileId = assetFileIdFromKey(key);
    if (fileId === null) return ctx.tableNames?.get(key);
    const source = config.assetSources.find((a) => a.fileId === fileId);
    return source ? assetSourceLabel(source) : undefined;
  };
  return config.series.map((series) =>
    stacked
      ? stackSeriesDisplayName(series, sourceLabel(series.sourceBlockId))
      : seriesConfigDisplayName(series),
  );
}

/**
 * 「何を何に対して描いたか」の一文。
 * X が全系列で共通なら 1 回だけ書く（`d, I vs 2theta`）。
 * ヒストグラムは X を持たず、Y の分布を見る図なので Y だけ並べる。
 */
function describeSeries(config: ChartBlockConfig, names: string[]): string {
  const shown = names.map((n) => n.trim()).filter(Boolean);
  if (shown.length === 0) return "";

  const unique = [...new Set(shown)];
  // 名前が重なって潰れた分（キャプションも系列名も無いスペクトル比較など）は
  // 段数で補う。黙って 1 本に見えるほうが誤解を生む
  const count = unique.length < shown.length ? ` (${shown.length} series)` : "";

  const xs = config.series.map((s) => String(s.xColumn ?? "").trim());
  const sharedX = xs.length > 0 && xs.every((x) => x === xs[0]) ? xs[0] : "";

  if (config.chartType === "histogram") return `${unique.join(", ")}${count}`;
  if (sharedX) return `${unique.join(", ")} vs ${sharedX}${count}`;

  // X が系列ごとに違う（複数テーブルを重ねている）ときは組で書く
  const pairs = config.series
    .map((s, i) => {
      const y = shown[i];
      const x = xs[i];
      return y ? (x ? `${y} vs ${x}` : y) : "";
    })
    .filter(Boolean);
  return `${[...new Set(pairs)].join(", ")}${count}`;
}

export const chartToMarkdown: BlockToMarkdown = (block, ctx) => {
  // 設定は props.config の JSON が正（旧形式は props.sourceBlockId を見て移行される）。
  // 個々の prop を直接読むと、設定項目が config に移った時に静かに陳腐化する。
  const config = parseChartBlockConfig(
    String(block.props?.config ?? ""),
    String(block.props?.sourceBlockId ?? ""),
  );

  const kind = isStackActive(config) ? `${config.chartType}, stacked` : config.chartType;
  const detail = [config.caption.trim(), describeSeries(config, seriesNames(config, ctx))]
    .filter(Boolean)
    .join(" — ");
  const label = detail ? `Chart (${kind}): ${detail}` : `Chart (${kind})`;

  return [textParagraph(label, { italic: true }, ctx.children)];
};
