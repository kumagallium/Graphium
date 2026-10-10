// Asterism 向けの書き出し（純関数・isomorphic）。
// 型ごとのファイル + 入れ子を 1 行 1 項目に開いた子ファイルの「束（bundle）」を作る。
// DOM / Date.now / localStorage に依存しない（MCP の Node 側からも共有する）。
// PROV-JSON-LD の書き出し（export-jsonld.ts）とは別物で、列名が RML との契約。

import type { FrameReviewState, FrameValue, WikiMeta } from "../../lib/document-types";
import type { AsterismSettings } from "../settings/store";
import { classifyVocabTerm } from "./asterism-link";

/** 子ファイルの 1 項目（span は出さない）。キーは常に全て出し、無ければ null */
type TermFields = {
  position: number;
  item: string;
  item_iri: string | null;
  comparator: string | null;
  /** FrameValue.value が有限の number のときだけ。それ以外は null */
  value_number: number | null;
  /** FrameValue.value が string のときだけ（数字に見えても数値へ変換しない）。それ以外は null */
  value_text: string | null;
  unit: string | null;
};

/** rule_terms.json の行（キー順は固定） */
export type AsterismRuleTerm = {
  rule_id: string;
  rule_iri: string;
  role: "condition" | "consequence";
} & TermFields;

/** observation_terms.json の行（キー順は固定） */
export type AsterismObservationTerm = {
  observation_id: string;
  observation_iri: string;
} & TermFields;

/**
 * 親ファイル（judgments / rules / observations / interpretations / untyped）の行。
 * 全ファイル共通の同じキー集合・同じ順序を全行に出す（省略しない）。
 * 配列の列は空なら []、それ以外は無ければ null
 */
export type AsterismClaimRow = {
  id: string;
  iri: string;
  /** 型の完全 IRI（来歴）。型が無い・展開できないときは null */
  type: string | null;
  type_term: string | null;
  title: string;
  statement_form: "instance" | "general" | null;
  claim_role: string[];
  epistemic_status: string | null;
  trigger_iri: string[];
  action: string | null;
  rationale: string | null;
  rationale_rule_iri: string[];
  outcome_iri: string[];
  outcome_assessment: "confirmed" | "refuted" | "inconclusive" | null;
  feature_of_interest: string | null;
  evidence: string[];
  review_state: FrameReviewState | null;
  source_note: string[];
  generated_at: string | null;
  exported_at: string;
};

export type AsterismBundleFileName =
  | "judgments.json"
  | "rules.json"
  | "observations.json"
  | "interpretations.json"
  | "untyped.json"
  | "rule_terms.json"
  | "observation_terms.json";

export type AsterismBundle = {
  /** ファイル名 → 行の配列（0 件のファイルは含めない） */
  files: Record<string, object[]>;
  /** ファイル名 → 行数 */
  counts: Record<string, number>;
  skipped: { id: string; reason: AsterismSkipReason }[];
};

/** unknown-type: 型の語が設定の 4 語のどれにも一致しない */
export type AsterismSkipReason = "not-claim" | "untyped" | "inferred" | "unknown-type";

