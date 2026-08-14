// ECharts の遅延ローダー
//
// echarts はフルバンドルで ~1MB あるため、チャートブロックが初めて描画される
// 瞬間まで読み込まない（dynamic import）。チャートを使わないノートのバンドル・
// 起動時間には影響させない。
//
// tree-shaking: echarts/core + 使うチャート・コンポーネントだけを登録する。
// レンダラは SVG。印刷 / PDF 書き出しでも解像度が落ちず、
// テーマ色も CSS と同じ見え方になる。

let echartsPromise: Promise<typeof import("echarts/core")> | null = null;

export function loadECharts(): Promise<typeof import("echarts/core")> {
  if (!echartsPromise) {
    echartsPromise = (async () => {
      const [core, charts, components, renderers] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      core.use([
        charts.LineChart,
        charts.BarChart,
        charts.ScatterChart,
        components.GridComponent,
        components.TooltipComponent,
        components.LegendComponent,
        // スタック表示の段ラベル（各段の右端に置く名前）に使う
        components.MarkPointComponent,
        renderers.SVGRenderer,
      ]);
      return core;
    })();
  }
  return echartsPromise;
}
