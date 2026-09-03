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
  getSharedRoot,
  setSharedRoot,
  getBlobRoot,
  setBlobRoot,
  getSharedAiEnabled,
  setSharedAiEnabled,
} from "./config";
export { pickSharedRoot, pickBlobRoot, pickInboxRoot } from "./picker";
export {
  testSharedConnection,
  testBlobConnection,
  type ConnectionTestResult,
} from "./test-connection";
