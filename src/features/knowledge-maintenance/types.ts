// 保守の操作の記録（取り消し用の写し）— 型と定数
// 仕様: docs/internal/knowledge-maintenance-undo-spec-2026-10.md §3

import type { GraphiumDocument } from "../../lib/document-types";

export const MAINTENANCE_RUN_KEY_PREFIX = "maint-run-";
export const MAINTENANCE_COPY_KEY_PREFIX = "maint-copy-";
/** 列挙・掃除用 */
export const MAINTENANCE_KEY_PREFIX = "maint-";
export const MAINTENANCE_RETENTION_DAYS = 365;
/** 期限切れの掃除 1 回で消すキーの上限（古い順）。端末の時計が大きく進んでいても、1 回の起動で全部は消えない */
export const MAINTENANCE_PURGE_MAX_PER_RUN = 200;

export type MaintenanceTrigger =
  | "merge_topics"
  | "organize_topics"
  | "merge_atoms"
  | "regenerate"
  | "rebuild_topics"
  | "bulk_archive"
  | "restore_version"
  | "undo";

export type MaintenanceActor = { via: "app" | "mcp"; client?: string; model?: string };

export type MaintenanceOperationKind =
  | "merge_topics"
  | "merge_atoms"
  | "regenerate"
  | "archive"
  | "restore_version"
  | "undo";

/** 読み込み時に既知として扱う操作の kind（これ以外の操作は読み込み時に除く） */
export const MAINTENANCE_OPERATION_KINDS: readonly MaintenanceOperationKind[] = [
  "merge_topics",
  "merge_atoms",
  "regenerate",
  "archive",
  "restore_version",
  "undo",
];

export type MaintenanceFlagChange = {
  wikiId: string;
  flag: "deletedAt" | "archivedAt";
  before: string | null;
  after: string | null;
};

export type MaintenanceOperation = {
  id: string;
  kind: MaintenanceOperationKind;
  startedAt: string;
  /**
   * 最初にページ・フラグを書き換えた時刻。操作の新旧はこちらで決める（無ければ startedAt）。
   * 統合や作り直しは beginOperation のあと LLM を待ってから保存するので、
   * startedAt では待っている間に入った別の操作と新旧が逆になる
   */
  firstWriteAt?: string;
  endedAt?: string;
  /** 主対象（残す側・書き直した対象）。一括アーカイブでは無い */
  subject?: { wikiId: string; title: string };
  /** 関係するページ（吸収される側・しまう側）。操作の開始時に書く */
  related: { wikiId: string; title: string; role: "absorbed" | "archived" }[];
  /** 写しを取ったページ。写しの本体は copyKey のキーにある */
  pages: { wikiId: string; title: string; copyKey: string }[];
  /** 索引のフラグの変化（実際に変わったものだけ） */
  flags: MaintenanceFlagChange[];
  /** 記録上の状態は 2 つだけ。「取り消し済み」は保存しない（導出する） */
  status: "running" | "applied";
  /** kind が "undo" のとき: 取り消した対象と、項目ごとの結果 */
  undoOf?: { runId: string; operationId: string };
  undoResult?: {
    pages: { wikiId: string; ok: boolean; reason?: string }[];
    flags: { wikiId: string; flag: "deletedAt" | "archivedAt"; ok: boolean; reason?: string }[];
  };
  note?: string;
};

export type MaintenanceRun = {
  formatVersion: 1;
  /** キーそのもの（"maint-run-…"） */
  id: string;
  /** ISO 8601 */
  startedAt: string;
  endedAt?: string;
  trigger: MaintenanceTrigger;
  actor: MaintenanceActor;
  operations: MaintenanceOperation[];
};

export type MaintenanceDocCopy = Omit<GraphiumDocument, "documentProvenance">;

/** maint-copy-* の中身 */
export type MaintenancePageCopyFile = {
  formatVersion: 1;
  runId: string;
  operationId: string;
  wikiId: string;
  capturedAt: string;
  doc: MaintenanceDocCopy;
};

/** 操作の表示上の状態（保存せず、実行の一覧から導く） */
export type MaintenanceOperationState =
  | "applied"
  | "undone"
  | "undo_partial"
  | "interrupted"
  | "running";

/**
 * ストレージの口（構造的な型）。StorageProvider 本体には依存しない。
 * 段 3 で MCP 側からも同じ形で使えるようにする。
 */
export type MaintenanceStorage = {
  readAppData(key: string): Promise<unknown | null>;
  writeAppData(key: string, data: unknown): Promise<void>;
  listAppDataKeys(prefix: string): Promise<string[]>;
  deleteAppData(key: string): Promise<void>;
};

/** 4 つのメソッドが任意で付く口（StorageProvider や MCP 側の fs 実装がこの形を満たす） */
export type MaintenanceStorageLike = {
  readAppData?: MaintenanceStorage["readAppData"];
  writeAppData?: MaintenanceStorage["writeAppData"];
  listAppDataKeys?: MaintenanceStorage["listAppDataKeys"];
  deleteAppData?: MaintenanceStorage["deleteAppData"];
};

/** 4 つのメソッドが全部ある provider だけ口に変換する。1 つでも無ければ null */
export function asMaintenanceStorage(
  provider: MaintenanceStorageLike | null | undefined,
): MaintenanceStorage | null {
  if (!provider) return null;
  const { readAppData, writeAppData, listAppDataKeys, deleteAppData } = provider;
  if (!readAppData || !writeAppData || !listAppDataKeys || !deleteAppData) return null;
  return {
    readAppData: (k) => readAppData.call(provider, k),
    writeAppData: (k, d) => writeAppData.call(provider, k, d),
    listAppDataKeys: (p) => listAppDataKeys.call(provider, p),
    deleteAppData: (k) => deleteAppData.call(provider, k),
  };
}
