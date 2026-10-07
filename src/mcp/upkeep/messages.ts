// MCP の返事に使う日本語の固定文（既存ツールに合わせて日本語のみ）。
// 文面は src/i18n/ja.ts の maintenance.op.* / maintenance.state.* / maintenance.undo.refused.* を写す
// （i18n は import しない）。仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §3.1（messages.ts）

import { describeOperation } from "../../features/knowledge-maintenance/summary";
import type { UndoRefusal } from "../../features/knowledge-maintenance/undo";
import type {
  MaintenanceActor,
  MaintenanceOperation,
  MaintenanceOperationState,
} from "../../features/knowledge-maintenance/types";

/** 操作の 1 行の文 */
export function describeOperationJa(op: MaintenanceOperation): string {
  const { key, params } = describeOperation(op);
  const title = String(params.title ?? "");
  const count = Number(params.count ?? 0);
  switch (key) {
    case "maintenance.op.merge_topics":
      return `「${title}」に ${count} 件のトピックを統合しました`;
    case "maintenance.op.merge_atoms":
      return `「${title}」に ${count} 件の洞察を統合しました`;
    case "maintenance.op.regenerate":
      return `「${title}」を再生成しました`;
    case "maintenance.op.archive_one":
      return `「${title}」をアーカイブしました`;
    case "maintenance.op.archive_many":
      return `${count} 件をアーカイブしました`;
    case "maintenance.op.restore_version":
      return `「${title}」を以前の版に戻しました`;
    case "maintenance.op.undo":
      return `「${title}」の操作を取り消しました`;
    case "maintenance.op.undo_generic":
    default:
      return `操作を取り消しました（${count} 件を戻しました）`;
  }
}

/** 操作の状態 */
export function describeStateJa(state: MaintenanceOperationState): string {
  switch (state) {
    case "applied":
      return "取り消せます";
    case "undone":
      return "取り消し済み";
    case "undo_partial":
      return "一部だけ取り消し済み";
    case "interrupted":
      return "途中で止まった操作（途中までの変更を取り消せます）";
    case "running":
      return "実行中";
    default:
      return String(state);
  }
}

/** 取り消しを断る理由。先頭に安定した語を置く */
export function describeRefusalJa(refusal: UndoRefusal): string {
  switch (refusal.code) {
    case "blocked": {
      const names = refusal.blockers.map((b) => `[${b.runId} / ${b.operationId}] ${describeOperationJa(b.op)}`);
      return `BLOCKED: 先に取り消してください: ${names.join(" / ")}`;
    }
    case "not_found":
      return "NOT_FOUND: この操作の記録が見つかりません（記録は 1 年で消えます）";
    case "already_undone":
      return "ALREADY_UNDONE: この操作はすでに取り消されています";
    case "in_progress":
      return "IN_PROGRESS: この操作はまだ実行中か、取り消しの最中です";
    case "unsupported":
      return "UNSUPPORTED: この保存先では、操作の取り消しに対応していません";
    case "copy_unreadable":
      return "COPY_UNREADABLE: 元の内容の写しが読めないため、取り消せません";
    default:
      return "UNSUPPORTED: 取り消せません";
  }
}

/** 操作の経路 */
export function describeActorJa(actor: MaintenanceActor): string {
  if (actor.via !== "mcp") return "Graphium";
  return actor.client ? `MCP (${actor.client})` : "MCP";
}
