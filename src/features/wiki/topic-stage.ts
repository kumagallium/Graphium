// 話題（topic）の段 — 資料（source）から話題ページを作る/改訂する純粋なステージと、
// 既存話題どうしの統合。
//
// note-app.tsx の複数の取り込み経路（ノート取り込み・チャットのナレッジ化・素材 URL/PDF/Word・
// URL 貼付・設定の「話題を整理」）から同じロジックを呼べるよう、依存を引数で注入する形で
// 切り出している。
//
// 知見（claim）を経由してトピックを組み立てる旧方式（runTopicStage・name-topics による
// 話題名の保険・compose-topic による本文生成）は撤去済み（2026-09）。知見はもうトピックの
// 材料にしない — トピックは資料そのものを直接読む新形式（runSourceTopicStage）だけが作る。
//
// 話題どうしの統合（表記ゆれ・粒度違いの近縁話題を 1 つに寄せる）は ingest の隠れた段には
// しない — 設定の「話題を整理」（consolidateExistingTopics）と点検（wiki-linter）の
// redundant 検出に任せる。

import type { GraphiumDocument } from "../../lib/document-types";
import type { EditActivityType } from "../document-provenance/types";
import {
  consolidateTopics,
  normalizeTopicTitle,
  retargetClaimTopicId,
  buildSourceTopicDocument,
  rebuildSourceTopicDocument,
  routeTopicsForSource,
  reviseTopicFromSource,
  mergeTopicBodies,
  type ExistingTopicRef,
  type TopicSourceRef,
  type TopicRouteExistingRef,
  type NoteIndex,
} from "./wiki-service";

// ── 既存話題どうしの統合（設定「話題を整理」から呼ばれる）──
// 既にページとして存在する話題タイトル全体を対象に、表記ゆれ・粒度違いで
// 増えてしまった話題を、後からまとめて 1 つに寄せる救済。

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
  /**
   * 資料 id から「タイトル + 全文」を解決する（新形式どうしの本文統合・旧形式を含む組み直しで
   * 使う。出典照合の resolveSourceText と同じ入口を呼び出し側が注入する想定）。
   * ゴミ箱・未検出などで読めない資料は undefined を返す。
   */
  resolveSource: (sourceId: string) => Promise<{ title: string; text: string } | undefined>;
  /**
   * 資料 id からタイトルだけを解決する軽量経路（runSourceTopicStage の resolveSourceTitle と
   * 同じ役割）。未指定・解決不能なら resolveSource（全文取得を伴う）へフォールバックする。
   */
  resolveSourceTitle?: (sourceId: string) => string | undefined;
  noteIndex?: NoteIndex;
  locale: string;
  model?: string;
  log?: (...args: unknown[]) => void;
};