export type AsterismExportOptions = {
  /** 型が無い知見も含める（untyped.json） */
  includeUntyped: boolean;
  /** review_state が inferred の知見も含める（既定 false） */
  includeInferred: boolean;
  /** ISO 8601。呼び出し側が渡す */
  exportedAt: string;
  /** derivedFromNotes から wiki id を除くための判定（未指定なら除かない） */
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

function toTerm(v: FrameValue, position: number, asterism: AsterismSettings): TermFields {
  // CURIE（quantitykind:Time 等）は完全 IRI に展開する。展開できない語は原文のまま残す
  const raw = v.itemIri?.trim();
  const itemIri = raw ? (classifyVocabTerm(raw) === "curie" ? (expandVocabTerm(raw, asterism) ?? raw) : raw) : null;
  return {
    position,
    item: v.item,
    item_iri: itemIri,
    comparator: v.comparator ? v.comparator : null,
    value_number: typeof v.value === "number" && Number.isFinite(v.value) ? v.value : null,
    value_text: typeof v.value === "string" ? v.value : null,
    unit: v.unit ? v.unit : null,
  };
}

/** 完全 IRI として使える要素だけ残す（空白を含む・http(s) でないものは捨てる） */
function validIris(xs: readonly unknown[] | undefined): string[] {
  return (xs ?? []).filter(
    (x): x is string => typeof x === "string" && /^https?:\/\/\S+$/i.test(x) && !/\s/.test(x),
  );
}

type TypeBucket = "judgments.json" | "rules.json" | "observations.json" | "interpretations.json";

/** type_term を設定の 4 語と文字列比較する。同じ語が複数あれば judgment → rule → interpretation → observation の先勝ち */
function bucketOf(typeTerm: string, asterism: AsterismSettings): TypeBucket | null {
  const s = asterism.typeSlugs;
  const order: [string, TypeBucket][] = [
    [s.judgment, "judgments.json"],
    [s.rule, "rules.json"],
    [s.interpretation, "interpretations.json"],
    [s.observation, "observations.json"],
  ];
  for (const [term, file] of order) {
    if (term?.trim() && term.trim() === typeTerm) return file;
  }
  return null;
}

function toClaimRow(
  id: string,
  meta: WikiMeta,
  title: string,
  typeTerm: string | null,
  asterism: AsterismSettings,
  base: string,
  opts: AsterismExportOptions,
): AsterismClaimRow {
  const ref = (ids: readonly string[] | undefined) => (ids ?? []).map((x) => base + x);
  const d = meta.decisionFrame;
  // 条件・帰結・結果は子ファイルへ。mechanism / span は出さない
  const sources = (meta.derivedFromNotes ?? []).filter((n) => !opts.isWikiId?.(n));
  // 全キーを持つリテラルで作る（キー集合と順序を固定。条件付きで代入しない）
  return {
    id,
    iri: base + id,
    type: typeTerm ? expandVocabTerm(typeTerm, asterism) : null,
    type_term: typeTerm,
    title,
    statement_form: meta.statementForm ?? null,
    claim_role: [...(meta.claimRole ?? [])],
    epistemic_status: meta.epistemicStatus ?? null,
    trigger_iri: ref(d?.triggerClaimIds),
    action: d ? d.action : null,
    rationale: d?.rationale ?? null,
    rationale_rule_iri: ref(d?.rationaleRuleIds),
    outcome_iri: ref(d?.outcomeClaimIds),
    outcome_assessment: d?.outcomeAssessment ?? null,
    feature_of_interest: meta.observationFrame?.featureOfInterest || null,
    evidence: validIris(meta.asterism?.evidenceIris),
    review_state: lowestReviewState(meta) ?? null,
    source_note: sources,
    generated_at: meta.generatedAt || null,
    exported_at: opts.exportedAt,
  };
}

/**
 * 知見の基底 IRI を正規化する。空・空白を含む・http(s) でない場合は null（書き出し不可）。
 * 末尾が "/" か "#" でなければ "/" を補う（"…/claim" + "claim-1" が "…/claimclaim-1" になる事故を防ぐ）
 */
export function normalizeClaimBaseIri(raw: string | undefined): string | null {
  const base = (raw ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(base)) return null;
  return /[/#]$/.test(base) ? base : `${base}/`;
}

/** 対象を選んで束にする。claimBaseIri が空ならエラー。除外した知見は理由つきで skipped に返す */
export function buildAsterismBundle(
  items: { id: string; meta: WikiMeta; title?: string }[],
  asterism: AsterismSettings,
  opts: AsterismExportOptions,
): AsterismBundle | { error: "claim-base-iri-required" } {
  const base = normalizeClaimBaseIri(asterism.claimBaseIri);
  if (!base) return { error: "claim-base-iri-required" };

  const files: Record<string, object[]> = {};
  const push = (file: string, row: object) => {
    (files[file] ??= []).push(row);
  };
  const skipped: AsterismBundle["skipped"] = [];

  for (const { id, meta, title } of items) {
    if (meta.kind !== "claim") {
      skipped.push({ id, reason: "not-claim" });
      continue;
    }
    const typeTerm = meta.asterism?.typeSlug?.trim() || null;
    if (!typeTerm && !opts.includeUntyped) {
      skipped.push({ id, reason: "untyped" });
      continue;
    }
    if (!opts.includeInferred && lowestReviewState(meta) === "inferred") {
      skipped.push({ id, reason: "inferred" });
      continue;
    }
    let file: string;
    if (typeTerm) {
      const bucket = bucketOf(typeTerm, asterism);
      if (!bucket) {
        skipped.push({ id, reason: "unknown-type" });
        continue;
      }
      file = bucket;
    } else {
      file = "untyped.json";
    }

    const row = toClaimRow(id, meta, title ?? "", typeTerm, asterism, base, opts);
    push(file, row);

    const r = meta.ruleFrame;
    if (r) {
      const term = (role: AsterismRuleTerm["role"], v: FrameValue, position: number): AsterismRuleTerm => ({
        rule_id: id,
        rule_iri: row.iri,
        role,
        ...toTerm(v, position, asterism),
      });
      r.conditions.forEach((v, i) => push("rule_terms.json", term("condition", v, i)));
      r.consequences.forEach((v, i) => push("rule_terms.json", term("consequence", v, i)));
    }
    const o = meta.observationFrame;
    if (o) {
      o.results.forEach((v, i) => {
        const t: AsterismObservationTerm = { observation_id: id, observation_iri: row.iri, ...toTerm(v, i, asterism) };
        push("observation_terms.json", t);
      });
    }
  }

  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(files)) counts[name] = rows.length;
  return { files, counts, skipped };
}

/** ファイルごとに 2 スペースインデントの JSON にする */
export function serializeAsterismBundle(files: Record<string, object[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, rows] of Object.entries(files)) out[name] = JSON.stringify(rows, null, 2);
  return out;
}
