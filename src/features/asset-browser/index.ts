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
  findBlockIdsByMediaUrl,
  updateBlockNameByUrl,
  mimeToMediaType,
  ensureMediaIndex,
  fetchUrlMetadata,
  generateUrlBookmarkId,
  extractDomain,
  getFaviconUrl,
} from "./media-index";
export type {
  MediaIndex,
  MediaIndexEntry,
  MediaType,
  MediaUsage,
  UrlMeta,
} from "./media-index";

export { MediaPickerModal } from "./MediaPickerModal";
export type { MediaPickerModalProps } from "./MediaPickerModal";

export { LabelGalleryView } from "./LabelGalleryView";

export { UrlBookmarkModal } from "./UrlBookmarkModal";
export type { UrlBookmarkModalProps } from "./UrlBookmarkModal";

export { getMediaSlashMenuItems, setMediaPickerCallback, DEFAULT_MEDIA_SLASH_TITLES } from "./slash-menu-items";

export { UrlPasteMenu } from "./UrlPasteMenu";
export type { UrlPasteMenuProps } from "./UrlPasteMenu";