/**
 * 明示の対応表（吸収される話題 id → 統合先の話題 id）に従って話題どうしを統合する、
 * 副作用ありの実行部分。consolidateExistingTopics（LLM の consolidate-topics 経由）と、
 * 一覧・バナー・点検からの明示選択マージ（mergeTopics）が共通して使う。
 *
 * 本文の作り方は統合先・吸収元の形式で分かれる（知見を経由する統合は撤去済み）:
 *   - 全員が新形式（topicMarkdown を持つ）: mergeTopicBodies で本文どうしを直接統合し、
 *     資料は全員の derivedFromNotes の和にする。
 *   - 1 つでも旧形式: 全体の資料 id（旧形式側はメンバー知見の derivedFromNotes の和、
 *     新形式側は derivedFromNotes そのもの）を集め、rebuildTopicFromSources で
 *     資料から組み直す（結果として新形式へ移行する）。
 *
 * 知見（claim）側の topicIds 付け替え（retargetClaimTopicId）は旧形式との互換のために残す
 * — 新形式の吸収元はメンバー知見を持たないため、この付け替えは何もしない。
 * 最後に、吸収された話題をゴミ箱へ送る（物理削除しない）。
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

      // 吸収される話題それぞれの実ドキュメントを読む（新形式判定・derivedFromNotes 収集用）。
      const sourceDocs: { id: string; doc: GraphiumDocument }[] = [];
      for (const sourceId of sourceIds) {
        const doc = deps.getCachedDoc(`wiki:${sourceId}`) ?? (await deps.loadDoc(`wiki:${sourceId}`));
        if (doc?.wikiMeta && doc.wikiMeta.kind === "topic") sourceDocs.push({ id: sourceId, doc });
      }
      const sourceDocById = new Map(sourceDocs.map((d) => [d.id, d.doc]));

      // 知見側 topicIds の付け替え（旧形式の互換）。新形式の吸収元は memberClaimIds が
      // 空なので何もしない。
      for (const sourceId of sourceIds) {
        const source = topicById.get(sourceId);
        if (!source) continue;
        for (const claimId of source.memberClaimIds) {
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

      const targetIsNew = typeof targetDoc.wikiMeta.topicMarkdown === "string";
      const allNew = targetIsNew
        && sourceDocs.length === sourceIds.length
        && sourceDocs.every(({ doc }) => typeof doc.wikiMeta!.topicMarkdown === "string");

      if (allNew) {
        // 全員新形式: 本文どうしを直接統合する（資料は全員の derivedFromNotes の和）。
        const seen = new Set<string>();
        const refIds: string[] = [];
        for (const id of targetDoc.wikiMeta.derivedFromNotes ?? []) {
          if (!seen.has(id)) { seen.add(id); refIds.push(id); }
        }
        for (const { doc } of sourceDocs) {
          for (const id of doc.wikiMeta!.derivedFromNotes ?? []) {
            if (!seen.has(id)) { seen.add(id); refIds.push(id); }
          }
        }
        const bodies = [
          targetDoc.wikiMeta.topicMarkdown as string,
          ...sourceDocs.map(({ doc }) => doc.wikiMeta!.topicMarkdown as string),
        ];
        const mergedBody = await mergeTopicBodies(targetDoc.title, bodies, deps.locale, deps.model);
        if (mergedBody) {
          const sourceRefs = await collectSourceRefs(refIds, deps);
          const rewritten = rebuildSourceTopicDocument(targetDoc, mergedBody, sourceRefs, deps.model ?? null, deps.noteIndex);
          await deps.handleSaveWikiFile(targetId, rewritten, {
            activityType: "wiki_cross_update",
            sources: sourceRefs.map((r) => r.id),
          });
          result.rebuilt++;
        } else {
          // 本文が作れなくても、知見の合流（上で実施済み）とゴミ箱送りは続行する。
          result.failed++;
        }
      } else {
        // 1 つでも旧形式: 全体の資料 id の和を集め、資料から組み直す（新形式へ移行する）。
        const collectedSourceIds = new Set<string>();
        const addFromOldFormatMember = async (topicRef: ExistingTopicForMerge | undefined) => {
          if (!topicRef) return;
          for (const claimId of topicRef.memberClaimIds) {
            const claimDoc = deps.getCachedDoc(`wiki:${claimId}`) ?? (await deps.loadDoc(`wiki:${claimId}`));
            for (const sid of claimDoc?.wikiMeta?.derivedFromNotes ?? []) collectedSourceIds.add(sid);
          }
        };

        if (targetIsNew) {
          for (const id of targetDoc.wikiMeta.derivedFromNotes ?? []) collectedSourceIds.add(id);
        } else {
          await addFromOldFormatMember(topicById.get(targetId));
        }
        for (const sourceId of sourceIds) {
          const sourceDoc = sourceDocById.get(sourceId);
          if (sourceDoc && typeof sourceDoc.wikiMeta!.topicMarkdown === "string") {
            for (const id of sourceDoc.wikiMeta!.derivedFromNotes ?? []) collectedSourceIds.add(id);
          } else {
            await addFromOldFormatMember(topicById.get(sourceId));
          }
        }

        if (collectedSourceIds.size > 0) {
          const rebuildResult = await rebuildTopicFromSources(targetId, [...collectedSourceIds], {
            loadDoc: deps.loadDoc,
            getCachedDoc: deps.getCachedDoc,
            handleSaveWikiFile: deps.handleSaveWikiFile,
            resolveSource: deps.resolveSource,
            resolveSourceTitle: deps.resolveSourceTitle,
            noteIndex: deps.noteIndex,
            locale: deps.locale,
            model: deps.model,
            log: deps.log,
          });
          if (rebuildResult.rebuilt) {
            result.rebuilt++;
          } else {
            // 本文が作れなくても、知見の合流（上で実施済み）とゴミ箱送りは続行する。
            result.failed++;
          }
        } else {
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
  /**
   * 移行時に読めなかった資料の延べ件数（ゴミ箱・未検出等。rebuildTopicFromSources の
   * sourcesSkipped の合計）。黙って捨てず、トーストで件数として伝える。
   */
  migratedSourcesSkipped: number;
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
  /**
   * 資料 id からタイトルだけを解決する（全文は不要な場面用）。既存の参照先タイトルを
   * 引ける索引（出典照合の resolveSourceCheckTitles 相当）を呼び出し側が注入する想定。
   * 未指定・解決不能なら resolveSource（全文取得を伴う）へフォールバックする —
   * 改訂のたびに過去の資料本文（PDF 抽出等）を読み直すコストを避けるための経路。
   */
  resolveSourceTitle?: (sourceId: string) => string | undefined;
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
 * 全文を再取得せずタイトルだけそのまま使う。それ以外はまず resolveSourceTitle（軽量・
 * 全文を読まない）を試し、無い／解決できないときだけ resolveSource（全文取得を伴う）に
 * フォールバックする。解決できない id は結果から静かに落ちる（本文中の [[source:id]]
 * 引用自体は resolveSourceCitations のフォールバックで文字列として残るため、参照そのものが
 * 消えるわけではない）。
 */
