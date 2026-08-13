// ノートの印刷 / PDF 書き出し
//
// ブラウザ（および Tauri の WebView）の印刷機能に載せる。以前は html2pdf.js で
// 画面を html2canvas にかけて JPEG 化し、それを jsPDF に貼って直接ダウンロードして
// いたが、その方式には構造的な弱点があった:
//   - 出力が画像なので文字を選択・検索できず、拡大すると滲む
//   - html2canvas が CSS を完全には解釈しないため、色（oklch）や SVG の寸法を
//     書き出し側で潰して回る必要があり、崩れるたびに個別のハックが増える
//   - プレビューが無く、崩れていても出してみるまで分からない
// 印刷経路ならレンダリングはブラウザ自身が行うので、文字はベクターのまま残り、
// ユーザーは用紙・余白・倍率を選べて、保存前にプレビューで確認できる。
//
// 画面をそのまま印刷するのではなく、印刷用のツリーを組み立てて body 直下に置き、
// @media print でそれ以外を隠す（スタイルは app.css の印刷セクション）。
// 画面の DOM を直接使わないのは、タイトル・日時・ラベル一覧・PROV グラフといった
// 画面には無い要素を足す必要があり、逆にエディタの操作 UI は落とす必要があるため。
// 組み立てたツリーには画面と同じ CSS が当たるので、見え方は画面に近いまま保てる。

import cytoscape from "cytoscape";
import type { ProvJsonLd } from "../prov-generator";
import { provToCytoscapeElements, cyStyles, applyElkLayout } from "../prov-generator";

/** 印刷用ルートの id（app.css の印刷セクションと対になる） */
const PRINT_ROOT_ID = "graphium-print-root";

/**
 * PROV グラフを PNG 画像として生成（オフスクリーン Cytoscape）
 */
