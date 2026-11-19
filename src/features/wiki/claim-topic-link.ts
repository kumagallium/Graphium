// 知見とトピックを結ぶ段。資料 1 本につき AI を 1 回呼び、その資料の知見それぞれに、
// 同じ資料から作られたトピックを 0〜3 件選ばせて、知見の wikiMeta.topicIds に書く。
//
// - 書くのは topicIds だけ。derivedFromClaims は旧形式の「本文の材料」の意味を持つので触らない
// - topicIds がすでにある知見は上書きしない（移行前からの結びつきを壊さない）
// - 判定の失敗で取り込みを失敗にしない。この関数は例外を投げず、結果の件数で返す
// - 本文は変わらないので、版（リビジョン）は刻まない

import type { GraphiumDocument } from "../../lib/document-types";
import { isAbortError } from "../../lib/abort-error";
import {
  CLAIM_LINK_MAX_CLAIMS,
  CLAIM_LINK_MAX_TOPICS,
  MAX_TOPICS_PER_CLAIM,
  type ClaimLinkClaimRef,
  type ClaimLinkTopicRef,
  type ClaimTopicLinkAnswer,
} from "../../server/services/wiki-claim-topic-linker";
import { cyrb53 } from "./asterism-knowledge";
import { extractTopicOneLiner } from "./wiki-service";

/** 候補を選ぶための最小の情報（一覧の写し。最終的な確認は実物のドキュメントで行う） */
export type ClaimTopicLinkEntry = {
  id: string;
  kind?: string;
  derivedFromNotes?: string[];
  topicIds?: string[];
};

export type ClaimTopicLinkDeps = {
  /** 表に出ているページの一覧（ゴミ箱・アーカイブは除いて渡す） */
  listEntries: () => ClaimTopicLinkEntry[];
  loadDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  getCachedDoc: (noteId: string) => GraphiumDocument | null | undefined;
  handleSaveWikiFile: (wikiId: string, doc: GraphiumDocument) => Promise<boolean | void>;
  /** AI の判定。id は渡した集合の中から返す */
  judge: (
    claims: ClaimLinkClaimRef[],
    topics: ClaimLinkTopicRef[],
    signal?: AbortSignal,
  ) => Promise<ClaimTopicLinkAnswer>;
  /** 今回の実行で作成・改訂したトピック（一覧の写しへの反映を待たずに候補へ足す） */
  extraTopicIds?: string[];
  signal?: AbortSignal;
  log?: (...args: unknown[]) => void;
  /** 保存が他の保存と重なったときの待ち時間の基準（テストで短くするための引数） */
  saveRetryDelayMs?: number;
};

export type ClaimTopicLinkResult = {
  sourceId: string;
  /** AI を呼んだ回数（0 か 1） */
  calls: number;
  /** AI に渡した知見の数 */
  claimsJudged: number;
  /** AI に渡した知見の id */
  judgedClaimIds: string[];
  /** topicIds を書いた知見の数 */
  linkedClaims: number;
  /** topicIds を書いた知見の id */
  linkedClaimIds: string[];
  /** 書いた結びつきの総数 */
  links: number;
  /** 検査で捨てた答えの数（AI の答えの検査 + 保存直前の検査） */
  rejected: number;
  /** 判定のあいだに topicIds が付いたので書かなかった知見の数 */
  alreadyLinked: number;
  /** 保存できなかった知見の数 */
  saveFailed: number;
  /** 利用者が止めたか */
  aborted: boolean;
  /** 判定の失敗の理由（止めたときは入らない） */
  failureError?: unknown;
};

const SAVE_RETRIES = 5;
const DEFAULT_SAVE_RETRY_DELAY_MS = 250;

/**
 * 保存する。handleSaveWikiFile は他の保存の最中だと書かずに false を返すので、少し待ってやり直す。
 * 待つあいだに利用者が編集しても古い版で上書きしないよう、書く中身は試すたびに build で作り直す。
 * build が null を返したら書く必要が無くなったので "skipped"。最後まで書けなければ "failed"。
 */
export async function saveWikiWithRetry(
  save: (wikiId: string, doc: GraphiumDocument) => Promise<boolean | void>,
  wikiId: string,
  build: () => Promise<GraphiumDocument | null> | GraphiumDocument | null,
  delayMs: number = DEFAULT_SAVE_RETRY_DELAY_MS,
): Promise<"saved" | "skipped" | "failed"> {
  for (let attempt = 0; attempt <= SAVE_RETRIES; attempt++) {
    const doc = await build();
    if (!doc) return "skipped";
    if ((await save(wikiId, doc)) !== false) return "saved";
    if (attempt < SAVE_RETRIES) await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
  }
  return "failed";
}

