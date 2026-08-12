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
// - 図の部品（矢印・罫線・単色の背景パネル等）は表示面積フィルタと
//   単色判定で除外する。ベクター figure の一部として埋め込まれた
//   ベタ矩形だけが「画像」の場合、その PDF からは何も抽出されない。

// pdfjs はブラウザ専用（DOMMatrix 依存）。テスト環境（node）で純粋関数だけ
// 呼びたいケースのために、トップレベル import を避けて関数内で遅延 import する。
async function loadPdfjs() {
  // CJK フォント描画に必須の cmap オプションも side-effect import で取り込む。
  // pdfjs-config はブラウザ専用 API（import.meta.env / worker）を触るため、
  // pdfjs 本体と同じく遅延 import にしてテスト環境（node）の読み込みを汚さない。
  const [mod, config] = await Promise.all([
    import("react-pdf"),
    import("../../lib/pdfjs-config"),
  ]);
  return { pdfjs: mod.pdfjs, options: config.PDFJS_DOC_OPTIONS };
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
  /**
   * ページ上の表示面積（pt²）がこれ未満の画像はスキップする。矢印・罫線など
   * 図として意味を持たない小さな部品（image mask で埋め込まれがち）を除外する。
   * ビットマップ解像度でなく紙面上のサイズで判定する点が `minSize` と異なる。
   * 0 で無効。デフォルト 576（24pt 角 ≈ 8.5mm 角 相当）。
   */
  minDisplayArea?: number;
};

/** pdfjs から渡される画像オブジェクトの最小限のシェイプ */
type PdfImageObject = {
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
  data?: Uint8ClampedArray | Uint8Array;
  kind?: number;
};

/** 6 要素のアフィン行列 [a, b, c, d, e, f]（x' = a x + c y + e, y' = b x + d y + f） */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * canvas の `ctx.transform` 相当の行列合成: CTM_new = CTM · M。
 * operator list の `OPS.transform`（PDF の `cm`）を畳み込んで CTM を追うのに使う。
 */
function composeMatrix(c: Matrix, m: Matrix): Matrix {
  const [ca, cb, cc, cd, ce, cf] = c;
  const [ma, mb, mc, md, me, mf] = m;
  return [
    ca * ma + cc * mb,
    cb * ma + cd * mb,
    ca * mc + cc * md,
    cb * mc + cd * md,
    ca * me + cc * mf + ce,
    cb * me + cd * mf + cf,
  ];
}

/** 画像を正立させるために必要な反転 */
export type ImageOrientation = { flipX: boolean; flipY: boolean };

/**
 * paintImage 時点の CTM から、生ビットマップを正立させるための反転を求める。
 *
 * PDF の座標系は原点が左下・Y 上向きで、画像 XObject は単位正方形に対して
 * CTM で配置される。多くの PDF 生成器は画像行を上下逆に格納し、負の d を持つ
 * CTM で正立表示する。生 XObject をそのまま canvas に貼る現行方式はこの CTM を
 * 無視するため、`d < 0` の画像だけが上下反転して出てくる（実 PDF で確認済み）。
 *
 * 規約:
 * - 標準形 `a>0, d>0, b=c=0` は **no-op**（今まで正しく出ていた画像は不変）。
 * - `d < 0` → 縦反転、`a < 0` → 横反転で補正する。
 * - 回転・スキュー（`b≠0` or `c≠0`）は符号だけでは向きを決められないため、
 *   ここでは判定せず no-op を返す（生データのまま＝従来挙動）。埋め込みラスター
 *   画像で回転が掛かるケースは稀なため、過補正の事故を避けてスコープ外とする。
 */
export function imageOrientationFromMatrix(ctm: Matrix): ImageOrientation {
  const [a, b, c, d] = ctm;
  const axisAligned = b === 0 && c === 0;
  if (!axisAligned) return { flipX: false, flipY: false };
  return { flipX: a < 0, flipY: d < 0 };
}

/**
 * paintImage 時点の CTM から、ページ上での画像の表示面積（pt²）を求める。
 * 画像 XObject は単位正方形に対して CTM で配置されるため、表示面積は
 * 行列式の絶対値 |a·d − b·c| になる（回転・反転・スキューを通して不変）。
 */
