// 画像ブロックの端末内 OCR（Tesseract.js, LLM 不使用）。
//
// 標準の image ブロックはそのまま使い、抽出テキストは page.mediaOcr サイドストアに
// 保存する（mediaInlineLabels と同じ独立アノテーション層方式）。これにより画像の
// 入れ方を問わず、どの画像でも後から文字を読める。

export {
  MediaOcrProvider,
  useMediaOcrStore,
  useMediaOcrStoreOptional,
  type MediaOcrStore,
} from "./store";
export { runOcrForImage, resolveMediaUrl } from "./run-ocr";
export { collectOcrText, OCR_CAPABLE_BLOCK_TYPES } from "./collect";
export { ImageOcrToolbarButton } from "./ImageOcrToolbarButton";
