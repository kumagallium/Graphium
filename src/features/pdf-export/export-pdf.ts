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
import { downloadBlob } from "../../lib/download-file";

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

  // ── 色を rgb にフラット化 ──
  // Tailwind v4 等が使う `oklch(...)` を html2canvas が解釈できないため、
  // 一度 DOM に挿入して getComputedStyle で解決した色を inline で固定する。
  // 仕様上 computed color は rgb 系で返るブラウザが多いが、解決前の oklch
  // が残るケースもあるので canvas 経由で rgb 化したものを優先する。
  // オフスクリーン用の親コンテナに wrapper を入れる。wrapper 自体には
  // position/left を付けない（html2pdf がクローンしたときに -99999px が
  // 引き継がれてレンダリング範囲外になるのを防ぐ）。
  const offscreen = document.createElement("div");
  offscreen.style.position = "fixed";
  offscreen.style.left = "-99999px";
  offscreen.style.top = "0";
  offscreen.style.width = "800px";
  offscreen.style.pointerEvents = "none";
  offscreen.appendChild(wrapper);
  document.body.appendChild(offscreen);
  // 要素単位の inline 上書き（CSS 変数を経由した色の解決を担う）
  try {
    flattenColorsToRgb(wrapper);
  } catch (e) {
    console.warn("[pdf-export] color flattening failed:", e);
  }
  // ドキュメント全体の stylesheet を走査し、`oklch(...)` を含む CSS ルールを
  // rgb に書き換えた override シートを <head> 末尾に注入する。
  // 疑似要素 (::before / ::after / ::marker) や Tailwind v4 の `--color-*`
  // CSS 変数（`oklch(...)` を値に持つ）まで一気に置換できる。
  const oklchOverride = installOklchOverrideStylesheet();

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
  const filename = `${title.replace(/[/\\?%*:|"<>]/g, "_")}.pdf`;
  const opt = {
    margin: [12, 12, 12, 12] as [number, number, number, number],
    filename,
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

  // html2pdf().save() は内部で <a download> を生成する。WKWebView (Tauri) は
  // それを尊重せず blob URL へ遷移してしまい React の UI ごと消えるため、
  // Blob を取り出してからプラットフォーム別に保存する。
  let blob: Blob;
  try {
    blob = await html2pdf().set(opt).from(wrapper).outputPdf("blob");
  } finally {
    if (offscreen.parentNode) offscreen.parentNode.removeChild(offscreen);
    if (oklchOverride && oklchOverride.parentNode) {
      oklchOverride.parentNode.removeChild(oklchOverride);
    }
  }
  await downloadBlob(blob, filename);
}

// ドキュメント中の全 stylesheet を走査して `oklch(...)` を含むルールを抽出し、
// rgb に書き換えた同等のルールを `<head>` 末尾に挿入する。
// 戻り値の `<style>` は呼び出し側でエクスポート後に削除する。
function installOklchOverrideStylesheet(): HTMLStyleElement | null {
  if (typeof document === "undefined") return null;
  const overrides: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // クロスオリジン CSS はアクセス時に例外を投げる
      continue;
    }
    if (!rules) continue;
    walkRulesForOklch(rules, overrides);
  }
  if (!overrides.length) return null;
  const style = document.createElement("style");
  style.setAttribute("data-pdf-export-oklch-override", "true");
  style.textContent = overrides.join("\n");
  document.head.appendChild(style);
  return style;
}

function walkRulesForOklch(rules: CSSRuleList, out: string[]): void {
  for (const rule of Array.from(rules)) {
    const anyRule = rule as any;
    const cssText = (rule as any).cssText as string | undefined;

    if (anyRule.cssRules) {
      // グルーピングルール (@media / @supports / @layer など)。
      // 中身を再帰処理する一方、Chrome の CSSOM はリーフ CSSStyleRule の
      // cssText でカスタムプロパティを欠落させる癖があるため、grouping rule
      // 全体の cssText からも oklch を回収する。
      walkRulesForOklch(anyRule.cssRules, out);
      if (cssText && /oklch/i.test(cssText)) {
        const replaced = cssText.replace(/oklch\s*\([^)]*\)/gi, (m) => oklchStringToRgb(m) ?? m);
        if (replaced !== cssText) out.push(replaced);
      }
      continue;
    }

    if (rule instanceof CSSStyleRule) {
      processStyleRule(rule, out);
      // リーフでも念のため cssText 経由を試す（重複しても cascade で問題なし）
      if (cssText && /oklch/i.test(cssText)) {
        const replaced = cssText.replace(/oklch\s*\([^)]*\)/gi, (m) => oklchStringToRgb(m) ?? m);
        if (replaced !== cssText) out.push(replaced);
      }
    } else if (anyRule.constructor?.name === "CSSPropertyRule" && anyRule.name) {
      processPropertyRule(anyRule, out);
    }
  }
}

