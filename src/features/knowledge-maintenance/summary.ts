// 操作を 1 行の文にするための i18n キーと引数（翻訳は後続スライスが足す）

import type { MaintenanceOperation } from "./types";

/** i18n キー名（ja / en の両方に足すこと） */
export const MAINTENANCE_OP_I18N_KEYS = {
  merge_topics: "maintenance.op.merge_topics",
  merge_atoms: "maintenance.op.merge_atoms",
  regenerate: "maintenance.op.regenerate",
  archive_one: "maintenance.op.archive_one",
  archive_many: "maintenance.op.archive_many",
  restore_version: "maintenance.op.restore_version",
  undo: "maintenance.op.undo",
  undo_generic: "maintenance.op.undo_generic",
} as const;

export type MaintenanceOpI18nKey =
  (typeof MAINTENANCE_OP_I18N_KEYS)[keyof typeof MAINTENANCE_OP_I18N_KEYS];

export type OperationDescription = {
  key: MaintenanceOpI18nKey;
  params: Record<string, string | number>;
};

/**
 * 操作の 1 行の説明。params:
 * - merge_topics / merge_atoms: { title, count }（count = 吸収された数）
 * - regenerate / restore_version: { title }
 * - archive_one: { title } / archive_many: { count }
 * - undo: { title } / undo_generic: { count }（戻した対象の数）
 */
export function describeOperation(op: MaintenanceOperation): OperationDescription {
  const title = op.subject?.title ?? "";
  switch (op.kind) {
    case "merge_topics":
    case "merge_atoms":
      return {
        key: MAINTENANCE_OP_I18N_KEYS[op.kind],
        params: { title, count: op.related.filter((r) => r.role === "absorbed").length },
      };
    case "regenerate":
      return { key: MAINTENANCE_OP_I18N_KEYS.regenerate, params: { title } };
    case "restore_version":
      return { key: MAINTENANCE_OP_I18N_KEYS.restore_version, params: { title } };
    case "archive": {
      const archived = op.related.filter((r) => r.role === "archived");
      if (archived.length === 1) {
        return { key: MAINTENANCE_OP_I18N_KEYS.archive_one, params: { title: archived[0].title } };
      }
      return {
        key: MAINTENANCE_OP_I18N_KEYS.archive_many,
        params: { count: archived.length || op.flags.length },
      };
    }
    case "undo":
      if (op.subject) return { key: MAINTENANCE_OP_I18N_KEYS.undo, params: { title } };
      return {
        key: MAINTENANCE_OP_I18N_KEYS.undo_generic,
        params: { count: op.pages.length + op.flags.length },
      };
  }
}
