// 出典照合（Source check, v1.1） — 実行本体。
//
// plan（出典 → 文 ID 一覧のグルーピング + knownMissing）を処理する（並列数の定数は
// 作らない — 不変条件 2）。knownMissing は LLM を呼ばずに source-missing で先に記録する。
// 残りは出典ごとに順番に処理する: 取り出せない出典は LLM を呼ばずに source-missing、
// 取り出せたら API を呼ぶ。**ドキュメントに属する全ての文の処理が終わったドキュメントだけ**
// 集約して呼び出し側に返す（中断時に一部の文しか見ていないドキュメントは書かない —
// トピックで一部の要点だけ処理済みの場合を含む）。signal は出典の境目でだけチェックする。

import type { SourceCheckEntry, SourceCheckProfile, SourceCheckSourceKind, SourceCheckVerdict } from "../../lib/document-types";
import {
  callCheckSourcesApi,
  SourceCheckDegradedError,
  type CheckSourcesApiClaim,
  type CheckSourcesApiResult,
  type CheckSourcesApiSource,
} from "./api";
import { aggregateDocumentVerdict, aggregateVerdict } from "./aggregate";
import { computeClaimHash } from "./claim-hash";
import { findBlockIdForQuote, resolveQuoteLocation } from "./quote-match";
import { missingResponseRationale, missingReasonRationale } from "./rationale-text";
import { resolveSourceText, type ResolveSourceTextDeps } from "./resolve-source-text";
import { parseExternalSource } from "../network-graph/external-source";
import type { PlanSourceCheckStatement, SourceCheckPlan } from "./plan";
import { wikiLog } from "../wiki/wiki-log";

/** wiki-log への記録。テストでモックできるよう注入式（既定は wikiLog.append） */
export type SourceCheckLogger = (
  wikiIds: string[],
  summary: string,
  detail?: Record<string, unknown>,
) => Promise<void>;

const defaultLogger: SourceCheckLogger = (wikiIds, summary, detail) =>
  wikiLog.append("source-check", wikiIds, summary, detail);

export type RunSourceCheckParams = {
  /** plan に登場する全文 ID → 文情報。plan.groups と plan.knownMissing の両方をカバーすること */
  statementsById: Map<string, PlanSourceCheckStatement>;
  deps: ResolveSourceTextDeps;
  language: string;
  signal?: AbortSignal;
  onProgress?: (info: { sourceId: string; index: number; total: number }) => void;
  /** テスト用差し替え。既定は callCheckSourcesApi（実 API 呼び出し） */
  callApi?: (
    source: CheckSourcesApiSource,
    claims: CheckSourcesApiClaim[],
    language: string,
  ) => Promise<CheckSourcesApiResult>;
  /** テスト用差し替え。既定は new Date().toISOString() */
  now?: () => string;
  /** テスト用差し替え。既定は wikiLog.append を呼ぶ */
  logger?: SourceCheckLogger;
};

export type RunSourceCheckResult = {
  /** docId → 書き込むべき SourceCheckProfile（ドキュメント内の全文を処理し終えたものだけ） */
  profiles: Map<string, SourceCheckProfile>;
  /** signal による中断、または API の degrade で run 全体を打ち切ったか */
  interrupted: boolean;
};

/** "claim:" などのプレフィックスから大まかな出典種別を推定する（knownMissing 用、実解決はしない） */
function guessSourceKind(sourceId: string): SourceCheckSourceKind {
  const parsed = parseExternalSource(sourceId);
  if (!parsed) return "note";
  if (parsed.kind === "shared" || parsed.kind === "data" || parsed.kind === "image") return "unknown";
  return parsed.kind;
}

/**
 * 出典照合を実行する。
 *
 * - knownMissing の文は resolveSourceText / API を呼ばずに、先に source-missing で記録する。
 * - それ以外は出典ごとに resolveSourceText → （取れたら）callApi の順で直列処理する。
 * - API が degrade（SourceCheckDegradedError）したら、誤った verdict を書き込まないよう
 *   その時点で run 全体を中断する（world-grounding が checkedAt のみで degrade するのと違い、
 *   SourceCheckVerdict の語彙に「判定できなかった」を表す値が無いため、部分結果を書かず
 *   run 自体を止める設計にした）。
 * - 中断時、まだドキュメント内の全文を処理し終えていないドキュメントは profiles に含めない。
 */
