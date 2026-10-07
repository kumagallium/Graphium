// 手入れの書き手（経路・クライアント名・モデル）の表現。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §3.1（actor.ts）

import { userInfo } from "node:os";

import type { GraphiumDocument } from "../../lib/document-types";
import type { MaintenanceActor } from "../../features/knowledge-maintenance/types";

/**
 * 誰が保存したかを解決する（create-note.ts と同じ規則）。
 * username は識別のため常に記録し、email は明示的な opt-in があるときだけ入れる。
 */
export function resolveAuthor(): { username: string; email?: string } {
  const user: { username: string; email?: string } = { username: userInfo().username };
  const email = process.env.GRAPHIUM_USER_EMAIL?.trim();
  if (email) user.email = email;
  return user;
}

/** 操作の記録（maint-run-*）に残す実行者。undefined の項目は入れない */
export function buildActor(client?: string, model?: string): MaintenanceActor {
  const actor: MaintenanceActor = { via: "mcp" };
  if (client) actor.client = client;
  if (model) actor.model = model;
  return actor;
}

/** 編集の記録（EditAgent）に残す名前。save-answer.ts と同じ形 */
export function agentLabelFor(client?: string): string {
  return client ? `graphium-mcp (${client})` : "graphium-mcp";
}

/**
 * 文書トップレベルの generatedBy を MCP 経由の形で打ち直す（save-answer.ts と同じ形）。
 * rebuildSourceBackedWikiDocument は agent: "ai" に上書きするので、保存前に呼ぶ。
 */
export function stampGeneratedBy(
  doc: GraphiumDocument,
  info: { client?: string; sessionId?: string; model?: string },
): GraphiumDocument {
  const model = info.model?.trim() || "unknown";
  doc.generatedBy = {
    agent: agentLabelFor(info.client),
    sessionId: info.sessionId ?? "unknown",
    user: resolveAuthor(),
    ...(model !== "unknown" ? { model } : {}),
  };
  return doc;
}
