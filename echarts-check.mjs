import * as echarts from 'echarts';
const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 700, height: 400 });
const base = new Date(2026, 7, 13, 10, 0).getTime();
chart.setOption({
  animation: false,
  xAxis: { type: 'time', axisLabel: { formatter: {
    year: '{yyyy}', month: '{yyyy}/{M}', day: '{M}/{d}', hour: '{HH}:{mm}',
    minute: '{HH}:{mm}', second: '{HH}:{mm}:{ss}', millisecond: '{HH}:{mm}:{ss}.{SSS}',
    none: '{yyyy}/{M}/{d} {HH}:{mm}' } } },
  yAxis: { type: 'value' },
  series: [{ type: 'line', data: [[base, 1], [base + 86400000 * 1.5, 2]] }],
});
const svg = chart.renderToSVGString();
console.log([...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]).join(' | '));
