// Asterism 向けの flat JSON 書き出し（純関数・isomorphic）。
// DOM / Date.now / localStorage に依存しない（MCP の Node 側からも共有する）。
// PROV-JSON-LD の書き出し（export-jsonld.ts）とは別物で、列名が RML との契約。

import type { FrameReviewState, FrameValue, WikiMeta } from "../../lib/document-types";
import type { AsterismSettings } from "../settings/store";
import { classifyVocabTerm } from "./asterism-link";

/** 条件・帰結・結果の 1 項目（span は出さない） */
export type AsterismRowValue = {
  item: string;
  item_iri?: string;
  comparator?: string;
  value?: string | number;
  unit?: string;
};

export type AsterismRow = {
  id: string;
  iri?: string;
  type: string | null;
  type_term: string | null;
  title: string;
  statement_form?: "instance" | "general";
  claim_role?: string[];
  epistemic_status?: string;
  trigger?: string[];
  action?: string;
  rationale?: string | null;
  rationale_rule?: string[];
  outcome?: string[];
  outcome_assessment?: "confirmed" | "refuted" | "inconclusive" | null;
  condition?: AsterismRowValue[];
  consequence?: AsterismRowValue[];
  feature_of_interest?: string;
  result?: AsterismRowValue[];
  evidence?: string[];
  review_state?: FrameReviewState;
  source_note?: string[];
  generated_at?: string;
  exported_at: string;
};

export type AsterismSkipReason = "not-claim" | "untyped" | "inferred";

export type AsterismExportOptions = {
  /** 型が無い知見も含める（type: null） */
  includeUntyped: boolean;
  /** review_state が inferred の知見も含める（既定 false） */
  includeInferred: boolean;
  /** ISO 8601。呼び出し側が渡す */
  exportedAt: string;
  /** derivedFromNotes から wiki id を除くための判定（未指定なら除かない） */
  isWikiId?: (id: string) => boolean;
};

/** 行に載せる文書側の情報（meta に無いもの） */
export type AsterismRowContext = {
  title?: string;
  isWikiId?: (id: string) => boolean;
};

/** CURIE の既知 prefix（sv: は設定の vocabBaseIri から作る） */
const KNOWN_PREFIXES: Record<string, string> = {
  sosa: "http://www.w3.org/ns/sosa/",
  prov: "http://www.w3.org/ns/prov#",
  qudt: "http://qudt.org/schema/qudt/",
  quantitykind: "http://qudt.org/vocab/quantitykind/",
};

/** 語（slug / CURIE / 完全 IRI）を完全 IRI に展開する。展開できなければ null */
export function expandVocabTerm(term: string, asterism: AsterismSettings): string | null {
  const v = (term ?? "").trim();
  switch (classifyVocabTerm(v)) {
    case "iri":
      return v;
    case "slug":
      return asterism.vocabBaseIri.trim() ? asterism.vocabBaseIri.trim() + v : null;
    case "curie": {
      const idx = v.indexOf(":");
      const prefix = v.slice(0, idx);
      const local = v.slice(idx + 1);
      if (prefix === "sv") {
        const base = asterism.vocabBaseIri.trim();
        return base ? base + local : null;
      }
      const ns = KNOWN_PREFIXES[prefix];
      return ns ? ns + local : null;
    }
    default:
      return null;
  }
}

const STATE_RANK: Record<FrameReviewState, number> = { inferred: 0, extracted: 1, confirmed: 2 };

/** 3 frame の中で最も低い確からしさ。frame が 1 つも無ければ undefined */
function lowestReviewState(meta: WikiMeta): FrameReviewState | undefined {
  const states = [
    meta.decisionFrame?.reviewState,
    meta.ruleFrame?.reviewState,
    meta.observationFrame?.reviewState,
  ].filter((s): s is FrameReviewState => !!s);
  if (states.length === 0) return undefined;
  return states.reduce((a, b) => (STATE_RANK[b] < STATE_RANK[a] ? b : a));
}

function toRowValue(v: FrameValue, asterism: AsterismSettings): AsterismRowValue {
  const out: AsterismRowValue = { item: v.item };
  if (v.itemIri) {
    // CURIE（quantitykind:Time 等）は完全 IRI に展開する。展開できない語は原文のまま残す
    const raw = v.itemIri.trim();
    out.item_iri = classifyVocabTerm(raw) === "curie" ? (expandVocabTerm(raw, asterism) ?? raw) : raw;
  }
  if (v.comparator) out.comparator = v.comparator;
  if (v.value !== undefined) out.value = v.value;
  if (v.unit) out.unit = v.unit;
  return out;
}