/** 資料から結ぶ候補を選ぶ（topicIds が空の知見と、同じ資料のトピック）。AI は呼ばない */
export function selectClaimTopicLinkCandidates(
  sourceId: string,
  entries: ClaimTopicLinkEntry[],
): { claimIds: string[]; topicIds: string[] } {
  const claimIds: string[] = [];
  const topicIds: string[] = [];
  for (const entry of entries) {
    if (!entry.derivedFromNotes?.includes(sourceId)) continue;
    if (entry.kind === "claim" && (entry.topicIds?.length ?? 0) === 0) claimIds.push(entry.id);
    else if (entry.kind === "topic") topicIds.push(entry.id);
  }
  return { claimIds, topicIds };
}

/** 資料 1 本の知見をトピックに結ぶ。例外を投げない */
export async function linkClaimsToTopicsForSource(
  sourceId: string,
  deps: ClaimTopicLinkDeps,
): Promise<ClaimTopicLinkResult> {
  const result: ClaimTopicLinkResult = {
    sourceId,
    calls: 0,
    claimsJudged: 0,
    judgedClaimIds: [],
    linkedClaims: 0,
    linkedClaimIds: [],
    links: 0,
    rejected: 0,
    alreadyLinked: 0,
    saveFailed: 0,
    aborted: false,
  };
  const log = deps.log ?? (() => {});
  const docOf = async (id: string) => deps.getCachedDoc(`wiki:${id}`) ?? (await deps.loadDoc(`wiki:${id}`));
  const fromSource = (doc: GraphiumDocument | null | undefined) =>
    doc?.wikiMeta?.derivedFromNotes?.includes(sourceId) === true;
  const isClaimOfSource = (doc: GraphiumDocument | null | undefined) =>
    doc?.wikiMeta?.kind === "claim" && fromSource(doc);
  const isSourceTopic = (doc: GraphiumDocument | null | undefined) =>
    doc?.wikiMeta?.kind === "topic" && fromSource(doc);

  try {
    if (deps.signal?.aborted) return { ...result, aborted: true };
    const candidates = selectClaimTopicLinkCandidates(sourceId, deps.listEntries());
    const topicCandidateIds = [...new Set([...candidates.topicIds, ...(deps.extraTopicIds ?? [])])];
    if (candidates.claimIds.length === 0 || topicCandidateIds.length === 0) return result;

    // 一覧は写しなので、実物のドキュメントで確かめてから AI に渡す
    const claims: ClaimLinkClaimRef[] = [];
    for (const id of candidates.claimIds) {
      const doc = await docOf(id);
      if (!isClaimOfSource(doc) || (doc?.wikiMeta?.topicIds?.length ?? 0) > 0 || !doc?.title) continue;
      claims.push({ id, title: doc.title });
    }
    const topics: ClaimLinkTopicRef[] = [];
    for (const id of topicCandidateIds) {
      const doc = await docOf(id);
      if (!isSourceTopic(doc) || !doc?.title) continue;
      const oneLiner = extractTopicOneLiner(doc);
      topics.push({ id, title: doc.title, ...(oneLiner ? { oneLiner } : {}) });
    }
    if (claims.length === 0 || topics.length === 0) return result;

    if (claims.length > CLAIM_LINK_MAX_CLAIMS || topics.length > CLAIM_LINK_MAX_TOPICS) {
      log("知見とトピックの判定: 上限を超えた分は今回は結ばない", sourceId, claims.length, topics.length);
    }
    const judgedClaims = claims.slice(0, CLAIM_LINK_MAX_CLAIMS);
    const judgedTopics = topics.slice(0, CLAIM_LINK_MAX_TOPICS);

    if (deps.signal?.aborted) return { ...result, aborted: true };
    result.calls = 1;
    result.claimsJudged = judgedClaims.length;
    result.judgedClaimIds = judgedClaims.map((c) => c.id);
    const answer = await deps.judge(judgedClaims, judgedTopics, deps.signal);
    result.rejected += answer.rejected;

    const claimIdSet = new Set(judgedClaims.map((c) => c.id));
    const topicIdSet = new Set(judgedTopics.map((t) => t.id));
    for (const [claimId, picked] of Object.entries(answer.links)) {
      if (deps.signal?.aborted) return { ...result, aborted: true };
      if (!claimIdSet.has(claimId)) {
        result.rejected++;
        continue;
      }
      // AI の答えを機械で検査する: 渡した集合にある・同じ資料である・上限以内
      const unique = [...new Set(picked)];
      if (unique.length > MAX_TOPICS_PER_CLAIM) {
        result.rejected++;
        continue;
      }
      const topicIds: string[] = [];
      for (const topicId of unique) {
        if (topicIdSet.has(topicId) && isSourceTopic(await docOf(topicId))) topicIds.push(topicId);
        else result.rejected++;
      }
      if (topicIds.length === 0) continue;

      // 判定のあいだに変わっていないか、書く直前に毎回実物で確かめる
      let skippedAs: "rejected" | "alreadyLinked" | undefined;
      try {
        const outcome = await saveWikiWithRetry(
          deps.handleSaveWikiFile,
          claimId,
          async () => {
            const claimDoc = await docOf(claimId);
            if (!isClaimOfSource(claimDoc) || !claimDoc?.wikiMeta) {
              skippedAs = "rejected";
              return null;
            }
            if ((claimDoc.wikiMeta.topicIds?.length ?? 0) > 0) {
              skippedAs = "alreadyLinked";
              return null;
            }
            return { ...claimDoc, wikiMeta: { ...claimDoc.wikiMeta, topicIds } };
          },
          deps.saveRetryDelayMs,
        );
        if (outcome === "saved") {
          result.linkedClaims++;
          result.linkedClaimIds.push(claimId);
          result.links += topicIds.length;
        } else if (outcome === "skipped") {
          if (skippedAs === "alreadyLinked") result.alreadyLinked++;
          else result.rejected++;
        } else {
          result.saveFailed++;
          log("知見の topicIds を保存できなかった:", claimId);
        }
      } catch (err) {
        result.saveFailed++;
        log("知見の topicIds の保存に失敗:", claimId, err);
      }
    }
    return result;
  } catch (err) {
    if (isAbortError(err) || deps.signal?.aborted) return { ...result, aborted: true };
    log("知見とトピックの判定に失敗:", sourceId, err);
    return { ...result, failureError: err };
  }
}

