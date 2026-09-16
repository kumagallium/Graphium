// 出典照合（Source check, v1） — 実行計画の組み立て（純関数、I/O 無し）。
//
// 「出典 1 件 + それに依拠する知見すべて」を 1 回の LLM 呼び出しにまとめる単位で
// グルーピングする（取り込みが 1 つの出典から複数の知見を 1 回で作ったのと対称）。

import { parseExternalSource } from "../network-graph/external-source";

export type PlanSourceCheckClaim = {
  id: string;
  /** WikiMeta.derivedFromNotes。無い/空なら出典が無い知見として扱う */
  derivedFromNotes?: string[];
};

export type SourceCheckGroup = {
  sourceId: string;
  claimIds: string[];
};

export type SourceCheckPlan = {
  groups: SourceCheckGroup[];
  /**
   * 原文を取り出せる見込みのある出典の数。実行前の確認ダイアログ用の事前見積り。
   * "chat:"（元チャットへの参照キーを持たず常に no-reference）のように、解決を試みるまでもなく
   * 取り出せないと分かっている種別だけを差し引く。それ以外の解決失敗（ゴミ箱・素材無し・
   * fetch 失敗等）は実際に resolveSourceText を呼ぶまで分からないため、実行時にはこの数より
   * さらに減りうる。
   */
  llmCalls: number;
  claimCount: number;
};

/** 解決を試みるまでもなく「原文を取り出せない」と分かっている出典種別か */
function isKnownUnresolvable(sourceId: string): boolean {
  const parsed = parseExternalSource(sourceId);
  if (!parsed) return false; // プレフィックス無し（通常ノート）は試みる価値がある
  // chat: は元チャットへの参照キーを持たない（no-reference が確定）。
  // shared: / data: / image: は Knowledge 化の出典として derivedFromNotes に入らない想定の
  // ID だが、混入していた場合に備えて同じく除外する（unsupported-kind が確定）。
  return (
    parsed.kind === "chat" ||
    parsed.kind === "shared" ||
    parsed.kind === "data" ||
    parsed.kind === "image"
  );
}

/**
 * 知見群を「出典 → その出典に依拠する知見 ID 一覧」にグルーピングする。
 * 1 つの知見が複数の出典を持てば、その知見 ID は複数グループに現れる。
 */
export function planSourceCheck(claims: PlanSourceCheckClaim[]): SourceCheckPlan {
  const bySource = new Map<string, string[]>();
  for (const claim of claims) {
    for (const sourceId of claim.derivedFromNotes ?? []) {
      const list = bySource.get(sourceId);
      if (list) list.push(claim.id);
      else bySource.set(sourceId, [claim.id]);
    }
  }
  const groups: SourceCheckGroup[] = [...bySource.entries()].map(([sourceId, claimIds]) => ({
    sourceId,
    claimIds,
  }));
  const llmCalls = groups.filter((g) => !isKnownUnresolvable(g.sourceId)).length;
  return { groups, llmCalls, claimCount: claims.length };
}