export async function collectSourceRefs(
  ids: string[],
  deps: Pick<SourceTopicStageDeps, "resolveSource" | "resolveSourceTitle">,
  knownSource?: SourceTopicStageInput,
): Promise<TopicSourceRef[]> {
  const refs: TopicSourceRef[] = [];
  for (const id of ids) {
    if (knownSource && id === knownSource.id) {
      refs.push({ id, title: knownSource.title });
      continue;
    }
    const titleOnly = deps.resolveSourceTitle?.(id);
    if (titleOnly) {
      refs.push({ id, title: titleOnly });
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
    migratedSourcesSkipped: 0,
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

    // ルーターの結果に加え、今回の資料を既に引用済みの新形式トピックは必ず改訂対象に
    // 含める（和集合。ルーターは資料 1 本ずつしか見ないため、既存の引用が古くなっても
    // 拾わないことがある — LLM の判断任せにせず機械的に見つける）。
    const previouslyCitedIds = new Set(
      existingTopicRefs.filter((t) => t.sourceIds?.includes(source.id)).map((t) => t.id),
    );
    const updateIds = [...new Set([...route.update, ...previouslyCitedIds])];

    for (const topicId of updateIds) {
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
            previouslyCitedIds.has(topicId),
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
          result.migratedSourcesSkipped += migrateResult.sourcesSkipped;
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
  /**
   * 資料 id からタイトルだけを解決する（collectSourceRefs / SourceTopicStageDeps と同じ形。
   * このロジック自体は毎回 resolveSource で全文を読む必要があるため直接は使わないが、
   * 呼び出し側の deps を SourceTopicStageDeps と揃えられるよう受け口だけ用意しておく）。
   */
  resolveSourceTitle?: (sourceId: string) => string | undefined;
  noteIndex?: NoteIndex;
  locale: string;
  model?: string;
  log?: (...args: unknown[]) => void;
};

/**
 * 既存の話題ページを、渡された資料 id の列から新形式で作り直す。空の本文から資料を
 * 1 本ずつ順に改訂して組み直す（Karpathy の incremental revision と同じ手順）。
 * 旧形式トピックの「触れたら移行」（runSourceTopicStage）・手動再生成・手入れ画面の
 * 「資料から作り直す」（作業 C）が共通してこの関数を使う。
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

// ── 「資料から作り直す」の実行前計画（人が起動し、実行前に AI 呼び出し回数を見せる）──
// トピックページの再生成・手入れ画面の旧形式一括作り直し・missing-source の手当てが
// 共通して使う。自動一括はしない方針のため、実行前に必ずこの計画を通して確認する。

/** planTopicRebuild に渡す 1 トピック分の入力（id と、実ドキュメント） */
export type TopicRebuildTarget = {
  id: string;
  doc: GraphiumDocument;
};

/** 1 トピック分の実行計画（重複除去済みの資料 id 列） */
export type TopicRebuildPlanItem = {
  topicId: string;
  sourceIds: string[];
};

/** 「資料から作り直す」の実行前計画 */
export type TopicRebuildPlan = {
  items: TopicRebuildPlanItem[];
  /** 資料が 1 件以上見つかり、実際に作り直せるトピック数 */
  topicCount: number;
  /** 合計 AI 呼び出し回数（rebuildTopicFromSources は資料 1 本につき改訂 1 回） */
  totalCalls: number;
};

/**
 * 「資料から作り直す」の実行前に、対象トピックそれぞれの資料 id 列と、
 * 合計 AI 呼び出し回数を計算する副作用なしの純粋関数。
 * 新形式（topicMarkdown を持つ）は derivedFromNotes をそのまま資料とみなし、
 * 旧形式はメンバー知見（derivedFromClaims）の derivedFromNotes の和を資料とみなす
 * （重複除去）。getDoc はメンバー知見のドキュメント解決だけに使う（呼び出し側が
 * キャッシュ／ロードのどちらでも注入できるよう同期・非同期どちらの戻りも許す）。
 */
export async function planTopicRebuild(
  topics: TopicRebuildTarget[],
  getDoc: (noteId: string) => Promise<GraphiumDocument | null | undefined> | GraphiumDocument | null | undefined,
): Promise<TopicRebuildPlan> {
  const items: TopicRebuildPlanItem[] = [];
  for (const { id, doc } of topics) {
    if (!doc.wikiMeta || doc.wikiMeta.kind !== "topic") continue;
    const sourceIds = new Set<string>();
    if (typeof doc.wikiMeta.topicMarkdown === "string") {
      for (const sourceId of doc.wikiMeta.derivedFromNotes ?? []) sourceIds.add(sourceId);
    } else {
      for (const claimId of doc.wikiMeta.derivedFromClaims ?? []) {
        const claimDoc = await getDoc(`wiki:${claimId}`);
        for (const sourceId of claimDoc?.wikiMeta?.derivedFromNotes ?? []) sourceIds.add(sourceId);
      }
    }
    if (sourceIds.size > 0) items.push({ topicId: id, sourceIds: [...sourceIds] });
  }
  return {
    items,
    topicCount: items.length,
    totalCalls: items.reduce((sum, item) => sum + item.sourceIds.length, 0),
  };
}

// ── 取り込み結果の判定（純関数）──
// note-app.tsx の各取り込み経路が「知見 0 件 = insufficientContent」を判定するのに使う。
// トピックは知見の有無に関係なく資料から作られるため、知見が 0 件でもトピックの
// 作成・改訂・移行のいずれかが 1 件でもあれば「反映された」とみなし、失敗にしない。

/**
 * 知見（wiki）件数とトピック段で反映できた件数から、取り込み全体を「反映なし」
 * （insufficientContent）とみなすべきかを判定する。
 */
export function isIngestInsufficient(wikisCount: number, topicsTouchedCount: number): boolean {
  return wikisCount <= 0 && topicsTouchedCount <= 0;
}
