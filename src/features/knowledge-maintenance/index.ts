// 保守の操作の記録と取り消し — 外に見せるものだけ
// 依存の向き: wiki / note-app → knowledge-maintenance → version-snapshots・document-provenance・lib

export {
  MAINTENANCE_COPY_KEY_PREFIX,
  MAINTENANCE_KEY_PREFIX,
  MAINTENANCE_RETENTION_DAYS,
  MAINTENANCE_RUN_KEY_PREFIX,
  asMaintenanceStorage,
} from "./types";
export type {
  MaintenanceActor,
  MaintenanceFlagChange,
  MaintenanceOperation,
  MaintenanceOperationKind,
  MaintenanceOperationState,
  MaintenancePageCopyFile,
  MaintenanceRun,
  MaintenanceStorage,
  MaintenanceTrigger,
} from "./types";

export { deriveOperationStates, findBlockingOperations, operationKey } from "./run-format";
export type { BlockingOperation, OperationStateInfo } from "./run-format";

export { loadRecentRuns, loadRunsFrom, purgeExpired } from "./run-store";

export { describeOperation, MAINTENANCE_OP_I18N_KEYS } from "./summary";
export type { OperationDescription } from "./summary";

export { activeRunIds, beginMaintenanceRun } from "./recorder";
export type {
  MaintenanceHost,
  MaintenanceOperationEndOptions,
  MaintenanceOperationEndResult,
  MaintenanceOperationHandle,
  MaintenanceOperationInit,
  MaintenanceRunHandle,
} from "./recorder";

export { describeUndoImpact, undoMaintenanceOperation } from "./undo";
export type {
  UndoExtras,
  UndoImpact,
  UndoLogInfo,
  UndoOutcome,
  UndoRefusal,
  UndoTarget,
} from "./undo";