// ── 既存の知見を結ぶ一括処理（設定の手入れから人が起動する）──
// 判定し終えた資料を控えに残すので、止めても、アプリを閉じても、続きから再開できる。
// 当てはまるトピックが無かった知見は topicIds が空のままなので、控えが無いと毎回 AI に渡し直してしまう。

/** 一括処理の控えの保存先（アプリ付随データのキーと Google Drive のファイル名） */
export const CLAIM_TOPIC_LINK_CHECKPOINT_KEY = "claim-topic-link-progress";
export const CLAIM_TOPIC_LINK_CHECKPOINT_FILE = ".graphium-claim-topic-link-progress.json";

/** 失敗がこの回数続いたら止める（設定の誤りなどで AI の呼び出しを無駄にしない） */
export const CLAIM_TOPIC_LINK_MAX_CONSECUTIVE_FAILURES = 3;

export type ClaimTopicLinkCheckpoint = {
  version: 1;
  /** 資料 id → 判定したときのトピックの指紋と、判定しても結ばれなかった知見 */
  judged: Record<string, { topics: string; claims: string[] }>;
};

export function emptyClaimTopicLinkCheckpoint(): ClaimTopicLinkCheckpoint {
  return { version: 1, judged: {} };
}

/** 保存された控えを読む。形が違えば空の控えとして扱う（もう一度判定するだけで害は無い） */
export function parseClaimTopicLinkCheckpoint(raw: unknown): ClaimTopicLinkCheckpoint {
  const judged = (raw as { version?: unknown; judged?: unknown } | null)?.judged;
  if ((raw as { version?: unknown } | null)?.version !== 1 || !judged || typeof judged !== "object") {
    return emptyClaimTopicLinkCheckpoint();
  }
  const out: ClaimTopicLinkCheckpoint = emptyClaimTopicLinkCheckpoint();
  for (const [sourceId, value] of Object.entries(judged)) {
    const rec = value as { topics?: unknown; claims?: unknown } | null;
    if (typeof rec?.topics !== "string" || !Array.isArray(rec.claims)) continue;
    out.judged[sourceId] = { topics: rec.topics, claims: rec.claims.filter((c): c is string => typeof c === "string") };
  }
  return out;
}

function topicsFingerprint(topicIds: string[]): string {
  return cyrb53([...topicIds].sort().join("\n")).toString(16);
}

export type ClaimTopicLinkBackfillPlan = {
  /** これから判定する資料（AI を 1 本につき 1 回呼ぶ） */
  sourceIds: string[];
  /** AI の呼び出し回数の上限（複数の資料にまたがる知見が先に結ばれると減ることがある） */
  calls: number;
  /** 対象の知見の数（重複なし） */
  claims: number;
  /** 判定済みで、今回は飛ばす資料の数 */
  alreadyJudged: number;
};

/**
 * 一括処理の計画を立てる（AI は呼ばない）。対象は、topicIds が空の知見があり、同じ資料にトピックがある資料。
 * 判定済みの資料は、トピックが変わったか、まだ判定していない知見が増えたときだけ対象に戻す。
 */