export async function runSourceCheck(
  plan: SourceCheckPlan,
  params: RunSourceCheckParams,
): Promise<RunSourceCheckResult> {
  const { statementsById, deps, language, signal, onProgress } = params;
  const callApi = params.callApi ?? callCheckSourcesApi;
  const now = params.now ?? (() => new Date().toISOString());
  const logger = params.logger ?? defaultLogger;

  const entriesByStatement = new Map<string, SourceCheckEntry[]>();
  const doneStatements = new Set<string>();

  // knownMissing（1-c）: LLM を呼ばずに先に記録する。
  for (const km of plan.knownMissing) {
    const rationale = missingReasonRationale(km.reason, language);
    if (km.sourceIds.length === 0) {
      // 出典の記録自体が無い（"not-recorded"）→ 対象ドキュメントを指す 1 エントリのみ
      pushEntry(entriesByStatement, km.statementId, {
        sourceId: km.docId,
        sourceKind: "unknown",
        verdict: "source-missing",
        rationale,
        missingReason: km.reason,
      });
    } else {
      // 出典自体は記録されているが解決を試みない（"ai-answer" 等）→ 出典ごとに記録
      for (const sourceId of km.sourceIds) {
        pushEntry(entriesByStatement, km.statementId, {
          sourceId,
          sourceKind: guessSourceKind(sourceId),
          verdict: "source-missing",
          rationale,
          missingReason: km.reason,
        });
      }
    }
    doneStatements.add(km.statementId);
  }

  // statementId → その文が依拠する全出典 ID（「全出典処理済み」判定用）
  const expectedSourcesByStatement = new Map<string, Set<string>>();
  for (const group of plan.groups) {
    for (const statementId of group.statementIds) {
      const set = expectedSourcesByStatement.get(statementId);
      if (set) set.add(group.sourceId);
      else expectedSourcesByStatement.set(statementId, new Set([group.sourceId]));
    }
  }

  const processedSourceIds = new Set<string>();
  const modelBySource = new Map<string, string>();
  let interrupted = false;

  for (let i = 0; i < plan.groups.length; i++) {
    if (signal?.aborted) {
      interrupted = true;
      break;
    }
    const group = plan.groups[i];
    onProgress?.({ sourceId: group.sourceId, index: i, total: plan.groups.length });

    const resolved = await resolveSourceText(group.sourceId, deps);

    if (!resolved.ok) {
      const rationale = missingReasonRationale(resolved.reason, language);
      for (const statementId of group.statementIds) {
        pushEntry(entriesByStatement, statementId, {
          sourceId: group.sourceId,
          sourceKind: resolved.kind,
          verdict: "source-missing",
          rationale,
          missingReason: resolved.reason,
        });
      }
      processedSourceIds.add(group.sourceId);
      continue;
    }

    const statementsForApi = group.statementIds
      .map((id) => statementsById.get(id))
      .filter((s): s is PlanSourceCheckStatement => !!s)
      .map((s) => ({ id: s.id, title: s.title, body: s.body }));

    if (statementsForApi.length === 0) {
      // このグループの文はどれも statementsById に無い（呼び出し側の対象外）。
      // 出典としては処理済み扱いにする（対象が無いので LLM を呼ぶ意味が無い）。
      processedSourceIds.add(group.sourceId);
      continue;
    }

    let apiResult: CheckSourcesApiResult;
    try {
      apiResult = await callApi(
        { id: group.sourceId, kind: resolved.kind, title: resolved.title, text: resolved.text },
        statementsForApi,
        language,
      );
    } catch (err) {
      if (err instanceof SourceCheckDegradedError) {
        interrupted = true;
        break;
      }
      // ネットワークエラー等も同様に degrade 扱いで run を中断する（誤った verdict を書かない）。
      interrupted = true;
      break;
    }
    modelBySource.set(group.sourceId, apiResult.model);

    for (const statementId of group.statementIds) {
      const statement = statementsById.get(statementId);
      if (!statement) continue;
      const modelItem = apiResult.results.find((r) => r.claimId === statementId);
      if (!modelItem) {
        pushEntry(entriesByStatement, statementId, {
          sourceId: group.sourceId,
          sourceKind: resolved.kind,
          verdict: "unclear",
          rationale: missingResponseRationale(language),
        });
        continue;
      }
      const blockId = findBlockIdForQuote(resolved.blocks, modelItem.quote);
      // quote の位置（PDF のページ・Word の段落）を、判定に使ったのと同じ原文から機械的に解く。
      // verdict には一切影響しない（位置が解けなくても quoteLocation を付けないだけ）。
      const quoteLocation = resolveQuoteLocation(
        { kind: resolved.kind, text: resolved.text, pageStarts: resolved.pageStarts },
        modelItem.quote,
      );
      pushEntry(entriesByStatement, statementId, {
        sourceId: group.sourceId,
        sourceKind: resolved.kind,
        verdict: modelItem.verdict,
        rationale: modelItem.rationale,
        quote: modelItem.quote,
        blockId,
        sourceTextOrigin: resolved.origin,
        ...(quoteLocation ? { quoteLocation } : {}),
      });
    }
    processedSourceIds.add(group.sourceId);
  }

  for (const [statementId, expected] of expectedSourcesByStatement) {
    if ([...expected].every((sid) => processedSourceIds.has(sid))) {
      doneStatements.add(statementId);
    }
  }

  // ドキュメント単位に文をまとめ、ドキュメント内の全文が完了したものだけ集約する。
  // plan（groups または knownMissing）に実際に登場した文だけを対象にする
  // （statementsById に無関係な文が混入していても無視する）。
  const relevantStatementIds = new Set<string>([
    ...expectedSourcesByStatement.keys(),
    ...plan.knownMissing.map((km) => km.statementId),
  ]);
  const statementIdsByDoc = new Map<string, string[]>();
  for (const id of relevantStatementIds) {
    const statement = statementsById.get(id);
    if (!statement) continue; // ghost（statementsById に無い）は対象外
    const list = statementIdsByDoc.get(statement.docId);
    if (list) list.push(id);
    else statementIdsByDoc.set(statement.docId, [id]);
  }

  const profiles = new Map<string, SourceCheckProfile>();
  const verdictCounts: Partial<Record<string, number>> = {};
  for (const [docId, statementIds] of statementIdsByDoc) {
    const allDone = statementIds.every((id) => doneStatements.has(id));
    if (!allDone) continue;

    const entries: SourceCheckEntry[] = [];
    const statementVerdicts: SourceCheckVerdict[] = [];
    const usedSourceIds = new Set<string>();
    for (const id of statementIds) {
      const statement = statementsById.get(id);
      const stEntries = entriesByStatement.get(id) ?? [];
      const stamped = statement?.statement
        ? stEntries.map((e) => ({ ...e, statement: statement.statement, statementBlockId: statement.statementBlockId }))
        : stEntries;
      entries.push(...stamped);
      statementVerdicts.push(aggregateVerdict(stEntries));
      const expected = expectedSourcesByStatement.get(id);
      if (expected) for (const sid of expected) usedSourceIds.add(sid);
    }

    const verdict = aggregateDocumentVerdict(statementVerdicts);
    const usedModels = [...usedSourceIds].map((sid) => modelBySource.get(sid)).filter((m): m is string => !!m);
    const checkedBy = usedModels.length > 0 ? usedModels[usedModels.length - 1] : "local";
    // ドキュメント全体のタイトル/本文はどの文でも同じ値を持つ（build-statements.ts が揃える）
    const rep = statementsById.get(statementIds[0])!;
    const claimHash = await computeClaimHash(rep.title, rep.hashBody);
    profiles.set(docId, {
      verdict,
      entries,
      checkedAt: now(),
      checkedBy,
      claimHash,
    });
    verdictCounts[verdict] = (verdictCounts[verdict] ?? 0) + 1;
  }

  if (profiles.size > 0 || interrupted) {
    const summaryParts = Object.entries(verdictCounts).map(([v, n]) => `${v}:${n}`);
    const summary =
      summaryParts.length > 0
        ? `${profiles.size} document(s) checked (${summaryParts.join(", ")})${interrupted ? " [interrupted]" : ""}`
        : `source check interrupted before any document completed`;
    await logger([...profiles.keys()], summary, { verdictCounts, interrupted });
  }

  return { profiles, interrupted };
}

function pushEntry(map: Map<string, SourceCheckEntry[]>, statementId: string, entry: SourceCheckEntry): void {
  const list = map.get(statementId);
  if (list) list.push(entry);
  else map.set(statementId, [entry]);
}
