// Asterism 向けの「知識の束」（asterism-knowledge/1）を作る純関数（isomorphic）。
// 型や確認の状態で絞らず、知見とトピックの全部を題と札だけで出す（本文は出さない）。
// DOM / Date.now / fs に依存しない。exportedAt と資料の名前の引き方は引数で受ける。
// 表記ゆれの寄せ・知見との照合は Asterism 側の仕事で、ここでは持たない。

import type { TopicType, WikiMeta } from "../../lib/document-types";
import {
  DEFAULT_NOTE_URL_BASE,
  normalizeClaimBaseIri,
  normalizeNoteUrlBase,
} from "./asterism-export";
import { splitTopicSubject } from "./topic-subject";

export const KNOWLEDGE_FORMAT = "asterism-knowledge/1";

/** 取り込み元の表示名（Asterism のデータセット名に使われる） */
export const KNOWLEDGE_TITLE = "Graphium";

/** 基底 IRI の既定（claim は既存の送り口と同じ） */
export const DEFAULT_KNOWLEDGE_BASES = {
  claim: "https://kumagallium.github.io/Graphium/claim/",
  source: "https://kumagallium.github.io/Graphium/source/",
  term: "https://kumagallium.github.io/Graphium/term/",
} as const;

export type KnowledgeSourceKind = "note" | "pdf" | "document" | "chat" | "url" | "other";
export type KnowledgeTermRole = "material" | "method" | "concept" | "other";

export type KnowledgeClaimRow = {
  id: string;
  iri: string;
  source_url: string;
  title: string;
  /** wikiMeta.status（candidate / verified） */
  review_state: string | null;
  epistemic_status: string | null;
  modal_qualifier: string | null;
  level: string | null;
  source_iri: string[];
  generated_at: string | null;
  exported_at: string;
};

export type KnowledgeTopicRow = {
  id: string;
  iri: string;
  source_url: string;
  title: string;
  topic_type: string | null;
  material: string | null;
  property: string | null;
  claim_iri: string[];
  source_iri: string[];
  generated_at: string | null;
  exported_at: string;
};

export type KnowledgeSourceRow = {
  id: string;
  iri: string;
  name: string;
  kind: KnowledgeSourceKind;
  exported_at: string;
};

export type KnowledgeTermCandidateRow = {
  id: string;
  name: string;
  kind: "class" | "property";
  role: KnowledgeTermRole | null;
  aliases: string[];
  origin_id: string;
  origin_iri: string;
  source_url: string;
  exported_at: string;
};

export type KnowledgeTermClaimRow = {
  term_id: string;
  claim_id: string;
  claim_iri: string;
};

export type KnowledgeTermRelationRow = {
  from_term: string;
  rel: "has_property";
  to_term: string;
  origin_id: string;
  origin_iri: string;
};

export type KnowledgeFileName =
  | "claims.json"
  | "topics.json"
  | "sources.json"
  | "term_candidates.json"
  | "term_claims.json"
  | "term_relations.json";

export type KnowledgeFiles = {
  "claims.json": KnowledgeClaimRow[];
  "topics.json": KnowledgeTopicRow[];
  "sources.json": KnowledgeSourceRow[];
  "term_candidates.json": KnowledgeTermCandidateRow[];
  "term_claims.json": KnowledgeTermClaimRow[];
  "term_relations.json": KnowledgeTermRelationRow[];
};

export type KnowledgeBundle = {
  format: typeof KNOWLEDGE_FORMAT;
  title: string;
  exported_at: string;
  bases: { claim: string; source: string; term: string };
  files: KnowledgeFiles;
  counts: Record<KnowledgeFileName, number>;
};

export type KnowledgeBundleError = {
  error: "claim-base-iri-invalid" | "source-base-iri-invalid" | "term-base-iri-invalid" | "note-url-base-invalid";
};

export type KnowledgeBundleOptions = {
  /** ISO 8601。呼び出し側が渡す */
  exportedAt: string;
  claimBaseIri?: string;
  sourceBaseIri?: string;
  termBaseIri?: string;
  noteUrlBase?: string;
  /** wiki の id か（出典から wiki の id を除く）。未指定なら除かない */
  isWikiId?: (id: string) => boolean;
  /** 資料の参照（pdf:… など）から名前を引く。引けなければ undefined（id を名前にする） */
  sourceName?: (ref: string) => string | undefined;
};

/**
 * 文字列の 53 ビットのハッシュ（cyrb53）。衝突を避けるための短い指紋で、暗号の用途ではない。
 * 依存を足さず、ブラウザでも動く純関数にするため Node の crypto は使わない。
 */
export function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * id を IRI にそのまま入る文字だけにする。
 * 既に `[A-Za-z0-9._~-]+` だけならそのまま（UUID は変わらない）。
 * そうでなければ、他を `-` に置き換えて 64 文字で切り、`~` と元の id の指紋（16 進 14 桁）を付ける
 * （`url:https://a/b` と `url:https://a-b` が同じ id に潰れないように）。
 */
