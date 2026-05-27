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
  collectPdfFileIdsFromDoc,
  DOC_REF_BLOCK_ID,
  CURRENT_MEDIA_INDEX_VERSION,
  findBlockIdsByMediaUrl,
  updateBlockNameByUrl,
  mimeToMediaType,
  ensureMediaIndex,
  fetchUrlMetadata,
  generateUrlBookmarkId,
  extractDomain,
  getFaviconUrl,
  persistUrlMetaPatch,
  MEDIA_INDEX_CHANGED_EVENT,
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

export { NoteMemosSection, filterMemosByNote } from "./NoteMemosSection";
export type { NoteMemosSectionProps } from "./NoteMemosSection";
