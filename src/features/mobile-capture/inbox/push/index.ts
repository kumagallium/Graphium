// push（モバイル → クラウド Inbox 直接アップロード）の public API。
//
// **意図的に inbox/index.ts からは re-export しない。**
// このレイヤーは gsi（Google Identity Services）の動的ロードや IndexedDB キューを
// 含み、起動時バンドルに入れる必要がない。UI からは
//   const push = await import("./push");
// のように動的 import で使うこと（inbox バレル経由で eager に引かない）。

export {
  PushAuthError,
  PushConfigError,
  type InboxPusher,
  type PusherKind,
  type PushOptions,
  type PushProgress,
  type PushResult,
} from "./types";

export {
  DEFAULT_GOOGLE_PUSH_CLIENT_ID,
  getGoogleClientId,
  getGoogleClientIdOverride,
  getPushProvider,
  setGoogleClientIdOverride,
  setPushProvider,
  type DriveInboxFolderCache,
} from "./config";

export { GoogleDrivePusher, type GoogleDrivePusherOptions } from "./drive-pusher";

export {
  extensionForCapture,
  formatCaptureTimestamp,
  normalizeCaptureName,
} from "./naming";

export {
  clearPushQueue,
  drainPushQueue,
  enqueuePushFiles,
  getPushQueueFiles,
  getPushQueueSnapshot,
  removePushQueueItem,
  retryFailedPushItems,
  subscribePushQueue,
  type DrainResult,
  type PushQueueItemMeta,
  type PushQueueItemStatus,
  type PushQueueSnapshot,
} from "./queue";
