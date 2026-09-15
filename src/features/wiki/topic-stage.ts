// 話題（topic）の段 — 知見（claim）を話題ページへ割り当て・本文を書き直す純粋なステージ。
//
// note-app.tsx の複数の取り込み経路（ノート取り込み・チャットのナレッジ化・素材 URL/PDF/Word・
// URL 貼付・設定の「話題を整理」）から同じロジックを呼べるよう、依存を引数で注入する形で
// 切り出している。挙動は元の実装（ingest 実行ループに埋め込まれていたもの）と同一。
//
// 処理の流れ:
//   1. topics が空の知見を name-topics API で 20 件ずつ補う（LLM が Topics 項目を無視した
//      場合の保険）。API 呼び出し自体が失敗したチャンクは "failed" に数える。
//   2. topics が（補完後も）空の知見は "withoutTopic" に数えて割り当てをスキップする。
//   3. resolveTopicsForClaim でタイトル一致 → embedding 類似度の順に既存話題へ解決し、
//      一致すれば追記・マージ、無ければ新規話題ページを作る。
//   4. compose-topic の本文生成に失敗した match は "failed" に数え、その match だけ
//      スキップする（他の match・他の claim には影響しない）。

import type { GraphiumDocument } from "../../lib/document-types";
import type { EditActivityType } from "../document-provenance/types";
import {
  resolveTopicsForClaim,
  linkClaimAndTopic,
  composeTopicBody,
  buildTopicDocument,
  rebuildTopicDocument,
  nameTopicsForClaims,
  extractBodyPreview,
  type ExistingTopicRef,
  type TopicComposeClaim,
  type NoteIndex,
} from "./wiki-service";

/** 話題の段に渡す知見（claim）1 件分の入力 */
export type TopicStageClaimInput = {
  id: string;
  title: string;
  /** 本文プレビュー（extractBodyPreview 程度の長さを想定） */
  body: string;
  /** ingester が出した話題名（空配列 = 未タグ付け）。関数内で書き換わる（呼び出し側に見せる必要はない） */
  topics: string[];
  model?: string;
};

/** 話題の段の実行結果（トースト表示用の件数） */
export type TopicStageResult = {
  /** 新規作成した話題ページ数 */
  created: number;
  /** 追記・本文更新した話題ページ数 */
  updated: number;
  /** compose 失敗・name-topics 呼び出し失敗などで処理できなかった件数 */
  failed: number;
  /** 話題を割り当てられなかった知見の件数（補完後も topics が空、または解決 0 件） */
  withoutTopic: number;
};

/** name-topics 呼び出し 1 回あたりの最大件数 */
const NAME_TOPICS_CHUNK_SIZE = 20;

export type TopicStageDeps = {
  loadDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  getCachedDoc: (noteId: string) => GraphiumDocument | null | undefined;
  handleSaveWikiFile: (
    wikiId: string,
    doc: GraphiumDocument,
    options?: { activityType?: EditActivityType; agentLabel?: string; sources?: string[] },
  ) => Promise<boolean | void>;
  handleCreateWikiFile: (
    doc: GraphiumDocument,
    options?: { activityType?: EditActivityType; agentLabel?: string; sources?: string[] },
  ) => Promise<string>;
  /** 既存の話題ページ一覧（id・title のみ）。関数内で新規作成分を追記していく */
  existingTopicRefs: ExistingTopicRef[];
  noteIndex?: NoteIndex;
  locale: string;
  /**
   * 話題ページを保存・作成した直後に呼ばれる（embedWikiSections / wikiLog 等の副作用用）。
   * triggerClaimId は今回の保存を引き起こした claim（ループ中の claimInfo.id）、
   * memberClaimIds は保存後の話題ページのメンバー全体。
   */
  onTopicSaved?: (
    topicId: string,
    doc: GraphiumDocument,
    triggerClaimId: string,
    memberClaimIds: string[],
    mode: "create" | "update",
  ) => void;
  /** 警告ログ（console.warn 相当）。テストではモックする */
  log?: (...args: unknown[]) => void;
};

/**
 * 話題の段を実行する。claims は取り込み等で今回保存し終えた知見（claim）の一覧
 * （topics が空でも渡してよい — 冒頭で name-topics による補完を試みる）。
 */
