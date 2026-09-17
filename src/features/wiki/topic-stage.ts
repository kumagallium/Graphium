// 話題（topic）の段 — 知見（claim）を話題ページへ割り当て・本文を書き直す純粋なステージ。
//
// note-app.tsx の複数の取り込み経路（ノート取り込み・チャットのナレッジ化・素材 URL/PDF/Word・
// URL 貼付・設定の「話題を整理」）から同じロジックを呼べるよう、依存を引数で注入する形で
// 切り出している。挙動は元の実装（ingest 実行ループに埋め込まれていたもの）と同一。
//
// 処理の流れ（Karpathy の LLM Wiki と同じ方針: LLM が「資料 + index」を見て自分で決める。
// 数値のしきい値は置かない — 唯一の例外は resolveTopicsForClaim が使う embedding 重複判定
// 0.9 で、これは既存の重複判定と共通の定数）:
//   1. topics が空の知見を name-topics で補う（LLM が Topics 項目を無視した場合の保険）。
//      既存話題は「タイトル + 定義の先頭文」の index として渡し、LLM が同じ概念かどうかを
//      自分で判断できるようにする。API 呼び出し自体が失敗した知見は "failed" に数える。
//   2. topics が（補完後も）空の知見は "withoutTopic" に数えて割り当てをスキップする。
//   3. resolveTopicsForClaim でタイトル一致 → embedding 類似度の順に既存話題へ解決し、
//      一致すれば追記・マージ、無ければ新規話題ページを作る。
//   4. compose-topic の本文生成に失敗した match は "failed" に数え、その match だけ
//      スキップする（他の match・他の claim には影響しない）。
//
// 話題どうしの統合（表記ゆれ・粒度違いの近縁話題を 1 つに寄せる）は ingest の隠れた段には
// しない — 設定の「話題を整理」（consolidateExistingTopics）と点検（wiki-linter）の
// redundant 検出に任せる。ingest 時にできるのは、LLM に既存話題の index を見せて
// 「既存に寄せるか新規を作るか」を判断させることだけ。

