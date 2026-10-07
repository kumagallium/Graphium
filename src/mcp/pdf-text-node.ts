// Node 用の PDF 本文抽出（MCP の get_source_text 用）。
//
// 既存の src/features/wiki/pdf-text-extractor.ts は react-pdf 同梱の pdfjs を使うブラウザ専用なので、
// ここで pdfjs-dist の legacy ビルドを Node で直接使う。連結の規則はブラウザ版に揃える
// （1 ページ内は item の str を " " でつなぎ、ページの間は "\n\n"。pageStarts も同じ数え方）。
//
// pdfjs-dist は bundle に入れず（external）、使うときに動的 import する。入れ損ねた・Node が古い
// ときは、原因つきのエラーで返す（pdfjs-dist 5.x は Node 20.16 以上が必要）。

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type NodeExtractedPdf = {
  title: string;
  text: string;
  pageCount: number;
  /** pageStarts[i] = text 上で (i+1) ページ目が始まる文字オフセット */
  pageStarts: number[];
};

// pdfjs は描画用の DOM 型を import 時に参照する。テキスト抽出だけなので空の定義で足りる
function ensureDomStubs(): void {
  const g = globalThis as Record<string, unknown>;
  for (const name of ["DOMMatrix", "ImageData", "Path2D"]) {
    if (typeof g[name] === "undefined") g[name] = class {};
  }
}

let pdfjsPromise: Promise<any> | null = null;

async function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        ensureDomStubs();
        // worker 側には型定義が無いので any 扱い（実行時の形は pdfjs が決める）
        // @ts-ignore TS7016
        const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
        // Node では Worker を立てず、同じプロセスで動く「偽の worker」に事前登録した処理を使わせる
        (globalThis as Record<string, unknown>).pdfjsWorker = worker;
        return await import("pdfjs-dist/legacy/build/pdf.mjs");
      } catch (err) {
        pdfjsPromise = null; // 次の呼び出しでやり直せるようにする
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`pdfjs を読み込めませんでした（Node 20.16 以上が必要です）: ${reason}`);
      }
    })();
  }
  return pdfjsPromise;
}

/** cMap・標準フォントの置き場（fs のパス。末尾に "/" が要る） */
function pdfjsAssetDir(name: "cmaps" | "standard_fonts"): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("pdfjs-dist/package.json")), name) + "/";
}

/** PDF のバイト列から本文を取り出す */
export async function extractPdfTextNode(bytes: Uint8Array): Promise<NodeExtractedPdf> {
  const pdfjs = await loadPdfjs();

  const loadingTask = pdfjs.getDocument({
    // pdfjs は渡した ArrayBuffer を手放すので、呼び出し側のバッファを壊さないよう写して渡す
    data: new Uint8Array(bytes),
    cMapUrl: pdfjsAssetDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfjsAssetDir("standard_fonts"),
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  try {
    const pageCount: number = doc.numPages;
    const parts: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((item: { str?: string }) => ("str" in item ? (item.str ?? "") : ""))
          .filter(Boolean)
          .join(" "),
      );
    }

    // ページ間は "\n\n"（2 文字）。結合後のオフセットは機械的に求まる
    const rawStarts: number[] = [];
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      rawStarts.push(offset);
      offset += parts[i].length + (i < parts.length - 1 ? 2 : 0);
    }
    const joined = parts.join("\n\n");
    const leadingTrimmed = joined.length - joined.trimStart().length;
    const pageStarts = rawStarts.map((s) => Math.max(0, s - leadingTrimmed));

    let title = "";
    try {
      const meta = await doc.getMetadata();
      title = ((meta?.info as { Title?: string } | undefined)?.Title ?? "").trim();
    } catch {
      // メタの無い PDF はタイトル空のまま
    }
    return { title, text: joined.trim(), pageCount, pageStarts };
  } finally {
    await doc.destroy();
  }
}

/** ファイルから読んで抽出する（テスト・スクリプト用の薄い入口） */
export async function extractPdfTextNodeFromFile(path: string): Promise<NodeExtractedPdf> {
  return extractPdfTextNode(new Uint8Array(readFileSync(path)));
}
