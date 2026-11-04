// おまかせで照合する — 照合で「要確認」になったページの手当てを決める（純関数）。
//
// 2026-11-04 決定: 要確認（出典と異なる・出典に見当たらない）を人に 1 件ずつ選ばせず、AI が直す。
// - 直すのは、どの出典にも裏づけられていない文があるときだけ。裏づける出典と食い違う出典が
//   両方あるもの（資料どうしで意見が割れている）は、どちらが正しいかを人が決めるので残す
// - 知見（claim）は 1 主張 = 1 ページなので、出典が裏づけないならアーカイブする
// - トピック・回答・要約は資料から作り直し、もう一度照合する（直りきらなければ残す）
// どちらも 1 つの実行（auto_source_check）に記録し、操作の記録から取り消せる。
// 人が「確認した」（dismissed）ものは直さない（人の判断を上書きしない）。

import type { SourceCheckProfile } from "../../lib/document-types";
import { NEEDS_REVIEW_VERDICT_ORDER, isNeedsReviewVerdict, type NeedsReviewEntry } from "./needs-review";

export type SourceCheckFixStep =
  | { kind: "archive"; wikiId: string; title: string }
  | { kind: "rewrite"; wikiId: string; title: string };

export type AutoSourceCheckDone = {
  step: SourceCheckFixStep;
  /** 手当て自体が済んだか（アーカイブできた・作り直せた） */
  ok: boolean;
  /** 作り直したあとの照合でも、まだ出典と合わない文が残った */
  stillFlagged?: boolean;
};

export type AutoSourceCheckResult = {
  /** 今回照合したページの数 */
  checkedCount: number;
  done: AutoSourceCheckDone[];
  /** 照合を途中で止めた（中断）。このときは直さない */
  interrupted?: boolean;
  finishedAt: string;
};

export type AutoSourceCheckProgress =
  | { phase: "checking"; index: number; total: number }
  | { phase: "fixing"; done: number; total: number };

/** 手当てが最後まで済んだか（作り直したのにまだ合わないものは数えない） */
export function isFixed(d: AutoSourceCheckDone): boolean {
  return d.ok && !d.stillFlagged;
}

type MetaLike = { kind?: string; title?: string };

/**
 * どこかの文が、どの出典にも裏づけられていないか（直してよい要確認か）。
 * 知見は出典が増えていくので、9 件が裏づけて 1 件が食い違うこともある。まとめた判定は
 * 「出典と異なる」になるが、それは資料どうしの意見が割れているだけで、どちらが正しいかは
 * 人が決める（点検の「矛盾」と同じ扱い）。おまかせが直すのは、裏づける出典が 1 つも無い文が
 * あるときだけにする。文の区切りはトピックの statementBlockId / statement（知見は文が 1 つ）。
 */
export function hasUnbackedStatement(profile: SourceCheckProfile): boolean {
  const byStatement = new Map<string, SourceCheckProfile["entries"]>();
  for (const e of profile.entries) {
    const key = e.statementBlockId ?? e.statement ?? "";
    const list = byStatement.get(key) ?? [];
    list.push(e);
    byStatement.set(key, list);
  }
  for (const entries of byStatement.values()) {
    const backed = entries.some((e) => e.verdict === "supported");
    const flagged = entries.some((e) => e.verdict === "contradicted" || e.verdict === "not-in-source");
    if (flagged && !backed) return true;
  }
  return false;
}

/**
 * 手当ての対象を集める。照合する前から要確認だったもの（before: 一覧向けミラーから作った一覧）に、
 * 今回の照合結果（fresh）を重ねる。今回照合したページは今回の結果だけで決める
 * （前は要確認でも、今回の照合で出典に書かれていると分かったものは直さない）。
 * 判定の中身（profileOf: 前から要確認だったものの保存済みの判定）を見て、資料どうしで
 * 意見が割れているだけのものは外す（hasUnbackedStatement）。中身が読めないものも直さない。
 */
export function collectSourceCheckFixTargets(
  before: NeedsReviewEntry[],
  fresh: Map<string, SourceCheckProfile>,
  metaOf: (id: string) => MetaLike | undefined,
  profileOf: (id: string) => SourceCheckProfile | undefined = () => undefined,
): NeedsReviewEntry[] {
  const byId = new Map<string, NeedsReviewEntry>();
  for (const e of before) {
    if (fresh.has(e.id)) continue;
    const profile = profileOf(e.id);
    if (profile && hasUnbackedStatement(profile)) byId.set(e.id, e);
  }
  for (const [id, profile] of fresh) {
    if (!isNeedsReviewVerdict(profile) || !hasUnbackedStatement(profile)) continue;
    const meta = metaOf(id);
    const kind = meta?.kind;
    if (kind !== "claim" && kind !== "topic" && kind !== "answer" && kind !== "summary") continue;
    byId.set(id, { id, title: meta?.title ?? id, kind, verdict: profile.verdict as NeedsReviewEntry["verdict"] });
  }
  return [...byId.values()].sort((a, b) => {
    const rank = NEEDS_REVIEW_VERDICT_ORDER.indexOf(a.verdict) - NEEDS_REVIEW_VERDICT_ORDER.indexOf(b.verdict);
    return rank !== 0 ? rank : a.title.localeCompare(b.title, "ja");
  });
}

/** 対象ごとの手当て。並びは対象の順のまま（出典と異なる → 見当たらない） */
export function planSourceCheckFixes(targets: NeedsReviewEntry[]): SourceCheckFixStep[] {
  return targets.map((e) =>
    e.kind === "claim"
      ? { kind: "archive", wikiId: e.id, title: e.title }
      : { kind: "rewrite", wikiId: e.id, title: e.title },
  );
}
