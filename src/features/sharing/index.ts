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
  shareProposal,
  updateProposal,
  withdrawProposal,
  readProposalExtra,
  proposalEntriesFor,
  countProposalsByTarget,
  proposalStatus,
  type SharedProposalExtra,
  type ProposalInput,
  type ProposalStatus,
  type ShareProposalOptions,
  type ShareProposalResult,
  type WithdrawProposalOptions,
} from "./share-proposal";
export {
  saveForkBase,
  loadForkBase,
  clearForkBase,
  type ForkBase,
} from "./fork-base";
// 共有エントリ id → 手元のノート id（§25b B-6）。共有ライブラリの提案から
// 取り込みを始めるときに、宛先の手元ノートを引くために使う
export {
  saveSharedNoteLink,
  loadSharedNoteLink,
  findNoteBySharedId,
  resolveSharedNoteId,
  type SharedNoteLink,
  type LoadNoteDoc,
  type ResolveSharedNoteDeps,
} from "./shared-note-link";
export {
  resolveProposalBase,
  isTargetUpdatedSinceFork,
  type ProposalBaseOrigin,
  type ResolvedProposalBase,
} from "./proposal-base";
export {
  ProposeChangesDialog,
  type ProposeChangesDialogProps,
} from "./ProposeChangesDialog";
export { NoteProposalStatusBadge } from "./NoteProposalStatusBadge";
export { ProposalDiffPanel, type ProposalDiffPanelProps } from "./ProposalDiffPanel";
export { useProposalDiff, type ProposalDiffState } from "./use-proposal-diff";
export {
  computeProposalDiff,
  summarizeProposalDiff,
  stripForkSuffix,
  type ProposalDiff,
  type ProposalDiffInput,
  type ProposalDiffSummary,
  type ProposalChangeBy,
  type BlockChange,
  type BlockChangeKind,
  type TableCellChange,
  type Change,
} from "./proposal-diff";
export {
  applyProposalChanges,
  collectAdoptedProposals,
  type ApplyProposalChangesInput,
  type ApplyProposalChangesResult,
} from "./proposal-apply";
export {
  defaultProposalSelection,
  toggleProposalSelection,
  isChangeSelectable,
  countSelected,
  cellIdsOf,
} from "./proposal-selection";
export {
  applyAdoptedPageAnnotations,
  type AdoptLabelStore,
  type AdoptLinkStore,
} from "./proposal-adopt-stores";
export {
  NoteProposalsPanel,
  NoteProposalsBadge,
  NoteProposalsRailIcon,
  useNoteProposalCount,
  type NoteProposalsPanelProps,
  type AdoptProposalRequest,
  type AdoptProposalOutcome,
} from "./NoteProposalsPanel";
export { NoteForkedFromChip, type NoteForkedFrom } from "./NoteForkedFromChip";
export { buildNoteSharedGraph, type NoteSharedGraphData } from "./note-shared-graph";
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
export { SharedNoteView, type SharedNoteViewProps } from "./SharedNoteView";
export {
  SharedNoteChatPanel,
  type SharedNoteChatPanelProps,
  type SharedNoteChatDeps,
} from "./SharedNoteChatPanel";
export {
  SharedEntryBody,
  SharedNotePreview,
  useSharedEntryBodyText,
  type SharedEntryBodyReader,
} from "./SharedEntryBody";
export {
  SharedEntryActions,
  SharedEntryHistory,
  SharedEntryMeta,
  ReverseLinksSection,
  sharedEntryTitle,
  sharedEntryTypeLabel,
} from "./shared-entry-parts";
export {
  useSharedPreviewAnchor,
  type SharedPreviewAnchor,
} from "./use-shared-preview-anchor";
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
  templateToPseudoDocument,
  parseSharedTemplateBody,
} from "./shared-template-doc";
export {
  supportsSharedChat,
  buildSharedSubject,
  buildSharedChatMessage,
  buildSharedRetrievalQuery,
  toAgentHistory,
  sharedChatsKey,
  SHARED_CHATS_KEY_PREFIX,
  SHARED_UNVERIFIED_NOTICE,
  DEFAULT_SHARED_BUDGET_CHARS,
  type SharedChatSubject,
  type BuildSharedSubjectOptions,
  type BuildSharedChatMessageParams,
} from "./shared-chat";
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
  markProposalsSeen,
  newProposalCount,
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