import type { GraphiumDocument } from "../../lib/document-types";
import type { EditActivityType } from "../document-provenance/types";
import {
  resolveTopicsForClaim,
  linkClaimAndTopic,
  composeTopicBody,
  buildTopicDocument,
  rebuildTopicDocument,
  nameTopicsForClaims,
  consolidateTopics,
  normalizeTopicTitle,
  retargetClaimTopicId,
  extractBodyPreview,
  formatTopicRefForIndex,
  buildSourceTopicDocument,
  rebuildSourceTopicDocument,
  routeTopicsForSource,
  reviseTopicFromSource,
  type ExistingTopicRef,
  type TopicComposeClaim,
  type TopicSourceRef,
  type TopicRouteExistingRef,
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
  /** この実行で新規作成した話題（呼び出し側が並行実行の既存一覧に引き継ぐ） */
  createdTopics: { id: string; title: string }[];
};

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
  const result: TopicStageResult = {
    created: 0,
    updated: 0,
    failed: 0,
    withoutTopic: 0,
    createdTopics: [],
  };
  if (claims.length === 0) return result;

  const log = deps.log ?? (() => {});

  // 1. topics が空の知見を name-topics で補完する（LLM が Topics 項目を無視した場合の保険）。
  // 既存話題は「タイトル + 定義の先頭文」（index）として渡し、表記ゆれだけで別話題に
  // 倒れないよう LLM 自身に既存へ寄せる判断をさせる（Karpathy の index.md と同じ考え方）。
  const emptyTopicClaims = claims.filter((c) => c.topics.length === 0);
  const nameTopicsFailedIds = new Set<string>();
  if (emptyTopicClaims.length > 0) {
    const existingTopicLines = deps.existingTopicRefs.map(formatTopicRefForIndex);
    try {
      const named = await nameTopicsForClaims(
        emptyTopicClaims.map((c) => ({ id: c.id, title: c.title, body: c.body })),
        existingTopicLines,
        deps.locale,
        emptyTopicClaims[0]?.model,
      );
      for (const c of emptyTopicClaims) {
        const topics = named[c.id];
        if (topics && topics.length > 0) c.topics = topics;
      }
    } catch (err) {
      log("話題名の補完(name-topics)に失敗:", err);
      for (const c of emptyTopicClaims) nameTopicsFailedIds.add(c.id);
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
          result.createdTopics.push({ id: topicId, title: match.title });
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

// ── 既存話題どうしの統合（設定「話題を整理」から呼ばれる）──
// runTopicStage の統合ステップは「今回の実行で出た提案名」を対象にするのに対し、
// こちらは既にページとして存在する話題タイトル全体を対象にする（表記ゆれ・粒度違いで
// 増えてしまった話題を、後からまとめて 1 つに寄せる救済）。

/** 既存話題どうしの統合の入力（統合先を決める純粋関数に渡す最小情報） */
export type ExistingTopicForMerge = {
  id: string;
  title: string;
  memberClaimIds: string[];
};

/**
 * consolidate-topics の対応表（提案名 → 正式名）から、既存話題どうしの統合先を決める。
 * 副作用を持たない純粋関数（テストしやすいようここだけ切り出す）。
 *
 * 同じ正式名（正規化タイトル）に複数の既存話題がぶら下がったグループについて、
 * タイトルが正式名そのものと一致する話題を統合先（target）に選ぶ（無ければ先頭を選ぶ —
 * 呼び出し側で existingTopics の並び順を安定させておくこと）。
 * 戻り値は「吸収される側の話題 id → 統合先の話題 id」のマップ（吸収される話題のみ含む）。
 */
export function planExistingTopicMerges(
  existingTopics: ExistingTopicForMerge[],
  mapping: Record<string, string>,
): Map<string, string> {
  const groups = new Map<string, ExistingTopicForMerge[]>();
  for (const topic of existingTopics) {
    const canonical = mapping[topic.title] ?? topic.title;
    const key = normalizeTopicTitle(canonical);
    const list = groups.get(key) ?? [];
    list.push(topic);
    groups.set(key, list);
  }

  const targetByTopicId = new Map<string, string>();
  for (const [canonicalKey, group] of groups) {
    if (group.length < 2) continue;
    const target = group.find((t) => normalizeTopicTitle(t.title) === canonicalKey) ?? group[0];
    for (const t of group) {
      if (t.id !== target.id) targetByTopicId.set(t.id, target.id);
    }
  }
  return targetByTopicId;
}

/** 既存話題どうしの統合の実行結果 */
export type ConsolidateExistingTopicsResult = {
  /** 吸収され、ゴミ箱へ送った話題数 */
  merged: number;
  /** 本文を書き直した統合先の話題数 */
  rebuilt: number;
  /** compose 失敗・保存失敗などで処理できなかった件数 */
  failed: number;
};

export type ConsolidateExistingTopicsDeps = {
  loadDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  getCachedDoc: (noteId: string) => GraphiumDocument | null | undefined;
  handleSaveWikiFile: (
    wikiId: string,
    doc: GraphiumDocument,
    options?: { activityType?: EditActivityType; agentLabel?: string; sources?: string[] },
  ) => Promise<boolean | void>;
  /** 吸収された話題をゴミ箱へ送る（ソフトデリート）。既存の handleDeleteWikiFile をそのまま渡す想定 */
  handleDeleteWikiFile: (wikiId: string) => Promise<void>;
  noteIndex?: NoteIndex;
  locale: string;
  model?: string;
  log?: (...args: unknown[]) => void;
};

/**
 * 明示の対応表（吸収される話題 id → 統合先の話題 id）に従って話題どうしを統合する、
 * 副作用ありの実行部分。consolidateExistingTopics（LLM の consolidate-topics 経由）と、
 * 一覧・バナー・点検からの明示選択マージ（mergeTopics）が共通して使う。
 * 1. 統合先ごとに、吸収される話題のメンバー知見を統合先へ付け替え（claim.topicIds の
 *    retarget + topic.derivedFromClaims への合流）、本文を書き直す。
 * 2. 吸収された話題をゴミ箱へ送る（物理削除しない）。
 */
export async function applyTopicMerges(
  existingTopics: ExistingTopicForMerge[],
  targetByTopicId: Map<string, string>,
  deps: ConsolidateExistingTopicsDeps,
): Promise<ConsolidateExistingTopicsResult> {
  const result: ConsolidateExistingTopicsResult = { merged: 0, rebuilt: 0, failed: 0 };
  if (targetByTopicId.size === 0) return result;
  const log = deps.log ?? (() => {});

  const sourcesByTarget = new Map<string, string[]>();
  for (const [sourceId, targetId] of targetByTopicId) {
    const list = sourcesByTarget.get(targetId) ?? [];
    list.push(sourceId);
    sourcesByTarget.set(targetId, list);
  }
  const topicById = new Map(existingTopics.map((t) => [t.id, t]));

  for (const [targetId, sourceIds] of sourcesByTarget) {
    try {
      const targetDoc = deps.getCachedDoc(`wiki:${targetId}`) ?? (await deps.loadDoc(`wiki:${targetId}`));
      if (!targetDoc?.wikiMeta || targetDoc.wikiMeta.kind !== "topic") {
        result.failed++;
        continue;
      }

      const mergedMemberIds = new Set(targetDoc.wikiMeta.derivedFromClaims ?? []);
      for (const sourceId of sourceIds) {
        const source = topicById.get(sourceId);
        if (!source) continue;
        for (const claimId of source.memberClaimIds) {
          mergedMemberIds.add(claimId);
          try {
            const claimDoc = deps.getCachedDoc(`wiki:${claimId}`) ?? (await deps.loadDoc(`wiki:${claimId}`));
            if (claimDoc?.wikiMeta && claimDoc.wikiMeta.kind === "claim") {
              const nextMeta = retargetClaimTopicId(claimDoc.wikiMeta, sourceId, targetId);
              if (nextMeta !== claimDoc.wikiMeta) {
                await deps.handleSaveWikiFile(claimId, { ...claimDoc, wikiMeta: nextMeta });
              }
            }
          } catch (err) {
            log("知見の話題リンク付け替えに失敗:", claimId, err);
          }
        }
      }

      const memberIds = [...mergedMemberIds];
      const memberClaims: TopicComposeClaim[] = [];
      for (const cId of memberIds) {
        const cDoc = deps.getCachedDoc(`wiki:${cId}`) ?? (await deps.loadDoc(`wiki:${cId}`));
        if (cDoc) memberClaims.push({ id: cId, title: cDoc.title, body: extractBodyPreview(cDoc, 2000) });
      }
      if (memberClaims.length > 0) {
        const body = await composeTopicBody(targetDoc.title, deps.locale, memberClaims, deps.model);
        if (body) {
          const rewritten = rebuildTopicDocument(targetDoc, body, memberClaims, deps.model ?? null, deps.noteIndex);
          await deps.handleSaveWikiFile(targetId, rewritten, { activityType: "wiki_cross_update", sources: memberIds });
          result.rebuilt++;
        } else {
          // 本文が作れなくても、メンバーの合流とゴミ箱送りは続行する
          // （次の手動再生成 / 整理の再実行で本文は追従できる）。
          result.failed++;
        }
      }

      for (const sourceId of sourceIds) {
        try {
          await deps.handleDeleteWikiFile(sourceId);
          result.merged++;
        } catch (err) {
          log("統合された話題のゴミ箱送りに失敗:", sourceId, err);
          result.failed++;
        }
      }
    } catch (err) {
      log("既存話題の統合処理に失敗:", targetId, err);
      result.failed++;
    }
  }

  return result;
}

/**
 * 既存話題どうしを consolidate-topics（LLM）で判断して統合する（設定「話題を整理」から呼ばれる）。
 * 1. 全既存話題タイトルを consolidate-topics に渡し対応表を得る（失敗時は何もしない）。
 * 2. planExistingTopicMerges で統合先を決める。
 * 3. applyTopicMerges で実際の付け替え・本文書き直し・ゴミ箱送りを行う。
 */
export async function consolidateExistingTopics(
  existingTopics: ExistingTopicForMerge[],
  deps: ConsolidateExistingTopicsDeps,
): Promise<ConsolidateExistingTopicsResult> {
  const result: ConsolidateExistingTopicsResult = { merged: 0, rebuilt: 0, failed: 0 };
  if (existingTopics.length < 2) return result;
  const log = deps.log ?? (() => {});

  let mapping: Record<string, string> = {};
  try {
    mapping = await consolidateTopics(
      existingTopics.map((t) => t.title),
      [],
      deps.locale,
      deps.model,
    );
  } catch (err) {
    log("既存話題の統合(consolidate-topics)に失敗:", err);
    return result;
  }
  if (Object.keys(mapping).length === 0) return result;

  const targetByTopicId = planExistingTopicMerges(existingTopics, mapping);
  return applyTopicMerges(existingTopics, targetByTopicId, deps);
}

/**
 * ユーザーが明示的に選んだ「残すテーマ」「まとめるテーマ」からモデルを介さず統合する。
 * バナーの類似テーマ候補・一覧の選択統合・点検の redundant 手当てが共通して使う入口。
 * LLM は呼ばない（判断済みの組をそのまま applyTopicMerges に渡すだけ）。
 */
export async function mergeTopicsExplicit(
  keepId: string,
  mergeIds: string[],
  existingTopics: ExistingTopicForMerge[],
  deps: ConsolidateExistingTopicsDeps,
): Promise<ConsolidateExistingTopicsResult> {
  const targetByTopicId = new Map<string, string>();
  for (const id of mergeIds) {
    if (id === keepId) continue;
    targetByTopicId.set(id, keepId);
  }
  return applyTopicMerges(existingTopics, targetByTopicId, deps);
}

// ── 新形式トピックの段（資料を直接読む。2026-09〜）──
// 知見（claim）はトピックの材料にしない。資料 1 本ごとに Topic Router へ「改訂する既存
// トピック / 新しく作るトピック名」を判断させ、Topic Reviser で「前の本文 + 資料全文」から
// 次の版の本文を作る。埋め込み類似度・正規化タイトル一致による機械的な名寄せは行わない
// （routeTopicsForSource が既存トピック index を渡し、LLM 自身に判断させる）。

/** 話題の段に渡す資料（source）1 件分の入力。知見ではなく資料そのもの */
export type SourceTopicStageInput = {
  id: string;
  title: string;
  /** 資料の全文（取り込みで既に持っている本文をそのまま渡す。再取得しない・上限は置かない） */
  text: string;
  model?: string;
};

/** 新形式トピックの段の実行結果（トースト表示・出典照合の導線に使う） */
export type SourceTopicStageResult = {
  /** 新規作成した話題ページ数 */
  created: number;
  /** 資料を反映して本文を改訂した話題ページ数（新形式の改訂 + 旧形式からの移行を含む） */
  updated: number;
  /** 旧形式（知見由来）から新形式へ移行した話題ページ数（updated の内数） */
  migrated: number;
  /** 振り分け・改訂に失敗した件数 */
  failed: number;
  /** この実行で新規作成した話題（呼び出し側が並行実行の既存一覧に引き継ぐ） */
  createdTopics: { id: string; title: string }[];
  /** 触れた（作成・改訂・移行の）話題 id（トーストの「出典照合する」導線・未照合件数の対象） */
  touchedTopicIds: string[];
};

export type SourceTopicStageDeps = {
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
  /** 既存の話題ページ一覧（id・title・oneLiner）。関数内で新規作成分を追記していく */
  existingTopicRefs: ExistingTopicRef[];
  noteIndex?: NoteIndex;
  locale: string;
  /**
   * 資料 id から「タイトル + 全文」を解決する（出典照合の resolveSourceText と同じ入口を
   * 呼び出し側が注入する想定）。ゴミ箱・未検出などで読めない資料は undefined を返す
   * — 呼び出し側（rebuildTopicFromSources）はそれを件数として数え、黙って握り潰さない。
   */
  resolveSource: (sourceId: string) => Promise<{ title: string; text: string } | undefined>;
  onTopicSaved?: (
    topicId: string,
    doc: GraphiumDocument,
    triggerSourceId: string,
    mode: "create" | "update" | "migrate",
  ) => void;
  log?: (...args: unknown[]) => void;
};

/**
 * 資料 id の列から TopicSourceRef（id + title）を集める。knownSource と一致する id は
 * 全文を再取得せずタイトルだけそのまま使う。解決できない id は結果から静かに落ちる
 * （本文中の [[source:id]] 引用自体は resolveSourceCitations のフォールバックで
 * 文字列として残るため、参照そのものが消えるわけではない）。
 */
async function collectSourceRefs(
  ids: string[],
  deps: Pick<SourceTopicStageDeps, "resolveSource">,
  knownSource?: SourceTopicStageInput,
): Promise<TopicSourceRef[]> {
  const refs: TopicSourceRef[] = [];
  for (const id of ids) {
    if (knownSource && id === knownSource.id) {
      refs.push({ id, title: knownSource.title });
      continue;
    }
    const resolved = await deps.resolveSource(id);
    if (resolved) refs.push({ id, title: resolved.title });
  }
  return refs;
}

/**
 * 話題の段（新形式）を実行する。sources は取り込み等で今回処理し終えた資料の一覧
 * （知見の有無に関係なく、資料 1 本につき 1 件渡す）。
 */
export async function runSourceTopicStage(
  sources: SourceTopicStageInput[],
  deps: SourceTopicStageDeps,
): Promise<SourceTopicStageResult> {
  const result: SourceTopicStageResult = {
    created: 0,
    updated: 0,
    migrated: 0,
    failed: 0,
    createdTopics: [],
    touchedTopicIds: [],
  };
  if (sources.length === 0) return result;

  const log = deps.log ?? (() => {});
  const existingTopicRefs = [...deps.existingTopicRefs];

  for (const source of sources) {
    let route: { update: string[]; create: string[] };
    try {
      const existingForRouter: TopicRouteExistingRef[] = existingTopicRefs.map((t) => ({
        id: t.id,
        title: t.title,
        oneLiner: t.oneLiner,
      }));
      route = await routeTopicsForSource(
        { id: source.id, title: source.title, text: source.text },
        existingForRouter,
        deps.locale,
        source.model,
      );
    } catch (err) {
      result.failed++;
      log("資料の振り分け(route-topics)に失敗:", source.id, err);
      continue;
    }

    for (const topicId of route.update) {
      try {
        const topicDoc = deps.getCachedDoc(`wiki:${topicId}`) ?? (await deps.loadDoc(`wiki:${topicId}`));
        if (!topicDoc?.wikiMeta || topicDoc.wikiMeta.kind !== "topic") {
          log("話題の改訂をスキップ: ドキュメントが見つからない", topicId);
          result.failed++;
          continue;
        }

        if (typeof topicDoc.wikiMeta.topicMarkdown === "string") {
          // 新形式: 前の本文 + 今回の資料全文で改訂する。
          const currentBody = topicDoc.wikiMeta.topicMarkdown;
          const revisedBody = await reviseTopicFromSource(
            topicDoc.title,
            currentBody,
            { id: source.id, title: source.title, text: source.text },
            deps.locale,
            source.model,
          );
          if (!revisedBody) {
            result.failed++;
            continue;
          }
          const priorIds = (topicDoc.wikiMeta.derivedFromNotes ?? []).filter((id) => id !== source.id);
          const sourceRefs = await collectSourceRefs([...priorIds, source.id], deps, source);
          const rewritten = rebuildSourceTopicDocument(topicDoc, revisedBody, sourceRefs, source.model ?? null, deps.noteIndex);
          await deps.handleSaveWikiFile(topicId, rewritten, {
            activityType: "wiki_cross_update",
            sources: sourceRefs.map((r) => r.id),
          });
          deps.onTopicSaved?.(topicId, rewritten, source.id, "update");
          result.updated++;
          result.touchedTopicIds.push(topicId);
        } else {
          // 旧形式（知見由来。topicMarkdown を持たない）: 触れたら新方式へ移行する。
          // メンバー知見それぞれの derivedFromNotes から資料 id を集め、空の本文から
          // 資料を 1 本ずつ順に改訂して組み直し、最後に今回の資料を足す。
          const memberClaimIds = topicDoc.wikiMeta.derivedFromClaims ?? [];
          const collectedSourceIds = new Set<string>();
          for (const claimId of memberClaimIds) {
            const claimDoc = deps.getCachedDoc(`wiki:${claimId}`) ?? (await deps.loadDoc(`wiki:${claimId}`));
            for (const sid of claimDoc?.wikiMeta?.derivedFromNotes ?? []) collectedSourceIds.add(sid);
          }
          collectedSourceIds.delete(source.id);
          const migrateResult = await rebuildTopicFromSources(
            topicId,
            [...collectedSourceIds, source.id],
            {
              loadDoc: deps.loadDoc,
              getCachedDoc: deps.getCachedDoc,
              handleSaveWikiFile: deps.handleSaveWikiFile,
              resolveSource: async (id) =>
                id === source.id ? { title: source.title, text: source.text } : deps.resolveSource(id),
              noteIndex: deps.noteIndex,
              locale: deps.locale,
              model: source.model,
              log: deps.log,
            },
          );
          if (migrateResult.rebuilt && migrateResult.doc) {
            deps.onTopicSaved?.(topicId, migrateResult.doc, source.id, "migrate");
            result.migrated++;
            result.updated++;
            result.touchedTopicIds.push(topicId);
          } else {
            result.failed++;
          }
        }
      } catch (err) {
        result.failed++;
        log("話題の改訂に失敗:", topicId, err);
      }
    }

    for (const name of route.create) {
      try {
        const revisedBody = await reviseTopicFromSource(
          name,
          "",
          { id: source.id, title: source.title, text: source.text },
          deps.locale,
          source.model,
        );
        if (!revisedBody) {
          result.failed++;
          continue;
        }
        const newDoc = buildSourceTopicDocument(
          name,
          revisedBody,
          [{ id: source.id, title: source.title }],
          source.model ?? null,
          deps.noteIndex,
          deps.locale,
        );
        const topicId = await deps.handleCreateWikiFile(newDoc, {
          activityType: "wiki_ingest",
          sources: [source.id],
        });
        deps.onTopicSaved?.(topicId, newDoc, source.id, "create");
        existingTopicRefs.push({ id: topicId, title: name });
        result.createdTopics.push({ id: topicId, title: name });
        result.created++;
        result.touchedTopicIds.push(topicId);
      } catch (err) {
        result.failed++;
        log("話題の新規作成に失敗:", name, err);
      }
    }
  }

  return result;
}

// ── 旧形式トピックの新形式への組み直し（移行・手入れ画面の「資料から作り直す」共通）──

/** rebuildTopicFromSources の実行結果 */
export type RebuildTopicFromSourcesResult = {
  /** 1 件以上の資料が反映され、保存できたか */
  rebuilt: boolean;
  /** 保存後のドキュメント（rebuilt が true のときだけ入る。呼び出し側の embed 等の副作用用） */
  doc?: GraphiumDocument;
  /** 実際に反映できた資料件数 */
  sourcesUsed: number;
  /** 本文が取得できない・改訂に失敗して飛ばした資料件数（黙って捨てず件数で返す） */
  sourcesSkipped: number;
};

export type RebuildTopicFromSourcesDeps = {
  loadDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  getCachedDoc: (noteId: string) => GraphiumDocument | null | undefined;
  handleSaveWikiFile: (
    wikiId: string,
    doc: GraphiumDocument,
    options?: { activityType?: EditActivityType; agentLabel?: string; sources?: string[] },
  ) => Promise<boolean | void>;
  /** 資料 id から「タイトル + 全文」を解決する。読めない資料は undefined（ゴミ箱・未検出等） */
  resolveSource: (sourceId: string) => Promise<{ title: string; text: string } | undefined>;
  noteIndex?: NoteIndex;
  locale: string;
  model?: string;
  log?: (...args: unknown[]) => void;
};

/**
 * 既存の話題ページを、渡された資料 id の列から新形式で作り直す。空の本文から資料を
 * 1 本ずつ順に改訂して組み直す（Karpathy の incremental revision と同じ手順）。
 * PR 3b では旧形式トピックの「触れたら移行」から呼ばれる。PR 5 では手入れ画面の
 * 「資料から作り直す」からも同じ関数を再利用する想定。
 */
export async function rebuildTopicFromSources(
  topicId: string,
  sourceIds: string[],
  deps: RebuildTopicFromSourcesDeps,
): Promise<RebuildTopicFromSourcesResult> {
  const log = deps.log ?? (() => {});
  const topicDoc = deps.getCachedDoc(`wiki:${topicId}`) ?? (await deps.loadDoc(`wiki:${topicId}`));
  if (!topicDoc?.wikiMeta || topicDoc.wikiMeta.kind !== "topic") {
    return { rebuilt: false, sourcesUsed: 0, sourcesSkipped: sourceIds.length };
  }

  // 重複 id を除きつつ、渡された順序は保つ（先に出てきたものを優先）。
  const uniqueIds = [...new Set(sourceIds)];
  let body = "";
  const usedRefs: TopicSourceRef[] = [];
  let skipped = 0;

  for (const sourceId of uniqueIds) {
    const resolved = await deps.resolveSource(sourceId);
    if (!resolved) {
      skipped++;
      log("資料本文が取得できず飛ばした:", sourceId);
      continue;
    }
    const revised = await reviseTopicFromSource(
      topicDoc.title,
      body,
      { id: sourceId, title: resolved.title, text: resolved.text },
      deps.locale,
      deps.model,
    );
    if (!revised) {
      skipped++;
      log("トピック改訂に失敗し飛ばした:", sourceId);
      continue;
    }
    body = revised;
    usedRefs.push({ id: sourceId, title: resolved.title });
  }

  if (usedRefs.length === 0) {
    return { rebuilt: false, sourcesUsed: 0, sourcesSkipped: skipped };
  }

  const rewritten = rebuildSourceTopicDocument(topicDoc, body, usedRefs, deps.model ?? null, deps.noteIndex);
  await deps.handleSaveWikiFile(topicId, rewritten, {
    activityType: "wiki_cross_update",
    sources: usedRefs.map((r) => r.id),
  });
  return { rebuilt: true, doc: rewritten, sourcesUsed: usedRefs.length, sourcesSkipped: skipped };
}