export async function runTopicStage(
  claims: TopicStageClaimInput[],
  deps: TopicStageDeps,
): Promise<TopicStageResult> {
  const result: TopicStageResult = { created: 0, updated: 0, failed: 0, withoutTopic: 0 };
  if (claims.length === 0) return result;

  const log = deps.log ?? (() => {});

  // 1. topics が空の知見を name-topics で補完する（LLM が Topics 項目を無視した場合の保険）。
  const emptyTopicClaims = claims.filter((c) => c.topics.length === 0);
  const nameTopicsFailedIds = new Set<string>();
  if (emptyTopicClaims.length > 0) {
    const existingTopicTitles = deps.existingTopicRefs.map((t) => t.title);
    for (let i = 0; i < emptyTopicClaims.length; i += NAME_TOPICS_CHUNK_SIZE) {
      const chunk = emptyTopicClaims.slice(i, i + NAME_TOPICS_CHUNK_SIZE);
      try {
        const named = await nameTopicsForClaims(
          chunk.map((c) => ({ id: c.id, title: c.title, body: c.body })),
          existingTopicTitles,
          deps.locale,
          chunk[0]?.model,
        );
        for (const c of chunk) {
          const topics = named[c.id];
          if (topics && topics.length > 0) c.topics = topics;
        }
      } catch (err) {
        log("話題名の補完(name-topics)に失敗:", err);
        for (const c of chunk) nameTopicsFailedIds.add(c.id);
      }
    }
  }

  // 2〜3. 割り当て（既存の ingest ループと同じロジック）
  const existingTopicRefs = [...deps.existingTopicRefs];

  for (const claimInfo of claims) {
    if (claimInfo.topics.length === 0) {
      if (nameTopicsFailedIds.has(claimInfo.id)) {
        result.failed++;
      } else {
        result.withoutTopic++;
      }
      continue;
    }

    const claimDoc =
      deps.getCachedDoc(`wiki:${claimInfo.id}`) ?? (await deps.loadDoc(`wiki:${claimInfo.id}`));
    if (!claimDoc?.wikiMeta) {
      log("話題割り当てをスキップ: claim ドキュメントが見つからない", claimInfo.id);
      result.withoutTopic++;
      continue;
    }

    const matches = await resolveTopicsForClaim(claimInfo.topics, existingTopicRefs);
    if (matches.length === 0) {
      result.withoutTopic++;
      continue;
    }

    // claim ⇔ topic の双方向リンクは linkClaimAndTopic の戻り値経由でのみ更新する（入口 1 本）。
    let currentClaimMeta = claimDoc.wikiMeta;
    let matchedAnyTopic = false;

    for (const match of matches) {
      try {
        let topicId: string;
        let topicDoc: GraphiumDocument | null = null;

        if (match.status === "matched") {
          topicId = match.topicId;
          topicDoc =
            deps.getCachedDoc(`wiki:${topicId}`) ?? (await deps.loadDoc(`wiki:${topicId}`)) ?? null;
          if (!topicDoc?.wikiMeta || topicDoc.wikiMeta.kind !== "topic") continue;

          const linked = linkClaimAndTopic(currentClaimMeta, claimInfo.id, topicDoc.wikiMeta, topicId);
          if (linked.topicMeta !== topicDoc.wikiMeta) {
            const nextMemberIds = linked.topicMeta.derivedFromClaims ?? [];
            const memberClaims: TopicComposeClaim[] = [];
            for (const cId of nextMemberIds) {
              if (cId === claimInfo.id) {
                memberClaims.push({ id: cId, title: claimInfo.title, body: claimInfo.body });
                continue;
              }
              const cDoc = deps.getCachedDoc(`wiki:${cId}`) ?? (await deps.loadDoc(`wiki:${cId}`));
              if (cDoc) memberClaims.push({ id: cId, title: cDoc.title, body: extractBodyPreview(cDoc, 2000) });
            }
            const body = await composeTopicBody(topicDoc.title, deps.locale, memberClaims, claimInfo.model);
            if (!body) {
              // compose 失敗: topic 側の derivedFromClaims 更新を保存できないので、
              // この match は claim 側もリンクせずスキップする（非対称なリンクを避ける）。
              result.failed++;
              continue;
            }
            const rewritten = rebuildTopicDocument(
              topicDoc,
              body,
              memberClaims,
              claimInfo.model ?? null,
              deps.noteIndex,
            );
            await deps.handleSaveWikiFile(topicId, rewritten, {
              activityType: "wiki_cross_update",
              sources: nextMemberIds,
            });
            deps.onTopicSaved?.(topicId, rewritten, claimInfo.id, nextMemberIds, "update");
            result.updated++;
          }
          currentClaimMeta = linked.claimMeta;
          matchedAnyTopic = true;
        } else {
          // 新規話題: メンバー 1 件（今回の claim）で本文を作ってから作成する。
          const memberClaims: TopicComposeClaim[] = [{ id: claimInfo.id, title: claimInfo.title, body: claimInfo.body }];
          const body = await composeTopicBody(match.title, deps.locale, memberClaims, claimInfo.model);
          if (!body) {
            // 本文が作れなかった話題は作成しない（次の呼び出しで同じ名前が出れば再挑戦になる）
            result.failed++;
            continue;
          }
          const newTopicDoc = buildTopicDocument(
            match.title,
            body,
            memberClaims,
            claimInfo.model ?? null,
            deps.locale,
            deps.noteIndex,
          );
          topicId = await deps.handleCreateWikiFile(newTopicDoc, {
            activityType: "wiki_ingest",
            sources: [claimInfo.id],
          });
          deps.onTopicSaved?.(topicId, newTopicDoc, claimInfo.id, [claimInfo.id], "create");
          existingTopicRefs.push({ id: topicId, title: match.title });
          result.created++;
          topicDoc = deps.getCachedDoc(`wiki:${topicId}`) ?? newTopicDoc;

          // 新規 topic は derivedFromClaims: [claimInfo.id] を持った状態で既に作成済みなので、
          // ここでは claim 側の topicIds だけ linkClaimAndTopic で確定させる（冪等）。
          if (topicDoc?.wikiMeta) {
            const linked = linkClaimAndTopic(currentClaimMeta, claimInfo.id, topicDoc.wikiMeta, topicId);
            currentClaimMeta = linked.claimMeta;
          }
          matchedAnyTopic = true;
        }
      } catch (err) {
        result.failed++;
        log("話題割り当てに失敗:", claimInfo.id, match, err);
      }
    }

    if (currentClaimMeta !== claimDoc.wikiMeta) {
      await deps.handleSaveWikiFile(claimInfo.id, { ...claimDoc, wikiMeta: currentClaimMeta });
    }
    if (!matchedAnyTopic) {
      result.withoutTopic++;
    }
  }

  return result;
}
