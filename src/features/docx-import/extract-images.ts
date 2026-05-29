// Word (.docx) から埋め込み画像のみを取り出す。
// mammoth の convertImage コールバックで各画像を File 化し、HTML 出力は捨てる。
// 取り出した File 列を呼び出し側でメディア層に登録する想定。
//
// import.ts と同じ MIME フィルタを使い、ブラウザで表示できない形式
// （EMF / WMF / TIFF など）は黙ってスキップする。

import mammoth from "mammoth";

const RENDERABLE_IMAGE_EXTS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

function isRenderableImageMime(mime: string): boolean {
  return mime.toLowerCase() in RENDERABLE_IMAGE_EXTS;
}

export type DocxImageExtractStats = {
  /** mammoth が convertImage を呼び出した総回数 */
  attempted: number;
  /** ブラウザで表示できない形式でスキップした数 */
  skipped: number;
  /** 取り出せた File 数 */
  collected: number;
};

export type DocxImageExtractResult = {
  files: File[];
  stats: DocxImageExtractStats;
};

/**
 * .docx の arrayBuffer から埋め込み画像のみを取り出す。
 * mammoth.convertToHtml の副作用で画像を回収する。HTML 出力は破棄。
 */
export async function extractDocxImages(
  arrayBuffer: ArrayBuffer,
  baseTitle: string,
): Promise<DocxImageExtractResult> {
  const files: File[] = [];
  const stats: DocxImageExtractStats = { attempted: 0, skipped: 0, collected: 0 };

  await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        stats.attempted++;
        if (!isRenderableImageMime(image.contentType)) {
          stats.skipped++;
          return { src: "" };
        }
        try {
          const base64 = await image.readAsBase64String();
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const ext = RENDERABLE_IMAGE_EXTS[image.contentType.toLowerCase()];
          const blob = new Blob([bytes], { type: image.contentType });
          const file = new File(
            [blob],
            `${baseTitle}-${crypto.randomUUID().slice(0, 8)}.${ext}`,
            { type: image.contentType },
          );
          files.push(file);
          stats.collected++;
        } catch (err) {
          console.error("[docx-extract-images] 画像読み出し失敗:", err);
        }
        return { src: "" };
      }),
    },
  );

  return { files, stats };
}
