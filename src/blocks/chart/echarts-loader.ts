// ECharts の遅延ローダー
//
// echarts はフルバンドルで ~1MB あるため、チャートブロックが初めて描画される
// 瞬間まで読み込まない（dynamic import）。チャートを使わないノートのバンドル・
// 起動時間には影響させない。
//
// tree-shaking: echarts/core + 使うチャート・コンポーネントだけを登録する。
// レンダラは SVG。canvas より PDF 書き出し（html2pdf.js）と相性が良く、
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
        renderers.SVGRenderer,
      ]);
      return core;
    })();
  }
  return echartsPromise;
}
