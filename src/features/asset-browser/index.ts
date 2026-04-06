// アセットブラウザ feature のエクスポート

export { AssetGalleryView } from "./AssetGalleryView";
export type { AssetGalleryViewProps } from "./AssetGalleryView";

export {
  readMediaIndex,
  saveMediaIndex,
  createEmptyIndex,
  addMediaEntry,
  removeMediaEntry,
  syncUsedIn,
  removeNoteFromUsedIn,
  countByType,
  deleteMediaFile,
  renameMediaFile,
  renameMediaEntry,
  extractFileIdFromUrl,
  extractMediaFromBlocks,
  mimeToMediaType,
  ensureMediaIndex,
} from "./media-index";
export type {
  MediaIndex,
  MediaIndexEntry,
  MediaType,
  MediaUsage,
} from "./media-index";
