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
  /** topicIds を書いた知見の数 */
  linkedClaims: number;
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
    linkedClaims: 0,
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
