// おまかせで整える（出典照合の側）— 照合で「要確認」になったページの手当てを決める（純関数）。
//
// 2026-11-04 決定: 要確認（出典と異なる・出典に見当たらない）を人に 1 件ずつ選ばせず、AI が直す。
// - どの出典にも裏づけられていない文があるとき: 知見（claim）は 1 主張 = 1 ページなので
//   アーカイブし、要約は資料から作り直してもう一度照合する
// - 2026-11-05 決定: トピック・問答は資料から作り直さず、裏づけの無い文だけを 1 回の呼び出しで直す
//   （revise: 出典と異なる文は出典の引用に合わせて書き換え、見当たらない文は外す）。
//   作り直しは資料を窓ごとに読むので長い PDF 1 本で数十回の呼び出しになり、
//   おまかせの 130 件が数時間になった（2026-11-05 の実測）。文の単位で直せば 1 件 1 回で済む
// - 2026-11-05 決定: 裏づける出典と食い違う出典が両方あるもの（資料どうしで割れている）は、
//   どちらが正しいかを決めずに両方の側を出典つきで本文に書く（併記: reconcile）。
//   割れていること自体が知識なので、未対応の一覧に積まない
// どれも 1 つの実行に記録し、手入れの履歴から取り消せる。
// 人が「確認した」（dismissed）ものは直さない（人の判断を上書きしない）。

import type { SourceCheckProfile } from "../../lib/document-types";
import { hasDisagreement } from "./disagreements";
import { NEEDS_REVIEW_VERDICT_ORDER, isNeedsReviewVerdict, type NeedsReviewEntry } from "./needs-review";

export type SourceCheckFixStep =
  | { kind: "archive"; wikiId: string; title: string }
  /** 資料から作り直す（要約だけ。資料 1 つから 1 回の呼び出し） */
  | { kind: "rewrite"; wikiId: string; title: string }
  /** 裏づけの無い文だけを 1 回で直す（トピック・問答）。実行時に保存済みの判定から文を組む */
  | { kind: "revise"; wikiId: string; title: string }
  /** 食い違う出典の側も本文に書く。実行時に保存済みの判定から食い違いを組む */
  | { kind: "reconcile"; wikiId: string; title: string };

/** 手当ての対象。fix はどの手当てか（裏づけ無し → アーカイブ / 文の直し / 作り直し、割れている → 併記） */
export type SourceCheckFixTarget = NeedsReviewEntry & { fix: "unbacked" | "disagree" };

export type AutoSourceCheckDone = {
  step: SourceCheckFixStep;
  /** 手当て自体が済んだか（アーカイブできた・作り直せた） */
  ok: boolean;
  /** 作り直し・併記のあとの照合でも、まだ出典と合わない文が残った */
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
 * どこかの文が、どの出典にも裏づけられていないか（アーカイブ・作り直しでよい要確認か）。
 * 知見は出典が増えていくので、9 件が裏づけて 1 件が食い違うこともある。まとめた判定は
 * 「出典と異なる」になるが、それは資料どうしで割れているだけなので、作り直しではなく
 * 併記（hasDisagreement）に回す。文の区切りはトピックの statementBlockId / statement（知見は文が 1 つ）。
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

/** 判定の中身から手当てを決める。裏づけの無い文があれば作り直し、割れているだけなら併記、どちらでもなければ無し */
export function fixKindOf(profile: SourceCheckProfile): SourceCheckFixTarget["fix"] | null {
  if (hasUnbackedStatement(profile)) return "unbacked";
  if (hasDisagreement(profile)) return "disagree";
  return null;
}

/**
 * 手当ての対象を集める。照合する前から要確認だったもの（before: 一覧向けミラーから作った一覧）に、
 * 今回の照合結果（fresh）を重ねる。今回照合したページは今回の結果だけで決める
 * （前は要確認でも、今回の照合で出典に書かれていると分かったものは直さない）。
 * 判定の中身（profileOf: 前から要確認だったものの保存済みの判定）で手当てを決める（fixKindOf）。
 * 中身が読めないものは直さない。
 */
export function collectSourceCheckFixTargets(
  before: NeedsReviewEntry[],
  fresh: Map<string, SourceCheckProfile>,
  metaOf: (id: string) => MetaLike | undefined,
  profileOf: (id: string) => SourceCheckProfile | undefined = () => undefined,
): SourceCheckFixTarget[] {
  const byId = new Map<string, SourceCheckFixTarget>();
  for (const e of before) {
    if (fresh.has(e.id)) continue;
    const profile = profileOf(e.id);
    const fix = profile ? fixKindOf(profile) : null;
    if (fix) byId.set(e.id, { ...e, fix });
  }
  for (const [id, profile] of fresh) {
    if (!isNeedsReviewVerdict(profile)) continue;
    const fix = fixKindOf(profile);
    if (!fix) continue;
    const meta = metaOf(id);
    const kind = meta?.kind;
    if (kind !== "claim" && kind !== "topic" && kind !== "answer" && kind !== "summary") continue;
    byId.set(id, { id, title: meta?.title ?? id, kind, verdict: profile.verdict as NeedsReviewEntry["verdict"], fix });
  }
  return [...byId.values()].sort((a, b) => {
    const rank = NEEDS_REVIEW_VERDICT_ORDER.indexOf(a.verdict) - NEEDS_REVIEW_VERDICT_ORDER.indexOf(b.verdict);
    return rank !== 0 ? rank : a.title.localeCompare(b.title, "ja");
  });
}

/** 対象ごとの手当て。並びは対象の順のまま（出典と異なる → 見当たらない） */
export function planSourceCheckFixes(targets: SourceCheckFixTarget[]): SourceCheckFixStep[] {
  return targets.map((e) =>
    e.fix === "disagree"
      ? { kind: "reconcile", wikiId: e.id, title: e.title }
      : e.kind === "claim"
        ? { kind: "archive", wikiId: e.id, title: e.title }
        : e.kind === "summary"
          ? { kind: "rewrite", wikiId: e.id, title: e.title }
          : { kind: "revise", wikiId: e.id, title: e.title },
  );
}

/** 手当てのあとの照合で、まだ手当てが要る状態か（裏づけの無い文・割れている文が残っている） */
export function stillNeedsFix(profile: SourceCheckProfile | undefined): boolean {
  return Boolean(profile && isNeedsReviewVerdict(profile) && fixKindOf(profile) !== null);
}
