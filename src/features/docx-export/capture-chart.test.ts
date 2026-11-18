// @vitest-environment jsdom
// チャートを画像として取る補助のテスト（ラスタライズは差し替える）
//
// DOM は実機で確かめた入れ子に合わせる（2026-11-17、Chromium）:
//   blockOuter[data-id] > .bn-block[data-node-type=blockContainer][data-id]
//     > .react-renderer.node-chart > .bn-block-content[data-content-type=chart]
//       > 道具のアイコンの svg … / 図の要素[data-chart-plot] > svg
// 作りものの入れ子でテストすると、React のラッパーと道具のアイコンを見落とす
// （最初の実装はテストが通ったまま、実機ではグラフが 1 枚も画像にならなかった）。
import { describe, expect, it, vi } from "vitest";
import { captureChartImage } from "./capture-chart";

const IMG = { data: new Uint8Array([1]), type: "png" as const, width: 300, height: 200 };

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const ICON = `<svg class="lucide lucide-sliders-horizontal" width="13" height="13"><path/></svg>`;
const PLOT = `<div data-chart-plot><div><svg width="300" height="200"><rect/></svg></div></div>`;

/** 実機と同じ入れ子のチャートブロック。plot を空にすると「まだ描かれていない」状態 */
const chartHtml = (id: string, opts: { plot?: string; children?: string } = {}) =>
  `<div class="bn-block-outer" data-node-type="blockOuter" data-id="${id}">` +
  `<div class="bn-block" data-node-type="blockContainer" data-id="${id}">` +
  `<div class="react-renderer node-chart bn-react-node-view-renderer">` +
  `<div class="bn-block-content" data-content-type="chart">` +
  `<button>${ICON}</button>${opts.plot ?? PLOT}` +
  `</div></div>` +
  (opts.children ? `<div class="bn-block-group" data-node-type="blockGroup">${opts.children}</div>` : "") +
  `</div></div>`;

describe("captureChartImage", () => {
  it("図がまだ描かれていない・ブロックが無いときは null", async () => {
    const rasterize = vi.fn();
    const root = mount(chartHtml("a", { plot: "<div data-chart-plot></div>" }));
    expect(await captureChartImage(root, "a", rasterize)).toBeNull();
    expect(await captureChartImage(root, "none", rasterize)).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
  });

  it("React のラッパー越しに図の svg を見つけ、SVG 文字列と寸法を渡す", async () => {
    const rasterize = vi.fn().mockResolvedValue(IMG);
    const out = await captureChartImage(mount(chartHtml("c1")), "c1", rasterize);
    expect(out).toBe(IMG);
    const arg = rasterize.mock.calls[0][0];
    expect(arg.svg).toContain("xmlns=\"http://www.w3.org/2000/svg\"");
    expect(arg.width).toBe(300);
    expect(arg.height).toBe(200);
  });

  it("道具のアイコンの svg ではなく、図の svg を取る", async () => {
    const rasterize = vi.fn().mockResolvedValue(IMG);
    await captureChartImage(mount(chartHtml("c1")), "c1", rasterize);
    const arg = rasterize.mock.calls[0][0];
    expect(arg.svg).not.toContain("lucide");
    expect(arg.svg).toContain("<rect");
  });

  it("例外は null", async () => {
    const rasterize = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await captureChartImage(mount(chartHtml("c1")), "c1", rasterize)).toBeNull();
  });

  it("自分の図が無いとき、子ブロックのチャートの svg を拾わない", async () => {
    const rasterize = vi.fn().mockResolvedValue(IMG);
    const root = mount(chartHtml("p", { plot: "", children: chartHtml("k") }));
    expect(await captureChartImage(root, "p", rasterize)).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
    expect(await captureChartImage(root, "k", rasterize)).toBe(IMG);
  });
});
