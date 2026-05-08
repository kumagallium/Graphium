// ドキュメント来歴トラッカー
// 保存ごとにリビジョンを記録し、DocumentProvenance を管理する

import type {
  DocumentProvenance,
  RevisionEntity,
  EditActivity,
  EditActivityType,
  AuthorIdentity,
} from "./types";
import { computeRevisionSummary, computePageHash, isEmptySummary } from "./diff";
import type { GraphiumDocument, GraphiumPage } from "../../lib/document-types";

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

/** エージェントが存在しなければ追加（email / author があれば更新） */
function ensureAgent(
  provenance: DocumentProvenance,
  type: "human" | "ai",
  label: string,
  email?: string,
  author?: AuthorIdentity,
): string {
  const existing = provenance.agents.find(
    (a) => a.type === type && a.label === label,
  );
  if (existing) {
    // email が新たに判明した場合は更新
    if (email && !existing.email) existing.email = email;
    // author は最新値で上書きする（name / email を Settings で更新した場合に反映）
    if (author) existing.author = author;
    return existing.id;
  }

  const id = type === "human" ? HUMAN_AGENT_ID : `agent_ai_${label.replace(/[^a-z0-9]/gi, "_")}`;
  // 同じ ID が既にあれば既存を返す
  const byId = provenance.agents.find((a) => a.id === id);
  if (byId) {
    if (email && !byId.email) byId.email = email;
    if (author) byId.author = author;
    return byId.id;
  }

  provenance.agents.push({ id, type, label, email, author });
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
  /**
   * 自己申告 author identity（Phase 0, team-shared-storage）。
   * 人間エージェント（human_edit / human_derivation / derive_source）に対して
   * のみ EditAgent.author に書き込まれる。AI エージェントには付与しない。
   */
  author?: AuthorIdentity;
  /** true にすると diff が空でもリビジョンを記録する（アクティビティログ用） */
  force?: boolean;
};

/** 保存時にリビジョンを追記する */
export async function recordRevision(
  doc: GraphiumDocument,
  prevPage: GraphiumPage | null,
  activityType: EditActivityType,
  options?: RecordRevisionOptions,
): Promise<GraphiumDocument> {
  const { agentLabel, email, author, force } = options ?? {};
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
  // author は人間エージェントにのみ付与（AI には self-asserted identity を持たせない）
  const effectiveAuthor = agentType === "human" ? author : undefined;
  const agentId = ensureAgent(provenance, agentType, label, email, effectiveAuthor);

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

  return {
    ...doc,
    documentProvenance: provenance,
  };
}

/**
 * 保存時のアクティビティ種別を推定する。
 *
 * 設計方針:
 * - `doc.generatedBy` は **ノート origin**（誰が生み出したか）の不変メタ。
 * - 各リビジョンの attribution は **保存毎に決まる**（人間 or AI）。
 *   AI 操作は明示的に recordRevision を呼んで AI を記録する設計に揃える。
 * - したがってデフォルトは `human_edit`。例外は「origin が AI なのに
 *   documentProvenance がまだ空」のレガシーデータのみで、初回保存時に
 *   AI の origin リビジョンを 1 件補完する目的でのみ ai_generation/derivation を返す。
 */
export function detectActivityType(
  doc: GraphiumDocument,
): { type: EditActivityType; agentLabel?: string } {
  const hasRevisions = (doc.documentProvenance?.revisions?.length ?? 0) > 0;
  if (!hasRevisions && doc.generatedBy) {
    // 旧 crucible-agent 連携は廃止されたので、その文字列が表示されないようマスクする。
    const rawAgent = doc.generatedBy.agent === "crucible-agent" ? "ai" : doc.generatedBy.agent;
    const model = doc.generatedBy.model ?? rawAgent;
    if (doc.derivedFromNoteId) {
      return { type: "ai_derivation", agentLabel: model };
    }
    return { type: "ai_generation", agentLabel: model };
  }
  return { type: "human_edit" };
}