async function renderProvGraphToPng(doc: ProvJsonLd): Promise<string | null> {
  const elements = provToCytoscapeElements(doc);
  if (elements.length === 0) return null;

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

/** エディタの操作 UI を落として、本文だけのクローンを作る（テストから直接叩く） */
export function cloneEditorContent(editorElement: HTMLElement): HTMLElement {
  const clone = editorElement.cloneNode(true) as HTMLElement;

  // サイドメニュー・プラスボタン
  clone
    .querySelectorAll(
      '[data-side-menu], [class*="sideMenu"], [class*="dragHandle"], [data-node-type="blockGroup"] > [data-side-menu-button]',
    )
    .forEach((el) => el.remove());
  // ドラッグハンドル
  clone
    .querySelectorAll('[class*="DragHandle"], [class*="dragHandle"], [draggable="true"]:not([data-node-type])')
    .forEach((el) => el.remove());
  // チャートの設定ボタン
  clone.querySelectorAll("[data-chart-ui]").forEach((el) => el.remove());

  // 計算ブロックのソース入力（textarea）を行ごとの div に置き換える。
  // cloneNode は textarea の入力値（value プロパティ）を引き継がないので、
  // そのままでは式が消える。値は元の DOM から拾う。
  const origAreas = editorElement.querySelectorAll<HTMLTextAreaElement>(
    '[data-test="calc-block"] textarea',
  );
  clone
    .querySelectorAll<HTMLTextAreaElement>('[data-test="calc-block"] textarea')
    .forEach((area, i) => {
      const value = origAreas[i]?.value ?? "";
      const box = document.createElement("div");
      box.setAttribute("data-calc-source", "");
      box.className = "graphium-print-calc-source";
      for (const line of value.split("\n")) {
        const row = document.createElement("div");
        row.textContent = line || " ";
        box.appendChild(row);
      }
      area.replaceWith(box);
    });

  clone.style.padding = "0";
  clone.style.margin = "0";
  clone.classList.add("graphium-print-content");
  return clone;
}

/** ヘッダー（タイトル・日時・ラベル一覧）を組み立てる（テストから直接叩く） */
export function buildHeader(title: string, labels?: Map<string, string>): DocumentFragment {
  const frag = document.createDocumentFragment();

  const titleEl = document.createElement("h1");
  titleEl.className = "graphium-print-title";
  titleEl.textContent = title;
  frag.appendChild(titleEl);

  const dateEl = document.createElement("p");
  dateEl.className = "graphium-print-date";
  dateEl.textContent = new Date().toLocaleString();
  frag.appendChild(dateEl);

  if (labels && labels.size > 0) {
    const container = document.createElement("div");
    container.className = "graphium-print-labels";
    for (const label of [...new Set(labels.values())].sort()) {
      const badge = document.createElement("span");
      badge.textContent = label;
      container.appendChild(badge);
    }
    frag.appendChild(container);
  }

  const hr = document.createElement("hr");
  hr.className = "graphium-print-rule";
  frag.appendChild(hr);
  return frag;
}

/**
 * 紙面に収まらない要素を整える。
 *
 * ここだけは実測が要る。印刷ルートは画面外に置いてあるがレイアウトは計算されて
 * いて、幅も印刷時と同じ（app.css で用紙のコンテンツ幅に固定してある）ので、
 * ここで測った値はそのまま印刷結果に対応する。
 */
function fitContentToPage(root: HTMLElement): void {
  // 改ページの泣き別れ制御。
  // - 図の類（チャート・画像・数式・計算・カラム行）: ページに収まる高さなら常に回避
  // - テーブル: ページ半分以下の小さいものだけ回避。大きいテーブルまで丸ごと次ページへ
  //   送ると 1 ページ目がタイトルだけで白紙になるので、大きいものは分割に任せる
  const PAGE_CONTENT_PX = 1030; // A4 縦 297mm - 余白 30mm ≒ 267mm の 96dpi 換算
  const avoidBreak = (el: HTMLElement) => {
    el.style.breakInside = "avoid";
    el.style.pageBreakInside = "avoid";
  };
  root
    .querySelectorAll<HTMLElement>(
      '[data-test="chart-block"], img, [data-test="math-block"], [data-test="calc-block"], [data-node-type="columnList"]',
    )
    .forEach((el) => {
      if (el.getBoundingClientRect().height <= PAGE_CONTENT_PX) avoidBreak(el);
    });
  root.querySelectorAll<HTMLElement>("table").forEach((el) => {
    if (el.getBoundingClientRect().height <= PAGE_CONTENT_PX / 2) avoidBreak(el);
  });

  // 計算ブロックは式も結果も折り返さない（折り返すと行の対応がずれる）ため、
  // カラム内など幅が半分になる場所では列からはみ出して隣に重なる。
  // 両方が収まるまでフォントを詰める。片側だけ縮めると行高が変わって
  // 式と結果の行がずれるので、同じ値を両方の列に当てる。
  root.querySelectorAll<HTMLElement>('[data-test="calc-block"]').forEach((block) => {
    const cols = [...block.querySelectorAll<HTMLElement>("[data-calc-source], [data-calc-results]")];
    if (cols.length === 0) return;
    const overflowing = () => cols.some((c) => c.scrollWidth > c.clientWidth + 1);
    for (let size = 13; size > 7 && overflowing(); size -= 0.5) {
      for (const c of cols) c.style.fontSize = `${size - 0.5}px`;
    }
  });
}

/**
 * ノートを印刷する（ユーザーはプレビューから PDF 保存を選べる）。
 *
 * 印刷ダイアログが閉じるまで待ってから解決する。ダイアログの表示中は
 * 呼び出し側でボタンを無効化できるようにするため。
 */
export async function printNote(options: {
  title: string;
  editorElement: HTMLElement;
  provDoc: ProvJsonLd | null;
  labels?: Map<string, string>;
}): Promise<void> {
  const { title, editorElement, provDoc, labels } = options;

  // 前回の残骸が居たら消す（印刷が中断された場合など）
  document.getElementById(PRINT_ROOT_ID)?.remove();

  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  root.appendChild(buildHeader(title, labels));
  root.appendChild(cloneEditorContent(editorElement));

  // PROV グラフ（画像なので印刷でもそのまま出る）
  if (provDoc && provDoc["@graph"].length > 0) {
    const pngDataUrl = await renderProvGraphToPng(provDoc);
    if (pngDataUrl) {
      const section = document.createElement("section");
      section.className = "graphium-print-prov";
      const heading = document.createElement("h2");
      heading.textContent = "Provenance Graph";
      section.appendChild(heading);
      const img = document.createElement("img");
      img.src = pngDataUrl;
      section.appendChild(img);
      root.appendChild(section);
    }
  }

  document.body.appendChild(root);

  try {
    // 画像（PROV グラフや本文の画像）の読み込みを待つ。未読込のまま印刷すると
    // 空枠のまま紙に乗る。
    await waitForImages(root);
    fitContentToPage(root);
    // ブラウザに印刷レイアウトを組ませてからダイアログを出す
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await printAndWait();
  } finally {
    root.remove();
  }
}

/** ルート内の画像がすべて読み終わる（か失敗する）まで待つ */
async function waitForImages(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll("img")].filter((img) => !img.complete);
  if (images.length === 0) return;
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

/**
 * 印刷ダイアログを出し、閉じられるまで待つ。
 *
 * afterprint は WebKit 系で発火しないことがあるため、印刷用メディアクエリの
 * 変化も併せて見る。どちらも来ない環境のために最後の保険も置く。
 */
export function printAndWait(): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const mql = window.matchMedia?.("print");

    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("afterprint", finish);
      mql?.removeEventListener?.("change", onMediaChange);
      clearTimeout(timer);
      resolve();
    };
    const onMediaChange = (e: MediaQueryListEvent) => {
      if (!e.matches) finish();
    };

    window.addEventListener("afterprint", finish);
    mql?.addEventListener?.("change", onMediaChange);
    // ダイアログを開いたまま放置された場合に、ボタンが永久に無効化されないようにする
    const timer = setTimeout(finish, 120_000);

    window.print();
  });
}