export function planClaimTopicLinkBackfill(
  entries: ClaimTopicLinkEntry[],
  checkpoint: ClaimTopicLinkCheckpoint,
): ClaimTopicLinkBackfillPlan {
  const claimsBySource = new Map<string, string[]>();
  const topicsBySource = new Map<string, string[]>();
  for (const entry of entries) {
    const isOpenClaim = entry.kind === "claim" && (entry.topicIds?.length ?? 0) === 0;
    if (!isOpenClaim && entry.kind !== "topic") continue;
    const target = isOpenClaim ? claimsBySource : topicsBySource;
    for (const sourceId of new Set(entry.derivedFromNotes ?? [])) {
      const list = target.get(sourceId);
      if (list) list.push(entry.id);
      else target.set(sourceId, [entry.id]);
    }
  }

  const sourceIds: string[] = [];
  const claimIds = new Set<string>();
  let alreadyJudged = 0;
  for (const [sourceId, claims] of claimsBySource) {
    const topics = topicsBySource.get(sourceId);
    if (!topics) continue;
    const record = checkpoint.judged[sourceId];
    if (record && record.topics === topicsFingerprint(topics)) {
      const judged = new Set(record.claims);
      if (claims.every((id) => judged.has(id))) {
        alreadyJudged++;
        continue;
      }
    }
    sourceIds.push(sourceId);
    for (const id of claims) claimIds.add(id);
  }
  sourceIds.sort();
  return { sourceIds, calls: sourceIds.length, claims: claimIds.size, alreadyJudged };
}

export type ClaimTopicLinkBackfillProgress = {
  done: number;
  total: number;
  linkedClaims: number;
};

export type ClaimTopicLinkBackfillResult = ClaimTopicLinkBackfillProgress & {
  /** 実際に AI を呼んだ回数 */
  calls: number;
  links: number;
  rejected: number;
  /** 判定か保存に失敗した資料の数（控えに残さないので、次の実行でやり直す） */
  failedSources: number;
  /** 利用者が止めたか */
  aborted: boolean;
  /** 失敗が続いたので途中で止めたか */
  stoppedByFailures: boolean;
  /** 失敗の理由（最初の 1 件） */
  failureError?: unknown;
};

export type ClaimTopicLinkBackfillDeps = Omit<ClaimTopicLinkDeps, "extraTopicIds"> & {
  checkpoint: ClaimTopicLinkCheckpoint;
  saveCheckpoint: (checkpoint: ClaimTopicLinkCheckpoint) => Promise<void>;
  onProgress?: (progress: ClaimTopicLinkBackfillProgress) => void;
};

/** 計画した資料を 1 本ずつ結ぶ。1 本終わるごとに控えを保存する。例外を投げない */
export async function runClaimTopicLinkBackfill(
  plan: ClaimTopicLinkBackfillPlan,
  deps: ClaimTopicLinkBackfillDeps,
): Promise<ClaimTopicLinkBackfillResult> {
  const log = deps.log ?? (() => {});
  const result: ClaimTopicLinkBackfillResult = {
    done: 0,
    total: plan.sourceIds.length,
    linkedClaims: 0,
    calls: 0,
    links: 0,
    rejected: 0,
    failedSources: 0,
    aborted: false,
    stoppedByFailures: false,
  };
  const checkpoint: ClaimTopicLinkCheckpoint = { version: 1, judged: { ...deps.checkpoint.judged } };
  let consecutiveFailures = 0;

  for (const sourceId of plan.sourceIds) {
    if (deps.signal?.aborted) {
      result.aborted = true;
      break;
    }
    const linked = await linkClaimsToTopicsForSource(sourceId, deps);
    result.calls += linked.calls;
    result.linkedClaims += linked.linkedClaims;
    result.links += linked.links;
    result.rejected += linked.rejected;
    if (linked.aborted) {
      result.aborted = true;
      break;
    }

    if (linked.failureError !== undefined || linked.saveFailed > 0) {
      result.failedSources++;
      if (result.failureError === undefined) result.failureError = linked.failureError;
      consecutiveFailures++;
      if (consecutiveFailures >= CLAIM_TOPIC_LINK_MAX_CONSECUTIVE_FAILURES) {
        result.stoppedByFailures = true;
        break;
      }
    } else {
      consecutiveFailures = 0;
      const linkedIds = new Set(linked.linkedClaimIds);
      const { topicIds } = selectClaimTopicLinkCandidates(sourceId, deps.listEntries());
      checkpoint.judged[sourceId] = {
        topics: topicsFingerprint(topicIds),
        claims: linked.judgedClaimIds.filter((id) => !linkedIds.has(id)),
      };
      try {
        await deps.saveCheckpoint(checkpoint);
      } catch (err) {
        // 控えが書けなくても結んだ分は残る（再開のときに同じ資料をもう一度判定するだけ）
        log("知見とトピックの一括処理の控えを保存できなかった:", err);
      }
    }
    result.done++;
    deps.onProgress?.({ done: result.done, total: result.total, linkedClaims: result.linkedClaims });
  }
  return result;
}
