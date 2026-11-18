// 画面に描かれているチャート（ECharts の SVG）を、Word に貼る PNG 画像として取る補助。
// DOM と canvas を使うので、純ロジックのファイル（blocks-to-docx など）からは import しない。
// 失敗はすべて null で返し、書き出し側が文字での説明に落とす。
import type { DocxImage } from "./export-docx";

/** ラスタライズに渡す情報。width / height は画面上の px（解像度を掛ける前の数） */
export type ChartSvgSource = { svg: string; width: number; height: number };

/** SVG 文字列を PNG にする関数。テストでは差し替える */
export type ChartRasterizer = (src: ChartSvgSource) => Promise<DocxImage | null>;

/** 高解像度で出す倍率（Word で拡大しても粗くならないように） */
const SCALE = 2;
/** canvas の一辺の上限（巨大な図で大きな canvas を確保しない） */
const MAX_CANVAS_SIDE = 8192;

/** ブロックの容器（data-id は外側の blockOuter にも付くので、容器を名指しする） */
const BLOCK_CONTAINER = '[data-node-type="blockContainer"]';
/** チャートの図を描いている要素の目印（src/blocks/chart/view.tsx が付ける） */
const CHART_PLOT = "[data-chart-plot]";

/**
 * ブロックの id から、そのブロック自身のチャートの svg を探す。
 * - 実際の入れ子は 容器 > React のラッパー > .bn-block-content > … > 図の要素 > svg。
 *   直下の子だけを見ると React のラッパーで外れるので、目印で探してから持ち主を確かめる
 * - ブロックの中には道具のアイコンの svg もある。最初の svg ではなく、図の要素の中の svg を取る
 * - 子ブロックのチャートは拾わない（図の要素から見ていちばん近い容器が自分であること）
 */
function findChartSvg(root: ParentNode, blockId: string): SVGSVGElement | null {
  const id = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(blockId) : blockId.replace(/["\\]/g, "\\$&");
  const host = root.querySelector(`${BLOCK_CONTAINER}[data-id="${id}"]`);
  if (!host) return null;
  for (const plot of Array.from(host.querySelectorAll(CHART_PLOT))) {
    if (plot.closest(BLOCK_CONTAINER) !== host) continue;
    return plot.querySelector<SVGSVGElement>("svg");
  }
  return null;
}

/** 表示上の寸法（px）。取れなければ viewBox、それも無ければ null */
function readSize(svg: SVGSVGElement): { width: number; height: number } | null {
  const rect = svg.getBoundingClientRect?.();
  let width = rect?.width ?? 0;
  let height = rect?.height ?? 0;
  if (!(width > 0 && height > 0)) {
    width = parseFloat(svg.getAttribute("width") ?? "");
    height = parseFloat(svg.getAttribute("height") ?? "");
  }
  if (!(width > 0 && height > 0)) {
    const vb = svg.viewBox?.baseVal;
    width = vb?.width ?? 0;
    height = vb?.height ?? 0;
  }
  if (!(width > 0 && height > 0)) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

/** 既定のラスタライズ: SVG → Image → canvas → PNG（2 倍の解像度） */
export const rasterizeSvgToPng: ChartRasterizer = async ({ svg, width, height }) => {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("svg decode failed"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    if (width * SCALE > MAX_CANVAS_SIDE || height * SCALE > MAX_CANVAS_SIDE) return null;
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // 背景が透明だと Word で黒く見えることがあるので白で塗る
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    const data = new Uint8Array(await blob.arrayBuffer());
    return { data, type: "png", width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** root の中から blockId のチャートを探して画像にする。無い・失敗は null */
export async function captureChartImage(
  root: ParentNode,
  blockId: string,
  rasterize: ChartRasterizer = rasterizeSvgToPng,
): Promise<DocxImage | null> {
  try {
    const svg = findChartSvg(root, blockId);
    if (!svg) return null;
    const size = readSize(svg);
    if (!size) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(size.width));
    clone.setAttribute("height", String(size.height));
    const text = new XMLSerializer().serializeToString(clone);
    return await rasterize({ svg: text, width: size.width, height: size.height });
  } catch {
    return null;
  }
}
