// 手入れ画面の一括処理（足りないところを補う・全体をやり直す）に渡す処理の型。
// もとは設定の「ナレッジ管理」タブ（settings/modal.tsx）にあった。2026-11-25 に手入れ画面へ移した。

import type { TopicType, WikiKind } from "../../lib/document-types";

/** 一括再生成の対象を選ぶための、ナレッジのページ 1 件の要約 */
export type UpkeepWikiSummary = {
  id: string;
  title: string;
  kind: WikiKind;
  model?: string;
  /** topic のみ。無ければ未分類（「トピックに種類を付ける」の対象） */
  topicType?: TopicType;
};

/** 知見をトピックに結ぶ一括処理の計画（AI を呼ぶ前に回数を見せる） */
export type ClaimTopicLinkBackfillSummary = { calls: number; claims: number; alreadyJudged: number };
export type ClaimTopicLinkBackfillOutcome = {
  done: number;
  total: number;
  linkedClaims: number;
  calls: number;
  failedSources: number;
  aborted: boolean;
  stoppedByFailures: boolean;
  /** 失敗の理由（画面に出せる文） */
  failureReason?: string;
};
export type ClaimTopicLinkBackfillHandlers = {
  plan: () => Promise<ClaimTopicLinkBackfillSummary>;
  /** AI が未設定などで始められないときは null */
  run: (
    onProgress: (progress: { done: number; total: number; linkedClaims: number }) => void,
    signal: AbortSignal,
  ) => Promise<ClaimTopicLinkBackfillOutcome | null>;
};

/** 資料からトピックを作る（知見はあるのにトピックが無い資料）一括処理の計画 */
export type SourceTopicBackfillSummary = { sources: number; alreadySettled: number };
export type SourceTopicBackfillOutcome = {
  done: number;
  total: number;
  topicsTouched: number;
  created: number;
  noTopic: number;
  unreadable: number;
  failedSources: number;
  aborted: boolean;
  stoppedByFailures: boolean;
  /** 失敗の理由（画面に出せる文） */
  failureReason?: string;
};
export type SourceTopicBackfillProgressView = {
  done: number;
  total: number;
  topicsTouched: number;
  /** いま手を付けている資料の中の進み具合（何本目・題・読んでいる／何枚中何枚書いた） */
  current?: {
    index: number;
    title: string;
    phase: "reading" | "writing" | "linking";
    written: number;
    planned: number;
    windowIndex: number;
    windowTotal: number;
  };
};
export type SourceTopicBackfillHandlers = {
  plan: () => Promise<SourceTopicBackfillSummary>;
  /** AI が未設定などで始められないときは null */
  run: (
    onProgress: (progress: SourceTopicBackfillProgressView) => void,
    signal: AbortSignal,
  ) => Promise<SourceTopicBackfillOutcome | null>;
};

/** 「トピックに種類を付ける」の実行結果 */
export type AssignTopicTypesResult = {
  /** 種類を付けて保存した件数 */
  assigned: number;
  /** 対象（未分類）だった件数 */
  total: number;
  /** AI 呼び出し回数 */
  calls: number;
  /** 失敗の理由（表示用に訳した文。無ければ無し） */
  failureReason?: string;
};

export type RegenerateWikiHandler = (
  wikiId: string,
  /** signal: 進行中の LLM 呼び出しごと中断する（一括再生成のキャンセル用） */
  options?: { model?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; error?: string; aborted?: boolean }>;

export type DiscoveryProgressInfo = {
  iteration: number;
  createdSoFar: number;
  /** クラスタサンプリング: 現在の iter のクラスタ情報 */
  clusterLabel?: string;
  clusterTotal?: number;
  clusterSize?: number;
  clusterMemberTitles?: string[];
  /** 実測カバレッジ: この iter までに視野へ入った母集団件数（和集合） */
  coveredSoFar?: number;
  /** 母集団の総数 */
  populationTotal?: number;
};
export type DiscoveryHandler = (
  onProgress?: (info: DiscoveryProgressInfo) => void,
  /** signal: 進行中の LLM 呼び出しごと中断する（発見のキャンセル用） */
  options?: { theme?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; created: number; iterations: number; reinforced?: number; contradictions?: number; covered?: number; total?: number; error?: string; aborted?: boolean }>;

/**
 * 実行前プラン: 「全 {total} 件を視野に入れるには LLM を {runs} 回呼ぶ」の実測値。
 * LLM は呼ばず計算だけで決まるため、確認ダイアログの表示に使える。null = プラン不能（対象が 2 件未満など）
 */
export type PlanDiscoveryHandler = () => Promise<{ total: number; runs: number } | null>;
