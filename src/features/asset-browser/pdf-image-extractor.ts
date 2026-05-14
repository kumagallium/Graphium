// PDF に埋め込まれている画像オブジェクトを取り出すヘルパー。
// react-pdf 同梱の pdfjs を流用するため追加依存はない。
//
// 用途: アセットモーダルから「PDF 内の画像を取り出して画像アセットに登録」する
// 動線で使う。各ページを丸ごと rasterize するのではなく、PDF 内部に画像として
// 埋め込まれているオブジェクト（写真・図版ラスター・スキャン画像 等）だけを
// 個別に取り出す。
//
// 制限:
// - 表やベクター figure（線・テキストだけで描かれた図表）は PDF 内部には
//   「画像オブジェクト」として存在しないため、この関数では拾えない。
//   呼び出し側でその旨を UI 上で案内する。
// - 同一画像（ロゴ等）が複数ページで参照されている場合は最初の出現だけを返す
//   （pdfjs の object name に基づく dedup）。

// pdfjs はブラウザ専用（DOMMatrix 依存）。テスト環境（node）で純粋関数だけ
// 呼びたいケースのために、トップレベル import を避けて関数内で遅延 import する。
async function loadPdfjs() {
  const mod = await import("react-pdf");
  return mod.pdfjs;
}

export type ExtractedEmbeddedImage = {
  /** 元 PDF 内で最初に出現したページ番号（1-origin） */
  pageNumber: number;
  /** その PDF 内での通し番号（1-origin、dedup 後） */
  imageIndex: number;
  /** PNG の Blob */
  blob: Blob;
  /** 画像の元解像度（px） */
  width: number;
  /** 画像の元解像度（px） */
  height: number;
};

export type ExtractEmbeddedImagesOptions = {
  /**
   * 抽出を中断するシグナル（次のページ処理前にチェック）。
   */
  signal?: AbortSignal;
  /**
   * 進捗コールバック。`done` は完了したページ数（画像数ではない）、
   * `total` は対象ページ数。
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * これより小さい画像はスキップする。バックグラウンドの細いマスクや
   * 装飾アイコンを除外したいときに使う。デフォルト 16x16。
   */
  minSize?: { width: number; height: number };
};

/** pdfjs から渡される画像オブジェクトの最小限のシェイプ */
type PdfImageObject = {
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
  data?: Uint8ClampedArray | Uint8Array;
  kind?: number;
};

/**
 * PDF Blob を読み込み、各ページの operator list を走査して埋め込み画像を抽出する。
 *
 * 各ページの抽出は次の流れ:
 *   1. `page.getOperatorList()` で描画命令列を取得
 *   2. `OPS.paintImageXObject` / `OPS.paintImageMaskXObject` / `OPS.paintInlineImageXObject`
 *      の引数からイメージ名 or インラインデータを引く
 *   3. 名前付き画像は `page.objs.get(name, cb)` で実体を取得
 *   4. canvas に描画して PNG として encode
 *
 * 同じ画像オブジェクト名はページをまたいで dedup する（pdfjs は同一画像を
 * 同じ name で参照する）。
 */
