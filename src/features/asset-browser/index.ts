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

export { MediaPickerModal } from "./MediaPickerModal";
export type { MediaPickerModalProps } from "./MediaPickerModal";

export { LabelGalleryView } from "./LabelGalleryView";

export { getMediaSlashMenuItems, setMediaPickerCallback, DEFAULT_MEDIA_SLASH_TITLES } from "./slash-menu-items";