/** 1 知見を 1 行にする。claim 以外は null */
export function toAsterismRow(
  id: string,
  meta: WikiMeta,
  asterism: AsterismSettings,
  exportedAt: string,
  ctx: AsterismRowContext = {},
): AsterismRow | null {
  if (meta.kind !== "claim") return null;
  const typeTerm = meta.asterism?.typeSlug?.trim() || null;
  const row: AsterismRow = {
    id,
    type: typeTerm ? expandVocabTerm(typeTerm, asterism) : null,
    type_term: typeTerm,
    title: ctx.title ?? "",
    exported_at: exportedAt,
  };
  if (asterism.claimBaseIri) {
    // iri は id の直後に並べたいので作り直す
    const { id: _id, ...rest } = row;
    return finishRow({ id, iri: asterism.claimBaseIri + id, ...rest }, meta, ctx, asterism);
  }
  return finishRow(row, meta, ctx, asterism);
}

function finishRow(row: AsterismRow, meta: WikiMeta, ctx: AsterismRowContext, asterism: AsterismSettings): AsterismRow {
  if (meta.statementForm) row.statement_form = meta.statementForm;
  if (meta.claimRole && meta.claimRole.length > 0) row.claim_role = [...meta.claimRole];
  if (meta.epistemicStatus) row.epistemic_status = meta.epistemicStatus;

  const d = meta.decisionFrame;
  if (d) {
    row.trigger = [...d.triggerClaimIds];
    row.action = d.action;
    row.rationale = d.rationale;
    if (d.rationaleRuleIds && d.rationaleRuleIds.length > 0) row.rationale_rule = [...d.rationaleRuleIds];
    if (d.outcomeClaimIds && d.outcomeClaimIds.length > 0) row.outcome = [...d.outcomeClaimIds];
    if (d.outcomeAssessment !== undefined) row.outcome_assessment = d.outcomeAssessment;
  }
  const r = meta.ruleFrame;
  if (r) {
    row.condition = r.conditions.map((x) => toRowValue(x, asterism));
    row.consequence = r.consequences.map((x) => toRowValue(x, asterism));
    // mechanism は Graphium 内の自由文として残し、書き出さない
  }
  const o = meta.observationFrame;
  if (o) {
    if (o.featureOfInterest) row.feature_of_interest = o.featureOfInterest;
    row.result = o.results.map((x) => toRowValue(x, asterism));
  }

  const evidence = meta.asterism?.evidenceIris;
  if (evidence && evidence.length > 0) row.evidence = [...evidence];
  const state = lowestReviewState(meta);
  if (state) row.review_state = state;

  const sources = (meta.derivedFromNotes ?? []).filter((n) => !ctx.isWikiId?.(n));
  if (sources.length > 0) row.source_note = sources;
  if (meta.generatedAt) row.generated_at = meta.generatedAt;
  return row;
}

/** 対象を選んで行にする。除外した知見は理由つきで skipped に返す */
export function buildAsterismExport(
  items: { id: string; meta: WikiMeta; title?: string }[],
  asterism: AsterismSettings,
  opts: AsterismExportOptions,
): { rows: AsterismRow[]; skipped: { id: string; reason: AsterismSkipReason }[] } {
  const rows: AsterismRow[] = [];
  const skipped: { id: string; reason: AsterismSkipReason }[] = [];
  for (const { id, meta, title } of items) {
    if (meta.kind !== "claim") {
      skipped.push({ id, reason: "not-claim" });
      continue;
    }
    if (!opts.includeUntyped && !meta.asterism?.typeSlug?.trim()) {
      skipped.push({ id, reason: "untyped" });
      continue;
    }
    if (!opts.includeInferred && lowestReviewState(meta) === "inferred") {
      skipped.push({ id, reason: "inferred" });
      continue;
    }
    const row = toAsterismRow(id, meta, asterism, opts.exportedAt, { title, isWikiId: opts.isWikiId });
    if (row) rows.push(row);
  }
  return { rows, skipped };
}

/** 2 スペースインデントの JSON にする */
export function serializeAsterismExport(rows: AsterismRow[]): string {
  return JSON.stringify(rows, null, 2);
}
