// PDF エクスポート機能
// エディタコンテンツ + PROV グラフを PDF ファイルとして書き出す

import html2pdf from "html2pdf.js";
import cytoscape from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ProvJsonLd } from "../prov-generator";
import {
  provToCytoscapeElements,
  cyStyles,
  applyElkLayout,
} from "../prov-generator";

/**
 * PROV グラフを PNG 画像として生成（オフスクリーン Cytoscape）
 */
async function renderProvGraphToPng(doc: ProvJsonLd): Promise<string | null> {
  const elements = provToCytoscapeElements(doc);
  if (elements.length === 0) return null;

  // オフスクリーンコンテナを作成
  const container = document.createElement("div");
  container.style.width = "800px";
  container.style.height = "600px";
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  document.body.appendChild(container);

  try {
    const cy = cytoscape({
      container,
      elements,
      style: cyStyles,
      layout: { name: "preset" },
      userZoomingEnabled: false,
      userPanningEnabled: false,
    });

    // ELK レイアウトを適用
    cy.layout({ name: "breadthfirst", directed: true, spacingFactor: 1.5 } as any).run();
    cy.fit(undefined, 20);
    try {
      await applyElkLayout(cy);
      cy.fit(undefined, 20);
    } catch {
      // breadthfirst レイアウトを維持
    }

    const png = cy.png({ output: "base64uri", scale: 2, bg: "#fafdf7" });
    cy.destroy();
    return png;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * ノートを PDF としてエクスポート
 */
export async function exportNoteToPdf(options: {
  title: string;
  editorElement: HTMLElement;
  provDoc: ProvJsonLd | null;
  labels?: Map<string, string>;
}): Promise<void> {
  const { title, editorElement, provDoc, labels } = options;

  // PDF 用のコンテナを構築
  const wrapper = document.createElement("div");
  wrapper.style.padding = "24px";
  wrapper.style.fontFamily = "'Helvetica Neue', Arial, sans-serif";
  wrapper.style.color = "#1a1a1a";
  wrapper.style.lineHeight = "1.6";
  wrapper.style.maxWidth = "700px";
  wrapper.style.backgroundColor = "#ffffff";

  // ── タイトル ──
  const titleEl = document.createElement("h1");
  titleEl.textContent = title;
  titleEl.style.fontSize = "22px";
  titleEl.style.fontWeight = "700";
  titleEl.style.marginBottom = "4px";
  titleEl.style.color = "#1a1a1a";
  wrapper.appendChild(titleEl);

  // ── 日時 ──
  const dateEl = document.createElement("p");
  dateEl.textContent = new Date().toLocaleString();
  dateEl.style.fontSize = "11px";
  dateEl.style.color = "#888";
  dateEl.style.marginBottom = "16px";
  wrapper.appendChild(dateEl);

  // ── ラベル一覧 ──
  if (labels && labels.size > 0) {
    const uniqueLabels = [...new Set(labels.values())].sort();
    const labelContainer = document.createElement("div");
    labelContainer.style.marginBottom = "16px";

    for (const label of uniqueLabels) {
      const badge = document.createElement("span");
      badge.textContent = label;
      badge.style.display = "inline-block";
      badge.style.marginRight = "8px";
      badge.style.fontSize = "11px";
      badge.style.color = "#4B7A52";
      badge.style.fontWeight = "500";
      labelContainer.appendChild(badge);
    }
    wrapper.appendChild(labelContainer);
  }

  // ── 区切り線 ──
  const hr = document.createElement("hr");
  hr.style.border = "none";
  hr.style.borderTop = "1px solid #e0e0e0";
  hr.style.margin = "0 0 16px 0";
  wrapper.appendChild(hr);

  // ── エディタコンテンツ ──
  const contentClone = editorElement.cloneNode(true) as HTMLElement;
  // エディタ UI 要素を除去（サイドメニュー、プラスボタンなど）
  contentClone.querySelectorAll(
    '[data-side-menu], [class*="sideMenu"], [class*="dragHandle"], [data-node-type="blockGroup"] > [data-side-menu-button]'
  ).forEach((el) => el.remove());
  // ドラッグハンドルを除去
  contentClone.querySelectorAll(
    '[class*="DragHandle"], [class*="dragHandle"], [draggable="true"]:not([data-node-type])'
  ).forEach((el) => el.remove());

  // コンテンツのスタイルをクリーンアップ
  contentClone.style.padding = "0";
  contentClone.style.margin = "0";

  // CSS でエディタの背景色を強制リセット（inline style より CSS class が優先されるケース対策）
  const styleReset = document.createElement("style");
  styleReset.textContent = `
    .pdf-export-wrapper {
      background-color: #ffffff !important;
    }
    .pdf-export-content,
    .pdf-export-content * {
      background-color: transparent !important;
      background: transparent !important;
    }
  `;
  wrapper.appendChild(styleReset);
  contentClone.classList.add("pdf-export-content");
  wrapper.classList.add("pdf-export-wrapper");
  wrapper.appendChild(contentClone);

  // ── PROV グラフ ──
  if (provDoc && provDoc["@graph"].length > 0) {
    const provSection = document.createElement("div");
    provSection.style.marginTop = "32px";
    provSection.style.pageBreakBefore = "auto";

    const provTitle = document.createElement("h2");
    provTitle.textContent = "Provenance Graph";
    provTitle.style.fontSize = "16px";
    provTitle.style.fontWeight = "600";
    provTitle.style.marginBottom = "12px";
    provTitle.style.color = "#4B7A52";
    provSection.appendChild(provTitle);

    const pngDataUrl = await renderProvGraphToPng(provDoc);
    if (pngDataUrl) {
      const img = document.createElement("img");
      img.src = pngDataUrl;
      img.style.width = "100%";
      img.style.maxWidth = "700px";
      img.style.borderRadius = "8px";
      img.style.border = "1px solid #e0e0e0";
      provSection.appendChild(img);
    }

    wrapper.appendChild(provSection);
  }

  // ── PDF 生成 ──
  const opt = {
    margin: [12, 12, 12, 12] as [number, number, number, number],
    filename: `${title.replace(/[/\\?%*:|"<>]/g, "_")}.pdf`,
    image: { type: "jpeg" as const, quality: 0.95 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      letterRendering: true,
      backgroundColor: "#ffffff",
    },
    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "portrait" as const,
    },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
  };

  await html2pdf().set(opt).from(wrapper).save();
}
