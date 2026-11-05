// おまかせで整える — 点検結果から「AI に任せてよい手当て」を順に並べる（純粋関数）
//
// 手入れ画面の一覧で人が 1 件ずつ選んでいた手当てのうち、AI の判断がすでに具体的なもの
// （推奨どおりの統合・資料から作り直す・古いページへの併記）を拾う。どれも
// 「手入れの履歴」に残り、あとから取り消せる。
//
// 2026-11-05 決定: 矛盾と孤立も AI が手当てする。
// - 矛盾（2 ページが食い違う）は、どちらが正しいかを決めずに、両方のページへ相手の見方を
//   出典つきで書く（併記: reconcile）。割れていること自体を知識として残す
// - 古いページ（stale: 後から書かれたページに追い越された）は、追い越した側の見方を本文に
//   出典つきで書く（併記 1 回）。資料全文を窓ごとに書き直す全作り直しは長い資料で数十回の
//   呼び出しになるので、手動ボタンだけに残す
// - 孤立（出典も参照も無い知見・資料の無いトピック）はアーカイブする（取り消せる）
// - 穴（書かれていないこと）は欠陥ではなく「次に調べること」なので、未対応には数えない
//   （suggestedIssueIndices）。人が決めるものは残らない設計にする

import type { LintIssue, LintReport } from "../../server/services/wiki-linter";
import type { ReconcileConflict } from "./reconcile-types";

export type AutoTidyStep =
  /** 推奨（残す / 吸収）どおりの統合。topic 同士か atom 同士のときだけ */
  | { kind: "merge"; mergeKind: "topic" | "atom"; keepId: string; absorbId: string }
  /** 資料から作り直す（旧形式トピック・資料の一部が欠けたトピック） */
  | { kind: "rebuild"; wikiId: string }
  /** 矛盾する相手・追い越した相手の見方を本文に書く（併記）。1 ページに複数の相手があればまとめて 1 回 */
  | { kind: "reconcile"; wikiId: string; conflicts: ReconcileConflict[] }
  /** 孤立したページをアーカイブする */
  | { kind: "archive"; wikiId: string };

export type AutoTidyPlan = {
  steps: AutoTidyStep[];
  /** 手当てに回さなかった issue（report.issues の添字）。未対応として人に見せる */
  leftoverIssueIndices: number[];
  /** 直すものではなく、次に調べることとして見せる issue（穴）。未対応には数えない */
  suggestedIssueIndices: number[];
};

/**
 * 点検結果と旧形式トピックの一覧から、おまかせで行う手当てを決める。
 *
 * 並びは「統合 → 作り直し → 併記 → アーカイブ」。古いページ（stale）は併記に合流する。統合で吸収されたページはもう無いので、
 * 後ろの手当てからは外す。同じページを 2 度触らない（先に決めた手当てを優先）。
 */
