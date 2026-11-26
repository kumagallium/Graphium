// 知見はできたのに、トピックがまだ無い資料に、トピックの段だけを回す（設定の点検・整理と、まとめてナレッジ化）。
//
// 取り込みは「知見の段 → トピックの段」の順に進むが、トピックの段は 1 本ずつしか進まない。
// 多くの資料をまとめて取り込むと、知見の段が先に終わり、トピックの段の待ち行列だけが長く残る。
// 待ち行列はアプリの中にしか無いので、アプリを閉じると何も残さずに消える。しかも知見がある資料は
// 「取り込み済み・変わっていない」と見なされ、まとめてナレッジ化を押し直しても飛ばされていた。
//
// そこで、対象は記録ではなくデータから毎回選び直す: 現役の知見があり、その資料を由来に持つ現役の
// トピックが 1 つも無い資料。トピックの段を回して何も作らなかった資料（振り分け役が「トピックに
// するものは無い」と判断した資料）だけは控えに残し、次から飛ばす。
// 知見は作り直さない（AI の呼び出しはトピックの段の分だけ）。

import type { SourceTopicStageProgress, SourceTopicStageResult } from "./topic-stage";

/** 対象選びに使うナレッジページの要約（ゴミ箱・アーカイブは呼び出し側で外す） */
export type SourceTopicBackfillEntry = {
  id: string;
  kind: string;
  derivedFromNotes?: string[];
  /** 旧形式のトピック（知見から作ったもの）は資料を直接持たないので、メンバー知見から辿る */
  derivedFromClaims?: string[];
};

export const SOURCE_TOPIC_BACKFILL_CHECKPOINT_KEY = "source-topic-backfill-progress";
export const SOURCE_TOPIC_BACKFILL_CHECKPOINT_FILE = ".graphium-source-topic-backfill-progress.json";
/** 失敗がこの回数続いたら止める（モデルが落ちている・設定が違うときに全件を空回りさせない） */
export const SOURCE_TOPIC_BACKFILL_MAX_CONSECUTIVE_FAILURES = 3;

export type SourceTopicBackfillCheckpoint = {
  version: 1;
  /**
   * トピックの段を回したが何も作らなかった資料・本文が読めなかった資料。
   * 値は記録した時点の知見の数（知見が増えたら、資料が伸びたかもしれないので対象に戻す）
   */
  settled: Record<string, { claims: number; reason: "no-topic" | "unreadable" }>;
};

export function emptySourceTopicBackfillCheckpoint(): SourceTopicBackfillCheckpoint {
  return { version: 1, settled: {} };
}

/** 控えを読む。形が違えば空から始める（控えが壊れても、対象はデータから選び直せる） */
export function parseSourceTopicBackfillCheckpoint(raw: unknown): SourceTopicBackfillCheckpoint {
  const r = raw as { version?: unknown; settled?: unknown } | null;
  if (r?.version !== 1 || !r.settled || typeof r.settled !== "object") return emptySourceTopicBackfillCheckpoint();
  const out = emptySourceTopicBackfillCheckpoint();
  for (const [sourceId, value] of Object.entries(r.settled as Record<string, unknown>)) {
    const v = value as { claims?: unknown; reason?: unknown } | null;
    if (typeof v?.claims !== "number") continue;
    if (v.reason !== "no-topic" && v.reason !== "unreadable") continue;
    out.settled[sourceId] = { claims: v.claims, reason: v.reason };
  }
  return out;
}

/** 資料ごとの現役の知見の数と、トピックを持つ資料の集合 */
function summarizeSources(entries: SourceTopicBackfillEntry[]): { claimsBySource: Map<string, number>; covered: Set<string> } {
  const claimsBySource = new Map<string, number>();
  const sourcesOfClaim = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.kind !== "claim") continue;
    const sources = [...new Set(entry.derivedFromNotes ?? [])];
    sourcesOfClaim.set(entry.id, sources);
    for (const sourceId of sources) claimsBySource.set(sourceId, (claimsBySource.get(sourceId) ?? 0) + 1);
  }
  const covered = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "topic") continue;
    for (const sourceId of entry.derivedFromNotes ?? []) covered.add(sourceId);
    for (const claimId of entry.derivedFromClaims ?? []) {
      for (const sourceId of sourcesOfClaim.get(claimId) ?? []) covered.add(sourceId);
    }
  }
  return { claimsBySource, covered };
}

