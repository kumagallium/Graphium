// World-model grounding service (Phase 2 / PR 2A).
//
// kickoff §1.3 を踏まえ、grounding は WikiMeta の自己記述メタとして持ち、
// epistemicStatus / hypothesisStatus は読むだけで書き換えない（別レーン）。
// PR 2A では蒸留 KB のみ。LLM fallback / 自動照合トリガは PR 2B で追加。
//
// 公開 API は意図的に小さく:
//   checkValidity()  ... claimText から validity を計算（KB のみ）
//   attachValidity() ... WikiMeta に validity を不変的に attach（純関数）
//
// PR 2B でこの index.ts に LLM fallback を追加する想定。retriever は呼び出し戦略
// の中身として隠す。

import type { GroundingProfile, WikiMeta } from "../../lib/document-types";
import { checkValidityFromKB } from "./distilled-kb-retriever";

export type CheckValidityOptions = {
  /** デフォルト "materials"。将来複数ドメインで切り替える */
  domain?: string;
  /** public/grounding-kb/ 配信の base URL。デフォルトは import.meta.env.BASE_URL */
  baseUrl?: string;
};

/**
 * claim 本文を蒸留 KB と照合し、validity を返す。
 * KB ヒットがない場合は undefined（=照合済みだが verdict 未付与の温存）。
 */
export async function checkValidity(
  _wikiMeta: WikiMeta,
  claimText: string,
  options?: CheckValidityOptions,
): Promise<GroundingProfile["validity"] | undefined> {
  const domain = options?.domain ?? "materials";
  const baseUrl =
    options?.baseUrl ??
    (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/");
  const match = await checkValidityFromKB(claimText, { domain, baseUrl });
  const checkedAt = new Date().toISOString();
  if (!match) {
    // KB ヒットなし: verdict は付けず、照合済み事実だけ残す
    return {
      checkedBy: "distilled-kb@v1",
      checkedAt,
    };
  }
  return {
    score: match.score,
    verdict: match.verdict,
    rationale: match.rationale,
    sources: match.sources,
    checkedBy: "distilled-kb@v1",
    checkedAt,
  };
}

/**
 * WikiMeta.grounding.validity を更新した新 WikiMeta を返す（純関数）。
 *
 * 別レーン契約:
 *   - epistemicStatus / hypothesisStatus / level / status は touch しない
 *   - 他フィールドは spread でそのまま温存する
 *   - 既存 grounding.suggests は保持
 *
 * validity が undefined のときは grounding.validity を削除する（明示的にクリア）。
 */
export function attachValidity(
  meta: WikiMeta,
  validity: GroundingProfile["validity"] | undefined,
): WikiMeta {
  const prevGrounding = meta.grounding;
  const nextGrounding: GroundingProfile = {
    ...prevGrounding,
    validity,
  };
  if (validity === undefined) {
    // 明示クリア: undefined キーを保持しない
    const { validity: _omit, ...rest } = nextGrounding;
    return { ...meta, grounding: Object.keys(rest).length > 0 ? rest : undefined };
  }
  return { ...meta, grounding: nextGrounding };
}

export type { GroundingMatch, KbEntry, KbFile } from "./distilled-kb-retriever";
export { checkValidityFromKB, loadKb } from "./distilled-kb-retriever";
