export type {
  SharedEntry,
  SharedEntryType,
  SharedEntryContent,
  HistoryEntry,
  Attestation,
  Lock,
  ReviewRequest,
  SharedStorageProvider,
  BlobRef,
  BlobStorageProvider,
} from "./types";

export {
  BUILTIN_SHARED_PROVIDER_KINDS,
  BUILTIN_BLOB_PROVIDER_KINDS,
} from "./types";

export { newSharedId, isValidSharedId } from "./id";
export { computeSharedEntryHash, computeBlobHash } from "./hash";
export {
  LocalFolderSharedProvider,
  LocalFolderBlobProvider,
  AuthorMismatchError,
  type ProviderIdentity,
} from "./local-folder";
export {
  getSharedFolders,
  setSharedFolders,
  createSharedFolder,
  getDefaultSharedFolder,
  findSharedFolderByRoot,
  updateSharedFolder,
  sharedFolderLabel,
  getBlobRootForCleanup,
  defaultBlobRootFor,
  effectiveBlobRoot,
  SHARED_BLOBS_DIR_NAME,
  type SharedFolder,
  getSharedRoot,
  setSharedRoot,
  getSharedRootRemote,
  setSharedRootRemote,
  getBlobRoot,
  setBlobRoot,
  getSharedAiEnabled,
  setSharedAiEnabled,
  getShareIncludesPrivateHistory,
  setShareIncludesPrivateHistory,
} from "./config";
export { pickSharedRoot, pickBlobRoot, pickInboxRoot } from "./picker";
export {
  testSharedConnection,
  testBlobConnection,
  type ConnectionTestResult,
} from "./test-connection";
export {
  diagnoseSharedRoot,
  rememberSharedRootRemote,
  reconnectSharedRoot,
  waitForSharedRoot,
  isSharedRootReachable,
  type SharedRootDiagnosis,
} from "./reachability";