export function planAutoTidy(
  report: LintReport | null,
  deps: {
    /** wikiId → kind。統合が同じ種類同士か（topic / atom）を見る */
    kindById: Map<string, string>;
    /** wikiId → title。併記で相手のタイトルを本文に書くために使う */
    titleById?: Map<string, string>;
    /** 旧形式（メンバー知見を持つ）トピックの id */
    legacyTopicIds?: string[];
    /** 統合の手当てが使えるか（AI 未設定などで使えないときは統合を拾わない） */
    canMergeTopics?: boolean;
    canMergeAtoms?: boolean;
    /**
     * 2 ページが互いに相手の見方を本文に書き終えているか（wikiMeta.reconciledWith が双方向にある）。
     * 機械判定の矛盾（conflictsWith）は点検のたびに同じ組を出すので、書き終えた組は手当ても未対応もしない
     */
    isReconciled?: (a: string, b: string) => boolean;
    /**
     * page の本文に other の見方を書き終えているか（wikiMeta.reconciledWith に other が入っている。片方向）。
     * 古いページ（stale）の併記は古い側だけを書き換えるので、書き終えた組は手当ても未対応もしない
     */
    hasWrittenOtherView?: (page: string, other: string) => boolean;
  },
): AutoTidyPlan {
  const issues = report?.issues ?? [];
  const merges: AutoTidyStep[] = [];
  const rebuilds: AutoTidyStep[] = [];
  const reconciles: AutoTidyStep[] = [];
  const archives: AutoTidyStep[] = [];
  // 何らかの手当てで触るページ（統合の両側を含む）
  const touched = new Set<string>();
  const handled = new Set<number>();
  const suggested = new Set<number>();

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

  // 3) 矛盾・古いページの併記。両側がまだ触られていないときだけ（作り直しのあとでは前提が変わる）。
  //    同じページが複数の相手に関わるときは 1 回の併記にまとめる（本文を 2 度書き換えない）
  const conflictsByPage = new Map<string, ReconcileConflict[]>();
  const titleOf = (id: string) => deps.titleById?.get(id) ?? id;
  const summaryOf = (issue: LintIssue) => [issue.title, issue.description].filter(Boolean).join(" — ");
  issues.forEach((issue, idx) => {
    if (issue.type !== "contradiction") return;
    const ids = issue.affectedWikiIds.filter((id, i, arr) => arr.indexOf(id) === i);
    if (ids.length !== 2) return;
    const [a, b] = ids;
    // 両方のページに相手の見方を書き終えている組は、割れていること自体が知識として残っている
    if (deps.isReconciled?.(a, b)) {
      handled.add(idx);
      return;
    }
    if ((touched.has(a) && !conflictsByPage.has(a)) || (touched.has(b) && !conflictsByPage.has(b))) return;
    const summary = summaryOf(issue);
    for (const [self, other] of [[a, b], [b, a]] as const) {
      const list = conflictsByPage.get(self) ?? [];
      list.push({ otherWikiId: other, otherTitle: titleOf(other), summary });
      conflictsByPage.set(self, list);
      touched.add(self);
    }
    handled.add(idx);
  });
  // 古いページ（stale）: affectedWikiIds は「古いページ、追い越した側…」の並び。古い側だけに書く
  issues.forEach((issue, idx) => {
    if (issue.type !== "stale") return;
    const ids = issue.affectedWikiIds.filter((id, i, arr) => arr.indexOf(id) === i);
    // 追い越した相手が分からなければ手当てしない（未対応のまま）
    if (ids.length < 2) return;
    const stale = ids[0];
    const newer = ids.slice(1);
    // 相手の見方を書き終えている（点検のたびに同じ組が出るので、手当ても未対応もしない）
    if (deps.hasWrittenOtherView && newer.every((n) => deps.hasWrittenOtherView!(stale, n))) {
      handled.add(idx);
      return;
    }
    // 他の手当て（統合・作り直し）で触るページが絡むときは、その手当てで様子が変わるので残す。
    // 併記に入っている古い側は、同じ併記にまとめるので触られていてもよい
    if ((touched.has(stale) && !conflictsByPage.has(stale)) || newer.some((n) => touched.has(n))) return;
    const summary = summaryOf(issue);
    const list = conflictsByPage.get(stale) ?? [];
    for (const n of newer) list.push({ otherWikiId: n, otherTitle: titleOf(n), summary, relation: "newer" });
    conflictsByPage.set(stale, list);
    // 追い越した側は書き換えないので touched にしない
    touched.add(stale);
    handled.add(idx);
  });
  for (const [wikiId, conflicts] of conflictsByPage) reconciles.push({ kind: "reconcile", wikiId, conflicts });

  // 4) 孤立のアーカイブ（他の手当てで触るページは、その手当てで様子が変わるので残す）
  issues.forEach((issue, idx) => {
    if (issue.type !== "orphan") return;
    const id = issue.affectedWikiIds[0];
    if (!id || touched.has(id)) return;
    archives.push({ kind: "archive", wikiId: id });
    touched.add(id);
    handled.add(idx);
  });

  // 5) 穴は直すものではない。次に調べることとして見せる
  issues.forEach((issue, idx) => {
    if (issue.type === "gap") suggested.add(idx);
  });

  const leftoverIssueIndices = issues.map((_, idx) => idx).filter((idx) => !handled.has(idx) && !suggested.has(idx));
  return {
    steps: [...merges, ...rebuilds, ...reconciles, ...archives],
    leftoverIssueIndices,
    suggestedIssueIndices: [...suggested],
  };
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

/** 手当て 1 件の結果（画面の「実行内容」の 1 行） */
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
  /** 手当てに回さず、未対応として残した issue の数 */
  leftoverCount: number;
  finishedAt: string;
  /** AI の点検が（一部でも）失敗し、機械判定だけで整えた */
  lintFailed?: boolean;
};

/** 進み具合（画面の表示用） */
export type AutoTidyProgress =
  | { phase: "checking" }
  | { phase: "fixing"; done: number; total: number };

/**
 * report を、手当てに回さなかった issue だけに絞る（summary も数え直す）。
 * 次に調べること（穴）も一覧には残す（未対応の件数は leftoverIssueIndices の側で数える）
 */
export function leftoverReport(report: LintReport, leftoverIssueIndices: number[], suggestedIssueIndices: number[] = []): LintReport {
  const keep = new Set([...leftoverIssueIndices, ...suggestedIssueIndices]);
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

/** 未対応の件数（穴は数えない。穴は「次に調べること」） */
export function countLeftoverIssues(report: LintReport | null): number {
  return (report?.issues ?? []).filter((i) => i.type !== "gap").length;
}
