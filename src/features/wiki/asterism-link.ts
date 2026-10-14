// Asterism 連携（受け口）の純関数。
// 型の語彙は Graphium で持たず、設定（Settings.asterism）で利用者が与えた語だけを使う。

import type { AsterismLink, WikiMeta } from "../../lib/document-types";
import type { AsterismSettings } from "../settings/store";

export type VocabTermKind = "empty" | "iri" | "curie" | "slug";

const SLUG_RE = /^[A-Za-z0-9._~-]+$/;

/** 語の書式を分類する。ASCII 以外・空白を含む slug は "empty"（割り当てない） */
export function classifyVocabTerm(value: string): VocabTermKind {
  const v = (value ?? "").trim();
  if (!v) return "empty";
  if (/\s/.test(v)) return "empty";
  if (/^https?:\/\//i.test(v)) return "iri";
  if (v.includes(":")) return /^[\x21-\x7e]+$/.test(v) ? "curie" : "empty";
  return SLUG_RE.test(v) ? "slug" : "empty";
}

/** 設計メモ §6 の判定順で、知見に付ける型の語を決める。該当語が空なら undefined */
export function resolveAsterismTypeSlug(
  meta: WikiMeta,
  asterism: AsterismSettings,
): string | undefined {
  const roles = meta.claimRole ?? [];
  let term: string | undefined;
  if (roles.includes("decision")) term = asterism.typeSlugs.judgment;
  else if (meta.statementForm === "general") term = asterism.typeSlugs.rule;
  else if (
    roles.includes("interpretation") ||
    meta.epistemicStatus === "interpretation" ||
    meta.epistemicStatus === "speculation"
  ) {
    term = asterism.typeSlugs.interpretation;
  } else if (meta.statementForm === "instance" && meta.epistemicStatus === "observation") {
    term = asterism.typeSlugs.observation;
  }
  if (term === undefined) return undefined;
  const trimmed = term.trim();
  return classifyVocabTerm(trimmed) === "empty" ? undefined : trimmed;
}

/**
 * 自動割当を適用した新しい meta を返す。
 * - typeSlugBy が "human" なら（typeSlug が空の「付けない」も）触らない
 * - それ以外は再計算して "auto" を付ける
 * - 結果が未定で evidenceIris も無ければ asterism を削除する
 * - claim 以外は無変更
 */
export function applyAsterismDefaults(
  meta: WikiMeta,
  asterism: AsterismSettings,
  /** Asterism 連携が有効か（features.asterism）。false なら何もしない（書き込み済みの値は残す） */
  enabled = true,
): WikiMeta {
  if (!enabled) return meta;
  if (meta.kind !== "claim") return meta;
  const existing = meta.asterism;
  // 人が選んだ値（「付けない」= typeSlug 無しも含む）は自動では上書きしない
  if (existing?.typeSlugBy === "human") return meta;

  const slug = resolveAsterismTypeSlug(meta, asterism);
  const evidenceIris = existing?.evidenceIris;
  const hasEvidence = !!evidenceIris && evidenceIris.length > 0;

  if (slug === undefined && !hasEvidence) {
    if (!meta.asterism) return meta;
    const { asterism: _drop, ...rest } = meta;
    return rest;
  }
  const next: AsterismLink = {};
  if (slug !== undefined) {
    next.typeSlug = slug;
    next.typeSlugBy = "auto";
  }
  if (evidenceIris) next.evidenceIris = evidenceIris;
  return { ...meta, asterism: next };
}

const IRI_RE = /^https?:\/\/\S+$/i;
const CURIE_RE = /^[A-Za-z_][\w.-]*:[^\s:/][^\s]*$/;

/** 1 行 1 IRI の入力を正規化する。採用できない行は rejected として数える */
export function normalizeEvidenceIris(lines: string): { iris: string[]; rejected: number } {
  const seen = new Set<string>();
  const iris: string[] = [];
  let rejected = 0;
  for (const raw of (lines ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!IRI_RE.test(line) && !CURIE_RE.test(line)) {
      rejected++;
      continue;
    }
    if (seen.has(line)) continue;
    seen.add(line);
    iris.push(line);
  }
  return { iris, rejected };
}

/** 設定の型の語が 1 つでも使えるか（空・不正な語は数えない）。「構造」節の Asterism 欄を出す条件 */
export function hasAsterismTerms(asterism: AsterismSettings): boolean {
  return Object.values(asterism.typeSlugs).some((v) => classifyVocabTerm(v.trim()) !== "empty");
}
