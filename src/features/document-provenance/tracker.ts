// ドキュメント来歴トラッカー
// 保存ごとにリビジョンを記録し、DocumentProvenance を管理する

import type {
  DocumentProvenance,
  RevisionEntity,
  EditActivity,
  EditActivityType,
} from "./types";
import { computeRevisionSummary, computePageHash, isEmptySummary } from "./diff";
import type { ProvNoteDocument, ProvNotePage } from "../../lib/google-drive";

// 既知のエージェント ID
const HUMAN_AGENT_ID = "agent_human";

/** 連番 ID 生成 */
function nextId(prefix: string, existing: { id: string }[]): string {
  let max = 0;
  for (const item of existing) {
    const match = item.id.match(new RegExp(`^${prefix}_(\\d+)$`));
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `${prefix}_${String(max + 1).padStart(3, "0")}`;
}

/** エージェントが存在しなければ追加（email があれば更新） */
function ensureAgent(
  provenance: DocumentProvenance,
  type: "human" | "ai",
  label: string,
  email?: string,
): string {
  const existing = provenance.agents.find(
    (a) => a.type === type && a.label === label,
  );
  if (existing) {
    // email が新たに判明した場合は更新
    if (email && !existing.email) existing.email = email;
    return existing.id;
  }

  const id = type === "human" ? HUMAN_AGENT_ID : `agent_ai_${label.replace(/[^a-z0-9]/gi, "_")}`;
  // 同じ ID が既にあれば既存を返す
  const byId = provenance.agents.find((a) => a.id === id);
  if (byId) {
    if (email && !byId.email) byId.email = email;
    return byId.id;
  }

  provenance.agents.push({ id, type, label, email });
  return id;
}

/** 空の DocumentProvenance を作成 */
export function createEmptyProvenance(): DocumentProvenance {
  return {
    revisions: [],
    activities: [],
    agents: [],
  };
}

/** recordRevision のオプション */
export type RecordRevisionOptions = {
  agentLabel?: string;
  /** Google アカウントのメールアドレス */
  email?: string;
  /** true にすると diff が空でもリビジョンを記録する（アクティビティログ用） */
  force?: boolean;
};

/** 保存時にリビジョンを追記する */
export async function recordRevision(
  doc: ProvNoteDocument,
  prevPage: ProvNotePage | null,
  activityType: EditActivityType,
  options?: RecordRevisionOptions,
): Promise<ProvNoteDocument> {
  const { agentLabel, email, force } = options ?? {};
  const provenance = doc.documentProvenance
    ? structuredClone(doc.documentProvenance)
    : createEmptyProvenance();

  const currentPage = doc.pages[0];
  if (!currentPage) return doc;

  // 差分計算
  const summary = computeRevisionSummary(prevPage, currentPage);

  // 変更なしならスキップ（force 指定時は記録する）
  if (!force && prevPage && isEmptySummary(summary)) return doc;

  const now = new Date().toISOString();

  // ページハッシュ計算（改ざん検知用）
  const contentHash = await computePageHash(currentPage);

  // エージェント登録
  const agentType =
    activityType === "human_edit" || activityType === "human_derivation" || activityType === "derive_source"
      ? "human" : "ai";
  const label = agentLabel ?? (agentType === "human" ? "user" : "ai");
  const agentId = ensureAgent(provenance, agentType, label, email);

  // Activity 作成
  const activityId = nextId("edit", provenance.activities);
  const activity: EditActivity = {
    id: activityId,
    type: activityType,
    startedAt: now,
    endedAt: now,
    wasAssociatedWith: agentId,
  };
  provenance.activities.push(activity);

  // Revision 作成
  const prevRevision = provenance.revisions[provenance.revisions.length - 1];
  const revisionId = nextId("rev", provenance.revisions);
  const revision: RevisionEntity = {
    id: revisionId,
    savedAt: now,
    summary,
    contentHash,
    prevContentHash: prevRevision?.contentHash,
    wasDerivedFrom: prevRevision?.id,
    wasGeneratedBy: activityId,
  };
  provenance.revisions.push(revision);

  // 上限チェック: 100件を超えたら古いものを削除
  if (provenance.revisions.length > 100) {
    const removeCount = provenance.revisions.length - 100;
    const removedRevisions = provenance.revisions.splice(0, removeCount);

    // 削除されたリビジョンに紐づく Activity も削除
    const removedActivityIds = new Set(removedRevisions.map((r) => r.wasGeneratedBy));
    provenance.activities = provenance.activities.filter(
      (a) => !removedActivityIds.has(a.id),
    );

    // 最古リビジョンの wasDerivedFrom をクリア（前リビジョンが削除済み）
    if (provenance.revisions.length > 0) {
      provenance.revisions[0].wasDerivedFrom = undefined;
    }
  }

  return {
    ...doc,
    documentProvenance: provenance,
  };
}

/** AI 操作による保存の場合、generatedBy から EditAgent 情報を抽出 */
export function detectActivityType(
  doc: ProvNoteDocument,
): { type: EditActivityType; agentLabel?: string } {
  if (doc.generatedBy) {
    const model = doc.generatedBy.model ?? doc.generatedBy.agent;
    if (doc.derivedFromNoteId) {
      return { type: "ai_derivation", agentLabel: model };
    }
    return { type: "ai_generation", agentLabel: model };
  }
  return { type: "human_edit" };
}
