// アセットブラウザ feature のエクスポート

export { AssetGalleryView } from "./AssetGalleryView";
export type { AssetGalleryViewProps } from "./AssetGalleryView";

export {
  readMediaIndex,
  saveMediaIndex,
  createEmptyIndex,
  addMediaEntry,
  removeMediaEntry,
  archiveMediaEntry,
  restoreMediaEntry,
  syncUsedIn,
  removeNoteFromUsedIn,
  countByType,
  deleteMediaFile,
  renameMediaFile,
  renameMediaEntry,
  setMediaEntryContexts,
  remapMediaContexts,
  extractFileIdFromUrl,
  extractMediaFromBlocks,
  collectPdfFileIdsFromDoc,
  collectSourceAssetFileIdsFromDoc,
  isDocumentMime,
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
  buildUrlPeekEntry,
  buildMemoPeekEntry,
  persistUrlMetaPatch,
  isMobileCapture,
  getLatestMediaIndex,
  clearMediaIndexCache,
  previewImageKey,
  isLocalPreviewRef,
  MEDIA_INDEX_CHANGED_EVENT,
} from "./media-index";
export { findSameAsset, computeAssetContentHash, backfillContentHashes } from "./dedupe";
export type {
  MediaIndex,
  MediaIndexEntry,
  MediaType,
  MediaUsage,
  UrlMeta,
  UrlMetaPatch,
} from "./media-index";

export {
  ensureCachedPreviewImage,
  loadPreviewImage,
  usePreviewImage,
  useBookmarkPreviewImage,
  startPreviewBackfill,
} from "./preview-image";

export { MediaPickerModal } from "./MediaPickerModal";
export type { MediaPickerModalProps, AssetDisplayMode } from "./MediaPickerModal";

export { LabelGalleryView } from "./LabelGalleryView";

export { UrlBookmarkModal } from "./UrlBookmarkModal";
export type { UrlBookmarkModalProps } from "./UrlBookmarkModal";

export { getMediaSlashMenuItems, setMediaPickerCallback, DEFAULT_MEDIA_SLASH_KEYS } from "./slash-menu-items";

export { UrlPasteMenu } from "./UrlPasteMenu";
export type { UrlPasteMenuProps } from "./UrlPasteMenu";

export {
  isHttpUrl,
  computeUrlPasteMenuPosition,
  buildPastedTextContent,
  insertBookmarkBlockFromPaste,
  retroLinkifyPastedUrl,
  blockContainsUrlLink,
  registerUrlAsset,
} from "./url-paste";

export { NoteMemosSection, filterMemosByNote } from "./NoteMemosSection";
export type { NoteMemosSectionProps } from "./NoteMemosSection";
