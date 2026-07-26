// モバイルキャプチャ Inbox（受信箱）の public API。
export { getInboxRoot, setInboxRoot } from "./config";
export { mimeFromExtension, kindFromMime } from "./mime";
export { FolderInbox } from "./transport";
export { runInboxImport } from "./importer";
export { InboxView } from "./InboxView";
export type { InboxViewProps, InboxSource } from "./InboxView";
export type {
  UploadCapturedAsset,
  InboxImportOptions,
  InboxImportResult,
} from "./importer";
export type {
  CaptureKind,
  CaptureMeta,
  CaptureRef,
  CaptureBundle,
  InboxTransport,
} from "./types";
