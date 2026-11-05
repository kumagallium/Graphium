// 出典照合の判定から「資料どうしの食い違い」を取り出す。
// 同じ文を裏づける出典と食い違う出典が両方あるものだけを数える
// （裏づけが 1 つも無い「出典と異なる」は併記の対象ではない）。
// 束ね方は auto-fix.ts の hasUnbackedStatement と同じ（statementBlockId ?? statement ?? ""）。

import type { SourceCheckEntry, SourceCheckProfile } from "../../lib/document-types";
import type { ReconcileDisagreement, ReconcileSide, ReconcileUnbacked } from "../wiki/reconcile-types";

/** 文ごとに判定を束ねる */
function groupByStatement(profile: SourceCheckProfile): Map<string, SourceCheckEntry[]> {
  const byStatement = new Map<string, SourceCheckEntry[]>();
  for (const e of profile.entries) {
    const key = e.statementBlockId ?? e.statement ?? "";
    const list = byStatement.get(key) ?? [];
    list.push(e);
    byStatement.set(key, list);
  }
  return byStatement;
}

/** 同じ文を裏づける出典と食い違う出典が両方あるか */
export function hasDisagreement(profile: SourceCheckProfile): boolean {
  for (const entries of groupByStatement(profile).values()) {
    if (entries.some((e) => e.verdict === "supported") && entries.some((e) => e.verdict === "contradicted")) {
      return true;
    }
  }
  return false;
}

/**
 * 文ごとに、supported と contradicted が両方ある束を食い違いにする。
 * sourceTitle は titleOf(sourceId) ?? sourceId。quote / rationale はあるものだけ入れる。
 */
export function buildDisagreements(
  profile: SourceCheckProfile,
  titleOf: (sourceId: string) => string | undefined,
): ReconcileDisagreement[] {
  const toSide = sideBuilder(titleOf);
  const result: ReconcileDisagreement[] = [];
  for (const entries of groupByStatement(profile).values()) {
    const supporting = entries.filter((e) => e.verdict === "supported");
    const contradicting = entries.filter((e) => e.verdict === "contradicted");
    if (supporting.length === 0 || contradicting.length === 0) continue;
    const statement = entries.find((e) => e.statement)?.statement;
    result.push({
      ...(statement ? { statement } : {}),
      supporting: supporting.map(toSide),
      contradicting: contradicting.map(toSide),
    });
  }
  return result;
}

function sideBuilder(titleOf: (sourceId: string) => string | undefined): (e: SourceCheckEntry) => ReconcileSide {
  return (e) => ({
    sourceId: e.sourceId,
    sourceTitle: titleOf(e.sourceId) ?? e.sourceId,
    ...(e.quote ? { quote: e.quote } : {}),
    ...(e.rationale ? { rationale: e.rationale } : {}),
  });
}

/**
 * 文ごとに、どの出典も裏づけず（supported 無し）、食い違う・見当たらない判定がある束を
 * 「裏づけの無い文」にする（auto-fix.ts の hasUnbackedStatement と同じ条件）。
 * 食い違う出典が 1 つでもあれば "contradicted"（出典の引用に合わせて書き換える）、
 * 無ければ "not-in-source"（文を外す）。sources は食い違う・見当たらないと判定した出典だけ
 * （unclear / source-missing は手がかりにならないので渡さない）。
 */
export function buildUnbacked(
  profile: SourceCheckProfile,
  titleOf: (sourceId: string) => string | undefined,
): ReconcileUnbacked[] {
  const toSide = sideBuilder(titleOf);
  const result: ReconcileUnbacked[] = [];
  for (const entries of groupByStatement(profile).values()) {
    if (entries.some((e) => e.verdict === "supported")) continue;
    const flagged = entries.filter((e) => e.verdict === "contradicted" || e.verdict === "not-in-source");
    if (flagged.length === 0) continue;
    const statement = entries.find((e) => e.statement)?.statement;
    result.push({
      ...(statement ? { statement } : {}),
      verdict: flagged.some((e) => e.verdict === "contradicted") ? "contradicted" : "not-in-source",
      sources: flagged.map(toSide),
    });
  }
  return result;
}