function processStyleRule(rule: CSSStyleRule, out: string[]): void {
  // まず CSSStyleDeclaration を列挙する経路。標準プロパティ（color など）は
  // こちらで拾える。
  const style = rule.style;
  const decls: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    const value = style.getPropertyValue(prop);
    if (!value || !/oklch/i.test(value)) continue;
    const replaced = value.replace(/oklch\s*\([^)]*\)/gi, (m) => oklchStringToRgb(m) ?? m);
    if (replaced === value) continue;
    const priority = style.getPropertyPriority(prop);
    seen.add(prop);
    decls.push(`${prop}: ${replaced}${priority ? " !important" : ""}`);
  }
  // Chrome の CSSOM はカスタムプロパティ（`--xxx`）を style[i] で列挙しない。
  // 漏れたものを cssText から直接パースして拾う。
  const cssText = rule.cssText;
  if (cssText && /oklch/i.test(cssText)) {
    const bodyMatch = cssText.match(/\{([\s\S]*)\}\s*$/);
    if (bodyMatch) {
      for (const raw of splitDeclarations(bodyMatch[1])) {
        const colon = raw.indexOf(":");
        if (colon < 0) continue;
        const prop = raw.slice(0, colon).trim();
        if (!prop || seen.has(prop)) continue;
        const valuePart = raw.slice(colon + 1).trim();
        if (!/oklch/i.test(valuePart)) continue;
        const replaced = valuePart.replace(/oklch\s*\([^)]*\)/gi, (m) => oklchStringToRgb(m) ?? m);
        if (replaced === valuePart) continue;
        seen.add(prop);
        decls.push(`${prop}: ${replaced}`);
      }
    }
  }
  if (!decls.length) return;
  out.push(`${rule.selectorText} { ${decls.join("; ")}; }`);
}

// `--a: oklch(0.5 0.1 200); color: red` のような宣言列を `;` で分割する。
// `oklch(...)` 内に `;` は来ない前提（CSS 仕様上 OK）。
function splitDeclarations(body: string): string[] {
  return body.split(";").map((s) => s.trim()).filter(Boolean);
}

function processPropertyRule(rule: any, out: string[]): void {
  // @property --x { initial-value: oklch(...); }
  // → cascade 上 :root の宣言が initial-value に勝つので、:root に rgb 化した
  // 同名カスタムプロパティを追加するだけで十分。
  const initial = rule.initialValue ?? "";
  if (!initial || !/oklch/i.test(initial)) return;
  const replaced = initial.replace(/oklch\s*\([^)]*\)/gi, (m: string) => oklchStringToRgb(m) ?? m);
  if (replaced === initial) return;
  out.push(`:root { ${rule.name}: ${replaced}; }`);
}

// 解決済み色を rgb 文字列に正規化する。
// - rgb / rgba / hex はそのまま
// - oklch(...) / oklab(...) は手書きの変換器で sRGB に変換（html2canvas が
//   未サポートなため）
// - それ以外で canvas が rgb に解釈してくれる色（named color など）は canvas
//   経由でフォールバック
const COLOR_RESOLVE_CANVAS = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  return c.getContext("2d");
})();

