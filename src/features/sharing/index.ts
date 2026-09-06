export { shareNote, type ShareNoteResult, type ShareNoteOptions } from "./share-note";
export {
  shareMedia,
  type ShareMediaResult,
  type ShareMediaOptions,
} from "./share-media";
export {
  shareReference,
  type ShareReferenceResult,
  type ShareReferenceOptions,
} from "./share-reference";
export {
  shareKnowledge,
  type ShareKnowledgeResult,
  type ShareKnowledgeOptions,
} from "./share-knowledge";
export {
  shareTemplate,
  type ShareTemplateResult,
  type ShareTemplateOptions,
} from "./share-template";
export { ShareTemplateDialog, type ShareTemplateDialogProps } from "./ShareTemplateDialog";
export {
  forkSharedNote,
  type ForkSharedNoteResult,
  type ForkSharedNoteOptions,
} from "./fork-note";
export {
  forkSharedKnowledge,
  type ForkSharedKnowledgeResult,
  type ForkSharedKnowledgeOptions,
} from "./fork-knowledge";
export {
  unshareEntry,
  type UnshareEntryResult,
  type UnshareEntryOptions,
} from "./unshare-entry";
export {
  materializeSharedBlobs,
  collectSharedBlobHashes,
  type MaterializeOptions,
  type MaterializeResult,
} from "./materialize-blobs";
export { loadAllSharedEntries, type SharedLibraryLoadResult } from "./shared-library-loader";
export { SharedLibraryView } from "./SharedLibraryView";
export {
  bulkShare,
  type BulkShareTarget,
  type BulkShareDeps,
  type BulkShareSummary,
  type BulkShareItemResult,
} from "./bulk-share";
export { BulkShareModal } from "./BulkShareModal";
export {
  getSharedLibrarySnapshot,
  refreshSharedLibrary,
  subscribeSharedLibrary,
  notifySharedLibraryChanged,
  readSharedEntryBody,
  getSharedLibraryRoot,
  useSharedLibrary,
  groupSharedEntriesByType,
  __setSharedLibraryLoaderForTest,
  type SharedLibrarySnapshot,
  type SharedLibraryLoader,
  type SharedEntryReader,
} from "./shared-library-store";
export {
  sharedEntryToSourceInput,
  sharedEntryFingerprint,
  SHARED_INDEXABLE_TYPES,
} from "./shared-entry-source";
export {
  useSharedLibrarySync,
  SHARED_AUTO_REFRESH_THROTTLE_MS,
  type SharedLibrarySyncParams,
} from "./shared-library-sync";
export {
  createComment,
  editComment,
  deleteComment,
  commentsFor,
  commentEntriesFor,
  countCommentsFor,
  countCommentsByTarget,
  loadCommentTexts,
  splitByTargetVersion,
  commentSummary,
  type SharedComment,
  type SharedCommentExtra,
  type CommentThread,
  type SharedCommentResult,
  type SharedCommentProvider,
  type CreateCommentOptions,
  type EditCommentOptions,
  type DeleteCommentOptions,
} from "./shared-comments";
export {
  SharedCommentsThread,
  type SharedCommentsThreadProps,
  type SharedCommentAnchor,
} from "./SharedCommentsThread";
export {
  SHARED_SEEN_KEY,
  readSeenStore,
  parseSeenStore,
  getSeen,
  markSeen,
  isUpdatedSince,
  newCommentCount,
  type SharedSeenRecord,
  type SharedSeenStore,
} from "./shared-seen";
export {
  appendHistory,
  historyForUpdate,
  SHARED_HISTORY_LIMIT,
} from "./share-history";
export {
  SHARED_PROJECTION_VERSION,
  projectSharedNote,
  parseStoredProjection,
  createEmptySharedProjection,
  loadSharedProjection,
  getSharedProjection,
  subscribeSharedProjection,
  useSharedProjection,
  recordSharedProjectionFromBody,
  pruneSharedProjection,
  buildSharedPseudoIndex,
  buildSharedProcessIndex,
  countProjectedLabelNotes,
  countProjectedProcessNotes,
  buildReverseLinks,
  type SharedReverseLinks,
  type SharedProjection,
  type SharedProjectionEntry,
} from "./shared-projection";