export function displayAreaFromMatrix(ctm: Matrix): number {
  const [a, b, c, d] = ctm;
  return Math.abs(a * d - b * c);
}

// 表示面積フィルタの既定値: 24pt 角（≈ 8.5mm 角）。実測では本物の図版は
// 数万 pt² 規模、矢印・罫線などの図形パーツは数十〜数百 pt² 規模と桁が
// 分かれるため、その間に置く。消えすぎ・残りすぎが出たらここを調整する。
const DEFAULT_MIN_DISPLAY_AREA = 576;

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
  const {
    signal,
    onProgress,
    minSize = { width: 16, height: 16 },
    minDisplayArea = DEFAULT_MIN_DISPLAY_AREA,
  } = options;

  const { pdfjs, options: docOptions } = await loadPdfjs();
  const buffer = await source.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), ...docOptions }).promise;

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
        // CTM スタックを追って paintImage 時点の変換行列を捕まえる。
        // 画像の向き（上下反転）の復元と、表示面積フィルタの両方に使う。
        let ctm: Matrix = IDENTITY;
        const ctmStack: Matrix[] = [];
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i] as unknown[];

          if (fn === OPS.save) {
            ctmStack.push(ctm);
            continue;
          }
          if (fn === OPS.restore) {
            ctm = ctmStack.pop() ?? IDENTITY;
            continue;
          }
          if (fn === OPS.transform) {
            ctm = composeMatrix(ctm, args as unknown as Matrix);
            continue;
          }
          if (fn === OPS.paintFormXObjectBegin) {
            // form XObject は save → 配置行列を合成 → 中身を描画 → restore として
            // 描画される。ここで行列を畳み込まないと、form 内に埋め込まれた画像の
            // 表示面積と向きを取り違える。
            ctmStack.push(ctm);
            const m = args?.[0];
            if (Array.isArray(m) && m.length === 6) {
              ctm = composeMatrix(ctm, m as unknown as Matrix);
            }
            continue;
          }
          if (fn === OPS.paintFormXObjectEnd) {
            ctm = ctmStack.pop() ?? IDENTITY;
            continue;
          }

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

          // ビットマップ解像度とは別に、ページ上の表示面積でも判定する。論文 PDF は
          // 矢印・罫線・記号を高解像度の小さな image mask として埋め込むことがあり、
          // minSize だけでは素通りするため。CTM を一度も合成していない場合は
          // 配置情報が無いので判定せず通す（誤除外を避ける）。
          if (minDisplayArea > 0 && ctm !== IDENTITY) {
            const displayArea = displayAreaFromMatrix(ctm);
            if (displayArea < minDisplayArea) continue;
          }

          const orientation = imageOrientationFromMatrix(ctm);
          const blob = await encodeImageObjectToPng(imageObj, w, h, orientation);
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

// 画像オブジェクト取得の保険タイムアウト。`objs.get(name, cb)` は対象が
// 永久に resolve されないと cb を一度も呼ばない設計なので、想定外の名前を
// 引いた場合でも抽出全体が宙吊りにならないよう一定時間で諦める。
const IMAGE_OBJECT_TIMEOUT_MS = 5_000;

/**
 * pdfjs の `objs.get` を Promise でラップ。
 *
 * 複数ページで共有される画像は `g_` プレフィックス付きの名前で
 * ドキュメント全体の `commonObjs` に格納される（pdfjs 本体の描画コードも
 * この prefix でストアを振り分けている）。`page.objs` だけを見ると
 * `g_` 名のコールバックが永遠に呼ばれず、抽出処理全体がハングする。
 */