export type SourceTopicBackfillPlan = {
  /** これからトピックの段を回す資料（知見の多い順） */
  sourceIds: string[];
  /** 何も作らなかった・読めなかったと控えにあり、今回は飛ばす資料の数 */
  alreadySettled: number;
};

/**
 * 計画を立てる（AI は呼ばない）。isTarget で対象の資料を絞れる（まとめてナレッジ化が、選んだ素材だけに絞るとき）。
 */
export function planSourceTopicBackfill(
  entries: SourceTopicBackfillEntry[],
  checkpoint: SourceTopicBackfillCheckpoint,
  isTarget: (sourceId: string) => boolean = () => true,
): SourceTopicBackfillPlan {
  const { claimsBySource, covered } = summarizeSources(entries);
  const picked: { id: string; claims: number }[] = [];
  let alreadySettled = 0;
  for (const [sourceId, claims] of claimsBySource) {
    if (covered.has(sourceId) || !isTarget(sourceId)) continue;
    const settled = checkpoint.settled[sourceId];
    if (settled && claims <= settled.claims) {
      alreadySettled++;
      continue;
    }
    picked.push({ id: sourceId, claims });
  }
  // 知見の多い資料から（トピックにして得るものが多い）。同数は id 順で、毎回同じ順にする
  picked.sort((a, b) => b.claims - a.claims || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { sourceIds: picked.map((p) => p.id), alreadySettled };
}

/** いま手を付けている資料の中の進み具合（資料の境目でしか進まない数字だけだと、止まって見えるため） */
export type SourceTopicBackfillCurrent = {
  /** 何本目か（1 始まり） */
  index: number;
  title: string;
  /** reading: 読んで何を書くか決めている／writing: トピックを書いている／linking: 知見をトピックに結んでいる */
  phase: SourceTopicStageProgress["phase"] | "linking";
  written: number;
  planned: number;
  windowIndex: number;
  windowTotal: number;
};

export type SourceTopicBackfillProgress = {
  done: number;
  total: number;
  /** 作った・改訂したトピックの数（延べ。終わった資料の分） */
  topicsTouched: number;
  /** いま手を付けている資料。資料の合間・終わったあとは無い */
  current?: SourceTopicBackfillCurrent;
};

/** トピックの段から届く、1 本の資料の中の進み具合（linking は段のあとに呼び出し側が知らせる） */
export type SourceTopicBackfillStageProgress = Omit<SourceTopicStageProgress, "sourceId" | "phase"> & {
  phase: SourceTopicBackfillCurrent["phase"];
};

export type SourceTopicBackfillResult = SourceTopicBackfillProgress & {
  /** 新しく作ったトピックの数 */
  created: number;
  /** 何も作らなかった資料の数（控えに残す） */
  noTopic: number;
  /** 本文が読めなかった資料の数（控えに残す） */
  unreadable: number;
  /** 失敗した資料の数（控えに残さないので、次の実行でやり直す） */
  failedSources: number;
  aborted: boolean;
  stoppedByFailures: boolean;
  /** 失敗の理由（最初の 1 件） */
  failureError?: unknown;
};

export type SourceTopicBackfillDeps = {
  /** 資料の題と本文。読めなければ undefined */
  resolveSource: (sourceId: string) => Promise<{ title: string; text: string } | undefined>;
  /** トピックの段を 1 本回す（取り込みと同じ段・同じ待ち行列） */
  runTopicStage: (
    source: { id: string; title: string; text: string },
    signal?: AbortSignal,
    onStageProgress?: (progress: SourceTopicBackfillStageProgress) => void,
  ) => Promise<SourceTopicStageResult>;
  /** 最新の控えを読む（取り込みの側も書くので、書く直前に読み直す） */
  readCheckpoint: () => Promise<SourceTopicBackfillCheckpoint>;
  saveCheckpoint: (checkpoint: SourceTopicBackfillCheckpoint) => Promise<void>;
  /** 資料の今の知見の数（控えに残す値） */
  claimsOf: (sourceId: string) => number;
  onProgress?: (progress: SourceTopicBackfillProgress) => void;
  signal?: AbortSignal;
  log?: (...args: unknown[]) => void;
};

/** 控えに 1 件足す（書く直前に読み直す。書けなくても処理は続ける） */
export async function settleSourceTopicBackfill(
  sourceId: string,
  record: { claims: number; reason: "no-topic" | "unreadable" },
  deps: Pick<SourceTopicBackfillDeps, "readCheckpoint" | "saveCheckpoint" | "log">,
): Promise<void> {
  try {
    const latest = await deps.readCheckpoint();
    await deps.saveCheckpoint({ version: 1, settled: { ...latest.settled, [sourceId]: record } });
  } catch (err) {
    // 控えが書けなくても、作ったトピックは残る（次の計画で同じ資料がもう一度出るだけ）
    (deps.log ?? (() => {}))("トピックの段の控えを保存できなかった:", err);
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === "AbortError" : (err as { name?: unknown } | null)?.name === "AbortError";
}

/** 計画した資料に 1 本ずつトピックの段を回す。例外を投げない */
export async function runSourceTopicBackfill(
  plan: SourceTopicBackfillPlan,
  deps: SourceTopicBackfillDeps,
): Promise<SourceTopicBackfillResult> {
  const log = deps.log ?? (() => {});
  const result: SourceTopicBackfillResult = {
    done: 0,
    total: plan.sourceIds.length,
    topicsTouched: 0,
    created: 0,
    noTopic: 0,
    unreadable: 0,
    failedSources: 0,
    aborted: false,
    stoppedByFailures: false,
  };
  let consecutiveFailures = 0;
  const fail = (err: unknown): boolean => {
    result.failedSources++;
    if (result.failureError === undefined) result.failureError = err;
    consecutiveFailures++;
    if (consecutiveFailures >= SOURCE_TOPIC_BACKFILL_MAX_CONSECUTIVE_FAILURES) {
      result.stoppedByFailures = true;
      return true;
    }
    return false;
  };

  for (const sourceId of plan.sourceIds) {
    if (deps.signal?.aborted) {
      result.aborted = true;
      break;
    }
    let source: { title: string; text: string } | undefined;
    try {
      source = await deps.resolveSource(sourceId);
    } catch (err) {
      log("トピックの段: 資料を読めなかった:", sourceId, err);
      source = undefined;
    }
    if (!source || !source.text.trim()) {
      // 消えた資料・本文の無い資料。何度回しても同じなので控えに残す
      result.unreadable++;
      await settleSourceTopicBackfill(sourceId, { claims: deps.claimsOf(sourceId), reason: "unreadable" }, deps);
    } else {
      let stage: SourceTopicStageResult;
      const index = result.done + 1;
      const title = source.title;
      const report = (p: SourceTopicBackfillStageProgress) => {
        deps.onProgress?.({
          done: result.done,
          total: result.total,
          topicsTouched: result.topicsTouched,
          current: { index, title, phase: p.phase, written: p.written, planned: p.planned, windowIndex: p.windowIndex, windowTotal: p.windowTotal },
        });
      };
      // 段の待ち行列に入った時点で「読んでいる」を出す（段の最初の知らせが届くまで空白にしない）
      report({ phase: "reading", written: 0, planned: 0, windowIndex: 0, windowTotal: 1 });
      try {
        stage = await deps.runTopicStage({ id: sourceId, ...source }, deps.signal, report);
      } catch (err) {
        if (deps.signal?.aborted || isAbortError(err)) {
          result.aborted = true;
          break;
        }
        if (fail(err)) break;
        result.done++;
        deps.onProgress?.({ done: result.done, total: result.total, topicsTouched: result.topicsTouched });
        continue;
      }
      const touched = stage.created + stage.updated;
      result.topicsTouched += touched;
      result.created += stage.created;
      if (deps.signal?.aborted) {
        // 段の途中で止めた。できた分は残るが、この資料は終わっていないので控えに残さない
        result.aborted = true;
        break;
      }
      if (stage.failed > 0 && touched === 0) {
        if (fail(stage.failureError)) break;
      } else {
        consecutiveFailures = 0;
        if (touched === 0) {
          result.noTopic++;
          await settleSourceTopicBackfill(sourceId, { claims: deps.claimsOf(sourceId), reason: "no-topic" }, deps);
        }
      }
    }
    result.done++;
    deps.onProgress?.({ done: result.done, total: result.total, topicsTouched: result.topicsTouched });
  }
  return result;
}

/** 資料ごとの現役の知見の数（控えに残す値・計画の並び順に使う） */
export function countClaimsBySource(entries: SourceTopicBackfillEntry[]): Map<string, number> {
  return summarizeSources(entries).claimsBySource;
}