export async function extractEmbeddedPdfImages(
  source: Blob,
  options: ExtractEmbeddedImagesOptions = {},
): Promise<ExtractedEmbeddedImage[]> {
  const { signal, onProgress, minSize = { width: 16, height: 16 } } = options;

  const pdfjs = await loadPdfjs();
  const buffer = await source.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  const results: ExtractedEmbeddedImage[] = [];
  // dedup: 同じ画像 name は最初の出現だけ採用
  const seenNames = new Set<string>();
  let imageCounter = 0;

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (signal?.aborted) {
        throw new DOMException("PDF image extraction aborted", "AbortError");
      }
      const page = await doc.getPage(pageNumber);
      try {
        const opList = await page.getOperatorList();
        const OPS = pdfjs.OPS as Record<string, number>;
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i] as unknown[];

          let imageObj: PdfImageObject | null = null;
          let dedupKey: string | null = null;

          if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject) {
            const name = typeof args[0] === "string" ? (args[0] as string) : null;
            if (!name || seenNames.has(name)) continue;
            imageObj = await getImageObject(page, name);
            dedupKey = name;
          } else if (fn === OPS.paintInlineImageXObject) {
            // インライン画像は dedup できない（毎回別オブジェクト）
            imageObj = args[0] as PdfImageObject;
          } else {
            continue;
          }

          if (!imageObj) continue;
          const w = imageObj.width ?? 0;
          const h = imageObj.height ?? 0;
          if (w < minSize.width || h < minSize.height) continue;

          const blob = await encodeImageObjectToPng(imageObj, w, h);
          if (!blob) continue;

          imageCounter += 1;
          results.push({
            pageNumber,
            imageIndex: imageCounter,
            blob,
            width: w,
            height: h,
          });
          if (dedupKey) seenNames.add(dedupKey);
        }
      } finally {
        page.cleanup();
      }
      onProgress?.(pageNumber, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }

  return results;
}

/** pdfjs の `page.objs.get` を Promise でラップ */
function getImageObject(page: any, name: string): Promise<PdfImageObject | null> {
  return new Promise((resolve) => {
    try {
      // callback バージョンを優先（v5 では同期/非同期どちらでも動く）
      page.objs.get(name, (obj: PdfImageObject | null) => {
        resolve(obj ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * pdfjs から受け取った画像オブジェクトを canvas で PNG に encode。
 * - `bitmap` (ImageBitmap) があればそれを drawImage する
 * - `data` (RGBA/RGB/Grayscale) があれば ImageData を組み立てて putImageData
 *
 * pdfjs v5 では多くのケースで `bitmap` が入っているため第一選択。
 */
async function encodeImageObjectToPng(
  imageObj: PdfImageObject,
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (imageObj.bitmap) {
    ctx.drawImage(imageObj.bitmap, 0, 0);
  } else if (imageObj.data) {
    const imageData = paintImageDataFromRaw(ctx, imageObj.data, width, height);
    if (!imageData) return null;
    ctx.putImageData(imageData, 0, 0);
  } else {
    return null;
  }

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b ?? null), "image/png");
  });
}

/** raw pixel buffer から ImageData を作る。RGBA/RGB/Grayscale を吸収する */
function paintImageDataFromRaw(
  ctx: CanvasRenderingContext2D,
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): ImageData | null {
  const expected = width * height;
  const imageData = ctx.createImageData(width, height);
  const out = imageData.data;

  if (data.length === expected * 4) {
    // RGBA そのまま
    out.set(data);
    return imageData;
  }
  if (data.length === expected * 3) {
    // RGB → RGBA
    for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
      out[q] = data[p];
      out[q + 1] = data[p + 1];
      out[q + 2] = data[p + 2];
      out[q + 3] = 255;
    }
    return imageData;
  }
  if (data.length === expected) {
    // Grayscale → RGBA
    for (let p = 0, q = 0; p < data.length; p++, q += 4) {
      const v = data[p];
      out[q] = v;
      out[q + 1] = v;
      out[q + 2] = v;
      out[q + 3] = 255;
    }
    return imageData;
  }
  // 未知の bytes-per-pixel（CMYK 等）はスキップ
  return null;
}

/**
 * 抽出した画像から MediaIndex に登録するための File を作る。
 *
 * 例:
 *   embeddedImageToFile({ pageNumber: 3, imageIndex: 2, ... }, "paper.pdf")
 *   // => File("paper - p3 image 2.png", image/png)
 *
 * - 元 PDF 名から `.pdf` 拡張子を取り除き、ページ番号と画像番号を付与する
 */
export function embeddedImageToFile(
  image: ExtractedEmbeddedImage,
  sourcePdfName: string,
): File {
  const baseName = sourcePdfName.replace(/\.pdf$/i, "");
  const filename = `${baseName} - p${image.pageNumber} image ${image.imageIndex}.png`;
  return new File([image.blob], filename, { type: "image/png" });
}
