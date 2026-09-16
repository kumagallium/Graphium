// 出典照合（Source check, v1） — 実行本体。
//
// plan（出典 → 知見 ID 一覧のグルーピング）を出典ごとに順番に処理する（並列数の定数は
// 作らない — 不変条件 2）。取り出せない出典は LLM を呼ばずに source-missing、取り出せたら
// API を呼ぶ。**全出典の処理が終わった知見だけ**集約して呼び出し側に返す（中断時に一部の
// 出典しか見ていない知見は書かない）。signal は出典の境目でだけチェックする。

import type { SourceCheckEntry, SourceCheckProfile } from "../../lib/document-types";
import {
  callCheckSourcesApi,
  SourceCheckDegradedError,
  type CheckSourcesApiClaim,
  type CheckSourcesApiResult,
  type CheckSourcesApiSource,
} from "./api";
import { aggregateVerdict } from "./aggregate";
import { computeClaimHash } from "./claim-hash";
import { findBlockIdForQuote } from "./quote-match";
import { missingResponseRationale, missingReasonRationale } from "./rationale-text";
import { resolveSourceText, type ResolveSourceTextDeps } from "./resolve-source-text";
import type { SourceCheckPlan } from "./plan";
import { wikiLog } from "../wiki/wiki-log";

export type RunSourceCheckClaim = {
  id: string;
  title: string;
  /** 知見本文（claimHash 計算・LLM への提示に使う） */
  body: string;
};

/** wiki-log への記録。テストでモックできるよう注入式（既定は wikiLog.append） */
export type SourceCheckLogger = (
  wikiIds: string[],
  summary: string,
  detail?: Record<string, unknown>,
) => Promise<void>;

const defaultLogger: SourceCheckLogger = (wikiIds, summary, detail) =>
  wikiLog.append("source-check", wikiIds, summary, detail);

export type RunSourceCheckParams = {
  claimsById: Map<string, RunSourceCheckClaim>;
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
  /** claimId → 書き込むべき SourceCheckProfile（全出典を処理し終えた知見のみ） */
  profiles: Map<string, SourceCheckProfile>;
  /** signal による中断、または API の degrade で run 全体を打ち切ったか */
  interrupted: boolean;
};

/**
 * 出典照合を実行する。
 *
 * - 出典ごとに resolveSourceText → （取れたら）callApi の順で直列処理する。
 * - API が degrade（SourceCheckDegradedError）したら、誤った verdict を書き込まないよう
 *   その時点で run 全体を中断する（world-grounding が checkedAt のみで degrade するのと違い、
 *   SourceCheckVerdict の語彙に「判定できなかった」を表す値が無いため、部分結果を書かず
 *   run 自体を止める設計にした）。
 * - 中断時、まだ全出典を処理し終えていない知見は profiles に含めない
 *   （「全出典の処理が終わった知見だけ集約して書き込む」という仕様の核）。
 */
export async function runSourceCheck(
  plan: SourceCheckPlan,
  params: RunSourceCheckParams,
): Promise<RunSourceCheckResult> {
  const { claimsById, deps, language, signal, onProgress } = params;
  const callApi = params.callApi ?? callCheckSourcesApi;
  const now = params.now ?? (() => new Date().toISOString());
  const logger = params.logger ?? defaultLogger;

  // claimId → その知見が依拠する全出典 ID（「全出典処理済み」判定用）
  const expectedSourcesByClaim = new Map<string, Set<string>>();
  for (const group of plan.groups) {
    for (const claimId of group.claimIds) {
      const set = expectedSourcesByClaim.get(claimId);
      if (set) set.add(group.sourceId);
      else expectedSourcesByClaim.set(claimId, new Set([group.sourceId]));
    }
  }

  const entriesByClaim = new Map<string, SourceCheckEntry[]>();
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
      for (const claimId of group.claimIds) {
        pushEntry(entriesByClaim, claimId, {
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

    const claimsForApi = group.claimIds
      .map((id) => claimsById.get(id))
      .filter((c): c is RunSourceCheckClaim => !!c)
      .map((c) => ({ id: c.id, title: c.title, body: c.body }));

    if (claimsForApi.length === 0) {
      // このグループの知見はどれも claimsById に無い（呼び出し側の対象外）。
      // 出典としては処理済み扱いにする（対象知見が無いので LLM を呼ぶ意味が無い）。
      processedSourceIds.add(group.sourceId);
      continue;
    }

    let apiResult: CheckSourcesApiResult;
    try {
      apiResult = await callApi(
        { id: group.sourceId, kind: resolved.kind, title: resolved.title, text: resolved.text },
        claimsForApi,
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

    for (const claimId of group.claimIds) {
      const claim = claimsById.get(claimId);
      if (!claim) continue;
      const modelItem = apiResult.results.find((r) => r.claimId === claimId);
      if (!modelItem) {
        pushEntry(entriesByClaim, claimId, {
          sourceId: group.sourceId,
          sourceKind: resolved.kind,
          verdict: "unclear",
          rationale: missingResponseRationale(language),
        });
        continue;
      }
      const blockId = findBlockIdForQuote(resolved.blocks, modelItem.quote);
      pushEntry(entriesByClaim, claimId, {
        sourceId: group.sourceId,
        sourceKind: resolved.kind,
        verdict: modelItem.verdict,
        rationale: modelItem.rationale,
        quote: modelItem.quote,
        blockId,
        sourceTextOrigin: resolved.origin,
      });
    }
    processedSourceIds.add(group.sourceId);
  }

  // 全出典の処理が終わった知見だけ集約する
  const profiles = new Map<string, SourceCheckProfile>();
  const verdictCounts: Partial<Record<string, number>> = {};
  for (const [claimId, expected] of expectedSourcesByClaim) {
    const claim = claimsById.get(claimId);
    if (!claim) continue;
    const allProcessed = [...expected].every((sid) => processedSourceIds.has(sid));
    if (!allProcessed) continue;
    const entries = entriesByClaim.get(claimId) ?? [];
    const verdict = aggregateVerdict(entries);
    const usedModels = [...expected].map((sid) => modelBySource.get(sid)).filter((m): m is string => !!m);
    const checkedBy = usedModels.length > 0 ? usedModels[usedModels.length - 1] : "local";
    const claimHash = await computeClaimHash(claim.title, claim.body);
    profiles.set(claimId, {
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
        ? `${profiles.size} claim(s) checked (${summaryParts.join(", ")})${interrupted ? " [interrupted]" : ""}`
        : `source check interrupted before any claim completed`;
    await logger([...profiles.keys()], summary, { verdictCounts, interrupted });
  }

  return { profiles, interrupted };
}

function pushEntry(map: Map<string, SourceCheckEntry[]>, claimId: string, entry: SourceCheckEntry): void {
  const list = map.get(claimId);
  if (list) list.push(entry);
  else map.set(claimId, [entry]);
}