export function safeKnowledgeId(id: string): string {
  if (/^[A-Za-z0-9._~-]+$/.test(id)) return id;
  const head = id.replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 64);
  return `${head}~${cyrb53(id).toString(16).padStart(14, "0")}`;
}

/** 受け側（Asterism）が拒む文字（IRI に入れてはいけない文字と制御文字） */
const BAD_IRI_CHARS = /["<>{}|\\^`\u0000-\u001f\u007f]/;

/** 資料の参照から種類を決める */
export function sourceKindOf(ref: string): KnowledgeSourceKind {
  const colon = ref.indexOf(":");
  if (colon < 0) return "note";
  switch (ref.slice(0, colon)) {
    case "pdf":
      return "pdf";
    case "document":
      return "document";
    case "chat":
      return "chat";
    case "url":
      return "url";
    default:
      return "other";
  }
}

/** topicType → 語の役割の札。未分類は null */
export function roleOfTopicType(t: TopicType | undefined | null): KnowledgeTermRole | null {
  switch (t) {
    case "material":
      return "material";
    case "method":
      return "method";
    case "concept":
      return "concept";
    case "agent":
    case "place":
      return "other";
    default:
      return null;
  }
}

export type KnowledgeItem = { id: string; meta: WikiMeta; title?: string };

/** 知見とトピックの全部を知識の束にする。基底が不正なら error */
export function buildKnowledgeBundle(
  items: KnowledgeItem[],
  opts: KnowledgeBundleOptions,
): KnowledgeBundle | KnowledgeBundleError {
  const checkedBase = (raw: string | undefined, def: string): string | null => {
    const b = normalizeClaimBaseIri(raw?.trim() ? raw : def);
    return b && !BAD_IRI_CHARS.test(b) ? b : null;
  };
  const claimBase = checkedBase(opts.claimBaseIri, DEFAULT_KNOWLEDGE_BASES.claim);
  if (!claimBase) return { error: "claim-base-iri-invalid" };
  const sourceBase = checkedBase(opts.sourceBaseIri, DEFAULT_KNOWLEDGE_BASES.source);
  if (!sourceBase) return { error: "source-base-iri-invalid" };
  const termBase = checkedBase(opts.termBaseIri, DEFAULT_KNOWLEDGE_BASES.term);
  if (!termBase) return { error: "term-base-iri-invalid" };
  const noteUrlBase = normalizeNoteUrlBase(opts.noteUrlBase ?? DEFAULT_NOTE_URL_BASE);
  if (!noteUrlBase || BAD_IRI_CHARS.test(noteUrlBase)) return { error: "note-url-base-invalid" };

  const exportedAt = opts.exportedAt;
  // 行の並びは安全化した後の id の順
  const withSid = (kind: "claim" | "topic") =>
    items
      .filter((i) => i.meta.kind === kind)
      .map((i) => ({ ...i, sid: safeKnowledgeId(i.id) }))
      .sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
  const claims = withSid("claim");
  const topics = withSid("topic");
  const claimIds = new Set(claims.map((c) => c.id));
  const claimSids = new Set(claims.map((c) => c.sid));
  const topicIds = new Set(topics.map((t) => t.id));

  // 資料: 知見 → トピックの順に、最初に出た順で重複なしに集める
  const sourceRows: KnowledgeSourceRow[] = [];
  const seenSources = new Set<string>();
  const sourcesOf = (meta: WikiMeta): string[] => {
    const out: string[] = [];
    for (const ref of meta.derivedFromNotes ?? []) {
      if (typeof ref !== "string" || !ref || opts.isWikiId?.(ref)) continue;
      const id = safeKnowledgeId(ref);
      out.push(sourceBase + id);
      if (seenSources.has(id)) continue;
      seenSources.add(id);
      sourceRows.push({
        id,
        iri: sourceBase + id,
        name: opts.sourceName?.(ref) || ref,
        kind: sourceKindOf(ref),
        exported_at: exportedAt,
      });
    }
    return [...new Set(out)];
  };

  const claimRows: KnowledgeClaimRow[] = claims.map(({ id, sid, meta, title }) => ({
    id: sid,
    iri: claimBase + sid,
    source_url: `${noteUrlBase}#knowledge/claim/${encodeURIComponent(id)}`,
    title: title ?? "",
    review_state: meta.status ?? null,
    epistemic_status: meta.epistemicStatus ?? null,
    modal_qualifier: meta.modalQualifier ?? null,
    level: meta.level ?? null,
    source_iri: sourcesOf(meta),
    generated_at: meta.generatedAt || null,
    exported_at: exportedAt,
  }));

  const topicRows: KnowledgeTopicRow[] = [];
  const candidates: KnowledgeTermCandidateRow[] = [];
  const seenCandidates = new Set<string>();
  const seenTopicSids = new Set<string>();
  const termClaimMap = new Map<string, KnowledgeTermClaimRow>();
  const relations: KnowledgeTermRelationRow[] = [];

  // 知見 → 所属トピック（topicIds）。束に入ったトピックだけ（束に渡されなかった知見は claims に無いので入らない）
  const claimsByTopic = new Map<string, string[]>();
  for (const { sid, meta } of claims) {
    for (const tid of meta.topicIds ?? []) {
      if (!topicIds.has(tid)) continue;
      const list = claimsByTopic.get(tid) ?? [];
      list.push(sid);
      claimsByTopic.set(tid, list);
    }
  }

  for (const { id, sid, meta, title } of topics) {
    // 知見と同じ id になるトピックは出さない（同じ基底なので同じ IRI になる）。トピック同士の衝突も先勝ち
    if (claimSids.has(sid) || seenTopicSids.has(sid)) continue;
    seenTopicSids.add(sid);
    const iri = claimBase + sid;
    const sourceUrl = `${noteUrlBase}#knowledge/topic/${encodeURIComponent(id)}`;
    const t = title ?? "";
    const { material, property } = splitTopicSubject(t, meta.topicType);
    const memberSids = [
      ...new Set((meta.derivedFromClaims ?? []).filter((c) => claimIds.has(c)).map(safeKnowledgeId)),
    ];
    topicRows.push({
      id: sid,
      iri,
      source_url: sourceUrl,
      title: t,
      topic_type: meta.topicType ?? null,
      material,
      property,
      claim_iri: memberSids.map((c) => claimBase + c),
      source_iri: sourcesOf(meta),
      generated_at: meta.generatedAt || null,
      exported_at: exportedAt,
    });

    // 語の候補。割れた（材料・物性の両方）→ 2 行、それ以外は題まるごとの 1 行。
    // 既に出した id の候補は出さず、それを指す対応・関係の行も出さない
    const base = { aliases: [] as string[], origin_id: sid, origin_iri: iri, source_url: sourceUrl, exported_at: exportedAt };
    const addCandidate = (row: KnowledgeTermCandidateRow): boolean => {
      if (seenCandidates.has(row.id)) return false;
      seenCandidates.add(row.id);
      candidates.push(row);
      return true;
    };
    const termIds: string[] = [];
    if (material !== null && property !== null) {
      const m = addCandidate({ id: `${sid}.m`, name: material, kind: "class", role: "material", ...base });
      const p = addCandidate({ id: `${sid}.p`, name: property, kind: "property", role: null, ...base });
      if (m) termIds.push(`${sid}.m`);
      if (p) termIds.push(`${sid}.p`);
      if (m && p) {
        relations.push({ from_term: `${sid}.m`, rel: "has_property", to_term: `${sid}.p`, origin_id: sid, origin_iri: iri });
      }
    } else {
      const name = material ?? t;
      if (addCandidate({ id: sid, name, kind: "class", role: roleOfTopicType(meta.topicType), ...base })) termIds.push(sid);
    }

    // 語 ↔ 知見: トピック側の derivedFromClaims と、知見側の topicIds の両方から（重複なし）
    const members = new Set<string>([...memberSids, ...(claimsByTopic.get(id) ?? [])]);
    for (const csid of [...members].sort()) {
      for (const term_id of termIds) {
        const key = `${term_id}\u0000${csid}`;
        if (!termClaimMap.has(key)) {
          termClaimMap.set(key, { term_id, claim_id: csid, claim_iri: claimBase + csid });
        }
      }
    }
  }

  const termClaims = [...termClaimMap.values()].sort((a, b) =>
    a.term_id !== b.term_id ? (a.term_id < b.term_id ? -1 : 1) : a.claim_id < b.claim_id ? -1 : a.claim_id > b.claim_id ? 1 : 0,
  );

  const files: KnowledgeFiles = {
    "claims.json": claimRows,
    "topics.json": topicRows,
    "sources.json": sourceRows,
    "term_candidates.json": candidates,
    "term_claims.json": termClaims,
    "term_relations.json": relations,
  };
  const counts = {
    "claims.json": claimRows.length,
    "topics.json": topicRows.length,
    "sources.json": sourceRows.length,
    "term_candidates.json": candidates.length,
    "term_claims.json": termClaims.length,
    "term_relations.json": relations.length,
  } satisfies Record<KnowledgeFileName, number>;

  return {
    format: KNOWLEDGE_FORMAT,
    title: KNOWLEDGE_TITLE,
    exported_at: exportedAt,
    bases: { claim: claimBase, source: sourceBase, term: termBase },
    files,
    counts,
  };
}
