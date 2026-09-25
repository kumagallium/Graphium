// 出典照合（Source check, v1.1） — 実行計画の組み立て（純関数、I/O 無し）。
//
// v1 は「知見 1 件 = 照合する文 1 つ」だったが、v1.1 でトピックにも対応するため
// 「ドキュメント × 照合する文 × 出典」の組（PlanSourceCheckStatement）を最小単位にする。
// 知見は文が 1 つ（id = 知見 ID 自身）、トピックは引用を持つブロックごとに 1 つ。
//
// 「出典 1 件 + それに依拠する文すべて」を 1 回の LLM 呼び出しにまとめる単位でグルーピング
// する（取り込みが 1 つの出典から複数の知見を 1 回で作ったのと対称）。ドキュメントをまたいで
// 同じ出典を引く文は 1 回にまとまる。

import type { SourceMissingReason } from "../../lib/document-types";
import { parseExternalSource } from "../network-graph/external-source";

export type PlanSourceCheckStatement = {
  /** 全ドキュメント・全文を通して一意な ID（API 呼び出しの claimId として使う）。
   *  知見: 知見 ID そのまま。トピック: `${docId}#${statementBlockId}` */
  id: string;
  /** 集約・保存先ドキュメント（知見 or トピック）の wikiId */
  docId: string;
  /** API に渡すタイトル（常にドキュメントのタイトル） */
  title: string;
  /** API に渡す本文。知見: 知見本文全体。トピック: そのブロックのプレーンテキスト */
  body: string;
  /** claimHash 計算用の本文（常にドキュメント全体。claim-hash.ts の claimHashBody で作る
   *  v1 固定の指紋で、AI に渡す body とは抽出が違う — 知見でも body と一致するとは限らない） */
  hashBody: string;
  /** 出典 ID 一覧。知見: derivedFromNotes。トピック: そのブロックが引いた知見 ID に
   *  "claim:" プレフィックスを付けたもの */
  sourceIds: string[];
  /** 照合した文（トピックの要点の文）。知見では付けない */
  statement?: string;
  /** statement があるときの、対応するブロック ID */
  statementBlockId?: string;
  /**
   * 解決を試みるまでもなく分かっている「照合できない」理由（1-c）。
   * 設定されている場合、resolveSourceText / LLM 呼び出しを行わず、sourceIds の各要素ごとに
   * （空なら docId を代わりに使って 1 件）source-missing で直接記録する。
   */
  knownMissingReason?: SourceMissingReason;
};

export type SourceCheckGroup = {
  sourceId: string;
  statementIds: string[];
};

/** knownMissingReason（1-c）で LLM を呼ばずに記録する文 */
export type SourceCheckKnownMissing = {
  statementId: string;
  docId: string;
  /** 空なら「出典の記録自体が無い」（sourceId の代わりに docId を使って 1 エントリだけ作る） */
  sourceIds: string[];
  reason: SourceMissingReason;
};

export type SourceCheckPlan = {
  groups: SourceCheckGroup[];
  /** LLM を呼ばずに source-missing で記録する文（1-c） */
  knownMissing: SourceCheckKnownMissing[];
  /**
   * 原文を取り出せる見込みのある出典の数。実行前の確認ダイアログ用の事前見積り。
   * "chat:"（元チャットへの参照キーを持たず常に no-reference）のように、解決を試みるまでもなく
   * 取り出せないと分かっている種別だけを差し引く。それ以外の解決失敗（ゴミ箱・素材無し・
   * fetch 失敗等）は実際に resolveSourceText を呼ぶまで分からないため、実行時にはこの数より
   * さらに減りうる。knownMissing（LLM を呼ばない）は最初から含めない。
   */
  llmCalls: number;
  /** 対象の「照合する文」の総数（知見 1 件 + トピックの要点の文 N 個、の総和） */
  statementCount: number;
  /** 対象ドキュメント数（知見 + トピック、重複除去） */
  docCount: number;
  /** knownMissing の理由別件数（実行前の確認ダイアログ用） */
  missingCounts: Partial<Record<SourceMissingReason, number>>;
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
 * 「照合する文」群を「出典 → その出典に依拠する文 ID 一覧」にグルーピングする。
 * 1 つの文が複数の出典を持てば、その文 ID は複数グループに現れる。
 * knownMissingReason を持つ文、または sourceIds が空の文はグループ化せず knownMissing に回す
 * （sourceIds が空 = 出典の記録が無い = "not-recorded"。呼び出し側が明示しなくても保険として拾う）。
 */
export function planSourceCheck(statements: PlanSourceCheckStatement[]): SourceCheckPlan {
  const bySource = new Map<string, string[]>();
  const knownMissing: SourceCheckKnownMissing[] = [];
  const missingCounts: Partial<Record<SourceMissingReason, number>> = {};
  const docIds = new Set<string>();

  for (const st of statements) {
    docIds.add(st.docId);
    const reason = st.knownMissingReason ?? (st.sourceIds.length === 0 ? "not-recorded" : undefined);
    if (reason) {
      knownMissing.push({ statementId: st.id, docId: st.docId, sourceIds: st.sourceIds, reason });
      missingCounts[reason] = (missingCounts[reason] ?? 0) + 1;
      continue;
    }
    for (const sourceId of st.sourceIds) {
      const list = bySource.get(sourceId);
      if (list) list.push(st.id);
      else bySource.set(sourceId, [st.id]);
    }
  }

  const groups: SourceCheckGroup[] = [...bySource.entries()].map(([sourceId, statementIds]) => ({
    sourceId,
    statementIds,
  }));
  const llmCalls = groups.filter((g) => !isKnownUnresolvable(g.sourceId)).length;
  return {
    groups,
    knownMissing,
    llmCalls,
    statementCount: statements.length,
    docCount: docIds.size,
    missingCounts,
  };
}
