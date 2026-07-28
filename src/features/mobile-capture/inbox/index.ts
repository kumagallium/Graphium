// モバイルキャプチャ Inbox（受信箱）の public API。
export {
  getInboxRoot,
  setInboxRoot,
  getInboxKeepArchive,
  setInboxKeepArchive,
} from "./config";
export {
  isMobileInboxEnabled,
  setMobileInboxEnabled,
  useMobileInboxFlag,
  MOBILE_INBOX_FLAG_EVENT,
} from "./experimental";
export { mimeFromExtension, kindFromMime } from "./mime";
export { FolderInbox } from "./transport";
export { runInboxImport } from "./importer";
export { InboxView } from "./InboxView";
export type { InboxViewProps, InboxSource } from "./InboxView";
export type {
  UploadCapturedAsset,
  InboxImportOptions,
  InboxImportResult,
  InboxCapturePayloadHandlers,
  CapturePayloadContext,
} from "./importer";
export {
  GRAPHIUM_CAPTURE_EXTENSION,
  GRAPHIUM_CAPTURE_FILE_VERSION,
  GRAPHIUM_CAPTURE_MIME,
  buildMemoCaptureFile,
  buildUrlCaptureFile,
  captureFilePreview,
  captureKindFromName,
  isGraphiumCaptureName,
  parseGraphiumCaptureFile,
} from "./capture-file";
export type {
  GraphiumCaptureKind,
  GraphiumCapturePayload,
  GraphiumMemoCapturePayload,
  GraphiumUrlCapturePayload,
} from "./capture-file";
export type {
  CaptureKind,
  CaptureMeta,
  CaptureRef,
  CaptureBundle,
  InboxTransport,
} from "./types";
