// おまかせで整える — 点検結果から「AI に任せてよい手当て」を順に並べる（純粋関数）
//
// 手入れ画面の一覧で人が 1 件ずつ選んでいた手当てのうち、AI の判断がすでに具体的なもの
// （推奨どおりの統合・資料から作り直す・古いページの再生成）だけを拾う。どれも
// 「操作の記録」に残り、あとから取り消せる。
// 矛盾・孤立・知識の穴など、どちらが正しいか／消してよいかを人が決めるものは拾わず、
// 「見るとよいもの」として残す（leftoverIssueIndices）。

import type { LintIssue, LintReport } from "../../server/services/wiki-linter";

export type AutoTidyStep =
  /** 推奨（残す / 吸収）どおりの統合。topic 同士か atom 同士のときだけ */
  | { kind: "merge"; mergeKind: "topic" | "atom"; keepId: string; absorbId: string }
  /** 資料から作り直す（旧形式トピック・資料の一部が欠けたトピック） */
  | { kind: "rebuild"; wikiId: string }
  /** 後から追い越された古いページを再生成する */
  | { kind: "regenerate"; wikiId: string };

export type AutoTidyPlan = {
  steps: AutoTidyStep[];
  /** 手当てに回さなかった issue（report.issues の添字）。人が見るとよいもの */
  leftoverIssueIndices: number[];
};

/**
 * 点検結果と旧形式トピックの一覧から、おまかせで行う手当てを決める。
 *
 * 並びは「統合 → 作り直し → 再生成」。統合で吸収されたページはもう無いので、
 * 後ろの作り直し・再生成からは外す。同じページを 2 度触らない（先に決めた手当てを優先）。
 */
export function planAutoTidy(
  report: LintReport | null,
  deps: {
    /** wikiId → kind。統合が同じ種類同士か（topic / atom）を見る */
    kindById: Map<string, string>;
    /** 旧形式（メンバー知見を持つ）トピックの id */
    legacyTopicIds?: string[];
    /** 統合の手当てが使えるか（AI 未設定などで使えないときは統合を拾わない） */
    canMergeTopics?: boolean;
    canMergeAtoms?: boolean;
  },
): AutoTidyPlan {
  const issues = report?.issues ?? [];
  const merges: AutoTidyStep[] = [];
  const rebuilds: AutoTidyStep[] = [];
  const regenerates: AutoTidyStep[] = [];
  // 何らかの手当てで触るページ（統合の両側を含む）
  const touched = new Set<string>();
  const handled = new Set<number>();

  // 1) 統合（先に決める。吸収されたページは後ろの手当てから外れる）
  issues.forEach((issue, idx) => {
    const kind = mergeKindOf(issue, deps);
    const rec = issue.recommendedAction;
    if (!kind || rec?.type !== "merge") return;
    // A←B のあとの B←C は、B がもう無いので推奨の前提が崩れている（手入れ画面の一括統合と同じ扱い）
    if (touched.has(rec.keepId) || touched.has(rec.absorbId)) return;
    merges.push({ kind: "merge", mergeKind: kind, keepId: rec.keepId, absorbId: rec.absorbId });
    touched.add(rec.keepId);
    touched.add(rec.absorbId);
    handled.add(idx);
  });

  // 2) 資料から作り直す（旧形式トピック → 資料の欠けたトピック）
  const pushRebuild = (wikiId: string): boolean => {
    if (touched.has(wikiId)) return false;
    rebuilds.push({ kind: "rebuild", wikiId });
    touched.add(wikiId);
    return true;
  };
  for (const id of deps.legacyTopicIds ?? []) pushRebuild(id);
  issues.forEach((issue, idx) => {
    if (issue.type !== "missing-source") return;
    const id = issue.affectedWikiIds[0];
    if (!id) return;
    // 既に作り直しに入っている（旧形式でもある）なら、それで手当て済み
    if (pushRebuild(id) || rebuilds.some((s) => s.kind === "rebuild" && s.wikiId === id)) handled.add(idx);
  });

  // 3) 古いページの再生成
  issues.forEach((issue, idx) => {
    if (issue.type !== "stale") return;
    const targets = issue.affectedWikiIds.filter((id) => !touched.has(id));
    // 全部が他の手当てで触られている（統合で吸収済み等）なら、手当て済みとみなす
    if (targets.length === 0) {
      if (issue.affectedWikiIds.length > 0) handled.add(idx);
      return;
    }
    for (const id of targets) {
      regenerates.push({ kind: "regenerate", wikiId: id });
      touched.add(id);
    }
    handled.add(idx);
  });

  const leftoverIssueIndices = issues.map((_, idx) => idx).filter((idx) => !handled.has(idx));
  return { steps: [...merges, ...rebuilds, ...regenerates], leftoverIssueIndices };
}

function mergeKindOf(
  issue: LintIssue,
  deps: { kindById: Map<string, string>; canMergeTopics?: boolean; canMergeAtoms?: boolean },
): "topic" | "atom" | null {
  if (issue.type !== "redundant") return null;
  const rec = issue.recommendedAction;
  if (rec?.type !== "merge" || rec.keepId === rec.absorbId) return null;
  const keepKind = deps.kindById.get(rec.keepId);
  const absorbKind = deps.kindById.get(rec.absorbId);
  if (!keepKind || keepKind !== absorbKind) return null;
  if (keepKind === "topic" && deps.canMergeTopics !== false) return "topic";
  if (keepKind === "atom" && deps.canMergeAtoms !== false) return "atom";
  return null;
}

/** 手当て 1 件の結果（画面の「整えたこと」の 1 行） */
export type AutoTidyDone = {
  step: AutoTidyStep;
  /** 表示用のタイトル（統合は残す側） */
  title: string;
  /** 統合で吸収した側のタイトル */
  absorbedTitle?: string;
  ok: boolean;
};

/** おまかせの 1 回分の結果 */
export type AutoTidyResult = {
  done: AutoTidyDone[];
  /** 手当てに回さず、人が見るとよい issue の数（矛盾・孤立など） */
  leftoverCount: number;
  finishedAt: string;
  /** AI の点検が（一部でも）失敗し、機械判定だけで整えた */
  lintFailed?: boolean;
};

/** 進み具合（画面の表示用） */
export type AutoTidyProgress =
  | { phase: "checking" }
  | { phase: "fixing"; done: number; total: number };

/** report を、手当てに回さなかった issue だけに絞る（summary も数え直す） */
export function leftoverReport(report: LintReport, leftoverIssueIndices: number[]): LintReport {
  const keep = new Set(leftoverIssueIndices);
  const issues = report.issues.filter((_, idx) => keep.has(idx));
  const count = (type: LintIssue["type"]) => issues.filter((i) => i.type === type).length;
  return {
    ...report,
    issues,
    summary: {
      total: issues.length,
      contradictions: count("contradiction"),
      orphans: count("orphan"),
      gaps: count("gap"),
      stale: count("stale"),
      redundant: count("redundant"),
      missingSource: count("missing-source"),
    },
  };
}
