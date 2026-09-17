// 出典照合（Source check, v1.1） — 知見・トピックのドキュメントから
// planSourceCheck に渡す PlanSourceCheckStatement[] を組み立てる（純関数）。
//
// 知見（claim）: 文は 1 つ（id = 知見 ID 自身、本文 = 知見本文全体）、出典 = derivedFromNotes。
//   ただし ⌘K の回答から作った知見（isAiAnswerClaim）は "ai-answer" で source-missing 直行。
// トピック（topic）: 文は引用を持つブロックごと（extractTopicStatements）、出典 = そのブロックが
//   引いた知見 ID に "claim:" プレフィックスを付けたもの。引用を持つブロックが 1 つも無ければ
//   "not-recorded"（sourceIds を空にする。planSourceCheck が自動的に not-recorded に倒す）。

import type { GraphiumDocument } from "../../lib/document-types";
import { isAiAnswerClaim } from "./ai-answer";
import { toClaimSourceId } from "./claim-source-id";
import type { PlanSourceCheckStatement } from "./plan";
import { extractSourceTopicStatements, extractTopicStatements } from "./topic-statements";
import { extractPlainTextFromDoc } from "../wiki/wiki-service";

export type SourceCheckTarget = {
  /** ドキュメントの wikiId（"wiki:" プレフィックス無し） */
  docId: string;
  /** wikiMeta.kind が "claim" | "topic" のドキュメント。それ以外は無視する */
  doc: GraphiumDocument;
};

/** 知見 1 件を PlanSourceCheckStatement 1 件に変換する */
function buildClaimStatement(target: SourceCheckTarget): PlanSourceCheckStatement {
  const { docId, doc } = target;
  const title = doc.title ?? "";
  const hashBody = extractPlainTextFromDoc(doc);
  if (isAiAnswerClaim(doc)) {
    return {
      id: docId,
      docId,
      title,
      body: hashBody,
      hashBody,
      sourceIds: doc.wikiMeta?.derivedFromNotes ?? [],
      knownMissingReason: "ai-answer",
    };
  }
  return {
    id: docId,
    docId,
    title,
    body: hashBody,
    hashBody,
    sourceIds: doc.wikiMeta?.derivedFromNotes ?? [],
  };
}

/** トピック 1 件を、要点の文ごとに複数の PlanSourceCheckStatement に変換する */
function buildTopicStatements(target: SourceCheckTarget): PlanSourceCheckStatement[] {
  const { docId, doc } = target;
  const title = doc.title ?? "";
  const hashBody = extractPlainTextFromDoc(doc);
  // 新形式（wikiMeta.topicMarkdown あり）は資料 id を直接引用するので出典照合が 1 段になる
  // （toClaimSourceId を通さない）。旧形式はメンバー知見 id に "claim:" を付けて 2 段のまま。
  const isSourceFormat = Boolean(doc.wikiMeta?.topicMarkdown);
  const statements = isSourceFormat ? extractSourceTopicStatements(doc) : extractTopicStatements(doc);

  if (statements.length === 0) {
    // 引用を持つブロック（行）が 1 つも無い = 出典の記録が無い（not-recorded）。
    return [
      {
        id: docId,
        docId,
        title,
        body: hashBody,
        hashBody,
        sourceIds: [],
      },
    ];
  }

  return statements.map((st) => ({
    id: `${docId}#${st.blockId}`,
    docId,
    title,
    body: st.text,
    hashBody,
    sourceIds: isSourceFormat ? st.claimIds : st.claimIds.map((claimId) => toClaimSourceId(claimId)),
    statement: st.text,
    statementBlockId: st.blockId,
  }));
}

/**
 * 知見・トピックのドキュメント群を、planSourceCheck にそのまま渡せる
 * PlanSourceCheckStatement[] に変換する。wikiMeta.kind が claim/topic 以外のドキュメントは無視する。
 */
export function buildSourceCheckStatements(targets: SourceCheckTarget[]): PlanSourceCheckStatement[] {
  const out: PlanSourceCheckStatement[] = [];
  for (const target of targets) {
    const kind = target.doc.wikiMeta?.kind;
    if (kind === "claim") {
      out.push(buildClaimStatement(target));
    } else if (kind === "topic") {
      out.push(...buildTopicStatements(target));
    }
    // それ以外の kind（summary/atom/synthesis）は対象外（1-a の対象は claim/topic のみ）
  }
  return out;
}
