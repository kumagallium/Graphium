// frame（判断・規則・観測）の差し替え規則。regenerate / merge / 補完の 3 経路が共通で呼ぶ純関数。
// 規則の出典: docs/internal/handoff_to_claude_code_judgment_rule_frames.md §5.5

import type { DecisionFrame, WikiMeta } from "../../lib/document-types";

/** いずれかの frame（decision / rule / observation）を持つか。WikiMetaSummary.hasFrames の算出に使う */
export function hasAnyFrame(wikiMeta: WikiMeta | undefined | null): boolean {
  return !!(wikiMeta?.decisionFrame || wikiMeta?.ruleFrame || wikiMeta?.observationFrame);
}

/** null / undefined / 空配列 / 空文字を「空」とみなす */
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

type Reviewable = { reviewState: "extracted" | "inferred" | "confirmed" };

/**
 * frame 1 種の一般規則（b・d・f）。a・c は呼び出し側で上乗せする。
 * - existing 無し → incoming（f）／ incoming 無し → existing
 * - existing が confirmed → 空の欄だけ incoming で埋める（b）
 * - incoming が inferred で existing が extracted → existing（d）
 * - それ以外 → incoming
 */
function mergeOne<T extends Reviewable>(existing: T | undefined, incoming: T | undefined): T | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing.reviewState === "confirmed") {
    const out: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
      if (k === "reviewState") continue;
      if (isEmpty(out[k]) && !isEmpty(v)) out[k] = v;
    }
    out.reviewState = "confirmed";
    return out as T;
  }
  if (existing.reviewState === "extracted" && incoming.reviewState === "inferred") return existing;
  return incoming;
}

/**
 * existing の frame 群を規則に従って incoming に引き継ぐ。
 * frame 群以外の欄は incoming をそのまま返す（claimRole のみ規則 e で補う）。
 */
export function mergeFrame(existing: WikiMeta | undefined, incoming: WikiMeta): WikiMeta {
  if (!existing) return incoming;
  const out: WikiMeta = { ...incoming };

  // 規則 a: asterism は常に既存を保持
  const asterism = existing.asterism ?? incoming.asterism;
  if (asterism) out.asterism = asterism;
  else delete out.asterism;

  // decisionFrame: 一般規則 + a（outcome 系・人が書いた理由は既存保持）+ c（id 配列は incoming が空なら既存）
  const ex = existing.decisionFrame;
  const inc = incoming.decisionFrame;
  let decision = mergeOne<DecisionFrame>(ex, inc);
  if (decision && ex) {
    decision = { ...decision };
    // 規則 a: 人が書いた理由は incoming が何であっても（null でも）既存を保持する
    if (ex.rationaleBy === "human") {
      decision.rationale = ex.rationale;
      decision.rationaleBy = "human";
    }
    if (ex.outcomeClaimIds !== undefined) decision.outcomeClaimIds = ex.outcomeClaimIds;
    if (ex.outcomeAssessment !== undefined) decision.outcomeAssessment = ex.outcomeAssessment;
    if (isEmpty(decision.triggerClaimIds)) decision.triggerClaimIds = ex.triggerClaimIds ?? [];
    if (isEmpty(decision.rationaleRuleIds) && !isEmpty(ex.rationaleRuleIds)) {
      decision.rationaleRuleIds = ex.rationaleRuleIds;
    }
  }
  if (decision) out.decisionFrame = decision;
  else delete out.decisionFrame;

  const rule = mergeOne(existing.ruleFrame, incoming.ruleFrame);
  if (rule) out.ruleFrame = rule;
  else delete out.ruleFrame;

  const obs = mergeOne(existing.observationFrame, incoming.observationFrame);
  if (obs) out.observationFrame = obs;
  else delete out.observationFrame;

  // 規則 e: 判断フレームが残るなら claimRole に decision を保証する（confirmed に限らない）
  if (out.decisionFrame && !(out.claimRole ?? []).includes("decision")) {
    out.claimRole = [...(out.claimRole ?? []), "decision"];
  }

  // statementForm は frame 群が決まった後に導出する: rule があれば general、無く observation があれば instance、
  // どちらも無ければ incoming 優先で既存へフォールバック
  const form = out.ruleFrame
    ? "general"
    : out.observationFrame
      ? "instance"
      : (incoming.statementForm ?? existing.statementForm);
  if (form) out.statementForm = form;
  else delete out.statementForm;

  return out;
}