export function getImageObject(
  page: any,
  name: string,
  timeoutMs = IMAGE_OBJECT_TIMEOUT_MS,
): Promise<PdfImageObject | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      const store = name.startsWith("g_") ? page.commonObjs : page.objs;
      // callback バージョンを優先（v5 では同期/非同期どちらでも動く）
      store.get(name, (obj: PdfImageObject | null) => {
        clearTimeout(timer);
        resolve(obj ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * RGBA バッファが「実質単色」かどうかを判定する。
 *
 * 論文 PDF は図の背景パネル・帯・角丸矩形などを単色のラスター画像として
 * 埋め込むことが多く、これらは表示面積が大きくても図としての情報を持たない。
 * 角丸コーナーやアンチエイリアスされた縁が混ざっても判定できるよう、
 * 上下左右 5% を除いた内側だけを最大 96×96 のグリッドでサンプリングし、
 * 全サンプルが基準色から ±3/チャンネル以内なら単色とみなす。
 * アルファは比較しない（mask 由来の画像は透明部も RGB が一様になるため、
 * 矢印・罫線マスクもここで弾ける）。
 */
export function isEffectivelySolidColor(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): boolean {
  if (width < 3 || height < 3) return true;
  const insetX = Math.max(1, Math.round(width * 0.05));
  const insetY = Math.max(1, Math.round(height * 0.05));
  const x0 = insetX;
  const x1 = width - insetX;
  const y0 = insetY;
  const y1 = height - insetY;
  const cols = Math.min(96, x1 - x0);
  const rows = Math.min(96, y1 - y0);
  if (cols <= 0 || rows <= 0) return true;
  const TOLERANCE = 3;
  let r = -1;
  let g = -1;
  let b = -1;
  for (let yi = 0; yi < rows; yi++) {
    const y = y0 + Math.floor(((y1 - y0 - 1) * yi) / Math.max(1, rows - 1));
    for (let xi = 0; xi < cols; xi++) {
      const x = x0 + Math.floor(((x1 - x0 - 1) * xi) / Math.max(1, cols - 1));
      const q = (y * width + x) * 4;
      if (r < 0) {
        r = data[q];
        g = data[q + 1];
        b = data[q + 2];
        continue;
      }
      if (
        Math.abs(data[q] - r) > TOLERANCE ||
        Math.abs(data[q + 1] - g) > TOLERANCE ||
        Math.abs(data[q + 2] - b) > TOLERANCE
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * pdfjs から受け取った画像オブジェクトを canvas で PNG に encode。
 * - `bitmap` (ImageBitmap) があればそれを drawImage する
 * - `data` (RGBA/RGB/Grayscale) があれば ImageData を組み立てて putImageData
 *
 * pdfjs v5 では多くのケースで `bitmap` が入っているため第一選択。
 *
 * `orientation` は CTM 由来の反転指定。`flipX`/`flipY` が立っている場合のみ
 * 出力 canvas で反転を適用して正立させる。no-op（標準形）のときは従来どおり
 * そのまま貼るので、今まで正しく出ていた画像のピクセルは一切変わらない。
 */
async function encodeImageObjectToPng(
  imageObj: PdfImageObject,
  width: number,
  height: number,
  orientation: ImageOrientation = { flipX: false, flipY: false },
): Promise<Blob | null> {
  // まず生データを「ソース canvas」に向き補正なしで描く。
  // bitmap 経路と data 経路を1本化し、反転は出力段でまとめて掛ける
  // （putImageData は canvas transform を無視するため、data も一旦ここを通す）。
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sctx = source.getContext("2d");
  if (!sctx) return null;

  if (imageObj.bitmap) {
    sctx.drawImage(imageObj.bitmap, 0, 0);
  } else if (imageObj.data) {
    const imageData = paintImageDataFromRaw(sctx, imageObj.data, width, height);
    if (!imageData) return null;
    sctx.putImageData(imageData, 0, 0);
  } else {
    return null;
  }

  // 実質単色の画像（図の背景パネル・帯など）は図としての情報を持たないため
  // ここで除外する。表示面積フィルタだけでは大きなベタ矩形が残る
  // （本物の図版より大きいことすらある）ので、内容で判定するしかない。
  const pixels = sctx.getImageData(0, 0, width, height);
  if (isEffectivelySolidColor(pixels.data, width, height)) return null;

  // 反転不要なら従来どおりソースをそのまま出力（余計な再描画をしない）。
  let outCanvas = source;
  if (orientation.flipX || orientation.flipY) {
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.translate(orientation.flipX ? width : 0, orientation.flipY ? height : 0);
    octx.scale(orientation.flipX ? -1 : 1, orientation.flipY ? -1 : 1);
    octx.drawImage(source, 0, 0);
    outCanvas = out;
  }

  return new Promise<Blob | null>((resolve) => {
    outCanvas.toBlob((b) => resolve(b ?? null), "image/png");
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