function resolveToRgb(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none" || trimmed === "transparent") return null;
  if (/^(rgb|rgba|#)/i.test(trimmed)) return null;

  if (/^oklch\s*\(/i.test(trimmed)) {
    return oklchStringToRgb(trimmed);
  }
  if (/^oklab\s*\(/i.test(trimmed)) {
    return oklabStringToRgb(trimmed);
  }

  if (!COLOR_RESOLVE_CANVAS) return null;
  try {
    COLOR_RESOLVE_CANVAS.fillStyle = "#000000";
    COLOR_RESOLVE_CANVAS.fillStyle = trimmed;
    const resolved = COLOR_RESOLVE_CANVAS.fillStyle as string;
    if (!resolved) return null;
    const low = resolved.toLowerCase();
    if (low.includes("oklch") || low.includes("oklab") || low.includes("color(")) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

// "oklch(L C H [/ A])" を rgb / rgba に変換
function oklchStringToRgb(input: string): string | null {
  const m = input.match(/^oklch\s*\(\s*([^)]+)\)\s*$/i);
  if (!m) return null;
  const parsed = parseColorArgs(m[1]);
  if (!parsed) return null;
  const [Lraw, Craw, Hraw, alpha] = parsed;
  const L = parsePercent(Lraw, 1);
  const C = parseNumberOrPercent(Craw, 0.4);
  const H = parseAngle(Hraw);
  if (L == null || C == null || H == null) return null;
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  return oklabToRgb(L, a, b, alpha);
}

// "oklab(L A B [/ A])"
function oklabStringToRgb(input: string): string | null {
  const m = input.match(/^oklab\s*\(\s*([^)]+)\)\s*$/i);
  if (!m) return null;
  const parsed = parseColorArgs(m[1]);
  if (!parsed) return null;
  const [Lraw, Araw, Braw, alpha] = parsed;
  const L = parsePercent(Lraw, 1);
  const a = parseNumberOrPercent(Araw, 0.4);
  const b = parseNumberOrPercent(Braw, 0.4);
  if (L == null || a == null || b == null) return null;
  return oklabToRgb(L, a, b, alpha);
}

function parseColorArgs(body: string): [string, string, string, number?] | null {
  // L C H / A  もしくは L C H A
  let alpha: number | undefined;
  let core = body;
  const slash = body.split("/");
  if (slash.length === 2) {
    const aTok = slash[1].trim();
    const parsedA = aTok.endsWith("%")
      ? parseFloat(aTok) / 100
      : parseFloat(aTok);
    if (!Number.isNaN(parsedA)) alpha = clamp01(parsedA);
    core = slash[0];
  }
  const toks = core.trim().split(/\s+/);
  if (toks.length < 3) return null;
  return [toks[0], toks[1], toks[2], alpha];
}

function parsePercent(tok: string, scale: number): number | null {
  if (tok.endsWith("%")) {
    const v = parseFloat(tok);
    if (Number.isNaN(v)) return null;
    return (v / 100) * scale;
  }
  const v = parseFloat(tok);
  return Number.isNaN(v) ? null : v;
}

function parseNumberOrPercent(tok: string, percentRef: number): number | null {
  if (tok.endsWith("%")) {
    const v = parseFloat(tok);
    if (Number.isNaN(v)) return null;
    return (v / 100) * percentRef;
  }
  const v = parseFloat(tok);
  return Number.isNaN(v) ? null : v;
}

function parseAngle(tok: string): number | null {
  let v: number;
  if (tok.endsWith("deg")) v = parseFloat(tok);
  else if (tok.endsWith("rad")) v = (parseFloat(tok) * 180) / Math.PI;
  else if (tok.endsWith("turn")) v = parseFloat(tok) * 360;
  else if (tok.endsWith("grad")) v = (parseFloat(tok) * 360) / 400;
  else v = parseFloat(tok);
  return Number.isNaN(v) ? null : v;
}

function oklabToRgb(L: number, a: number, b: number, alpha?: number): string {
  // OKLab → 線形 sRGB
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const R = Math.round(clamp01(linearToSrgb(r)) * 255);
  const G = Math.round(clamp01(linearToSrgb(g)) * 255);
  const B = Math.round(clamp01(linearToSrgb(bl)) * 255);
  if (alpha != null && alpha < 1) return `rgba(${R}, ${G}, ${B}, ${alpha})`;
  return `rgb(${R}, ${G}, ${B})`;
}

function linearToSrgb(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const COLOR_PROPS = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "textDecorationColor",
  "fill",
  "stroke",
] as const;

function flattenColorsToRgb(root: HTMLElement): void {
  const elements: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of elements) {
    const cs = getComputedStyle(el);
    for (const prop of COLOR_PROPS) {
      const current = cs[prop as any] as string;
      const resolved = resolveToRgb(current);
      if (resolved) {
        // setProperty なら camelCase / kebab どちらも吸収しやすい
        const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        el.style.setProperty(kebab, resolved, "important");
      }
    }
  }
}
