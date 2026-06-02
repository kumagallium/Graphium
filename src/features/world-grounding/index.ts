// World-model grounding service (Phase 2).
//
// PR 2A: KB のみで verdict 判定。
// PR 2B: KB miss → LLM 判定（groundingModel）→ 結果を appdata KB cache に沈殿。
//        判定結果は次回以降の KB ヒットで即答される（使うほど安くなる）。
// PR 2C: domain 分割と tags 生成を撤廃。Graphium は汎用ノートエディタなので、
//        LLM に「これは何分野か」を決めさせる構造は持ち込まない。
//        KB は単一ファイル（seed.v1.json）+ 単一 appdata cache に集約。
//
// kickoff §1.3 / PR 2A 方針 §7 の不変条件:
// - epistemicStatus / hypothesisStatus は読むだけで書き換えない（別レーン）
// - 第 3 の provenance サブシステムを作らない
// - LLM/KB 未登録でエラーにせず degrade
// - 沈殿の鉄則は kb-cache.ts の isValidForCaching で強制

import type { GroundingProfile, WikiMeta } from "../../lib/document-types";
import { newId } from "../../lib/id";
import { checkValidityFromKB } from "./distilled-kb-retriever";
import { appendToKbCache } from "./kb-cache";
import { checkValidityViaModel } from "./llm-fallback";

export type CheckValidityOptions = {
  /** public/grounding-kb/ 配信の base URL。デフォルトは import.meta.env.BASE_URL */
  baseUrl?: string;
  /** LLM 判定時の言語（rationale を日本語/英語で書き分け）。デフォルト "en" */
  language?: string;
};

function defaultBaseUrl(): string {
  return typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : "/";
}

/**
 * claim 本文を世界モデルと照合し、validity を返す。
 *
 * 経路:
 *   1. KB ヒット（seed + cache を merge した検索）→ 即答（LLM を呼ばない）
 *   2. KB ミス → groundingModel で判定 → 結果を appdata cache に沈殿（4 値かつ contract を満たす場合のみ）
 *   3. 双方失敗 → checkedAt のみ返す（「照合済み・verdict 不明」を表現）
 */
export async function checkValidity(
  _wikiMeta: WikiMeta,
  claimText: string,
  options?: CheckValidityOptions,
): Promise<GroundingProfile["validity"] | undefined> {
  const baseUrl = options?.baseUrl ?? defaultBaseUrl();
  const language = options?.language ?? "en";
  const checkedAt = new Date().toISOString();

  // 1. KB ヒット即答
  const kbMatch = await checkValidityFromKB(claimText, { baseUrl });
  if (kbMatch) {
    console.info("[world-grounding] KB hit", { entryId: kbMatch.entryId, verdict: kbMatch.verdict });
    return {
      score: kbMatch.score,
      verdict: kbMatch.verdict,
      rationale: kbMatch.rationale,
      sources: kbMatch.sources,
      matchedKeywords: kbMatch.matchedKeywords,
      // cache から hit した entry でも、seed と区別したい場合は entryId で判別できる
      // が、UI 表示はシンプルに "distilled-kb@v1" で統一する。
      checkedBy: "distilled-kb@v1",
      checkedAt,
      // world-grounding edge: 接続先 KB エントリ ID。同じ entryId の洞察を引くのに使う。
      entryId: kbMatch.entryId,
    };
  }
  console.info("[world-grounding] KB miss, calling LLM fallback...");

  // 2. KB ミス → LLM fallback
  const outcome = await checkValidityViaModel(claimText, { language });
  if (outcome.kind === "failure") {
    console.warn("[world-grounding] LLM fallback failure:", outcome.failure);
    // 失敗理由を checkedBy / rationale に詰める。UI 側で出し分け可能にする
    const reasonLabel =
      outcome.failure.reason === "no-model"
        ? "no-engine"
        : outcome.failure.reason === "http-error"
          ? "engine-error"
          : outcome.failure.reason === "network-error"
            ? "engine-error"
            : "engine-error";
    return {
      checkedBy: reasonLabel,
      checkedAt,
      rationale: outcome.failure.message,
    };
  }
  const modelResult = outcome.result;
  console.info("[world-grounding] LLM judged", { verdict: modelResult.verdict, model: modelResult.model });

  // 沈殿: verdict + normalizedClaim + keywords が揃った時だけ KB cache に追加。
  // 鉄則: not_found (verdict null) / 壊れた entry は kb-cache 側で reject される。
  // 生成した entryId は validity にも詰めてエッジを成す（沈殿した世界事実への接続）。
  let sedimentedEntryId: string | undefined;
  if (modelResult.verdict && modelResult.normalizedClaim && modelResult.keywords?.length) {
    const id = `gen-${newId()}`;
    const cached = await appendToKbCache({
      id,
      verdict: modelResult.verdict,
      claim: modelResult.normalizedClaim,
      rationale: modelResult.rationale,
      keywords: modelResult.keywords,
      sources: modelResult.sources?.map((s) => ({
        kind: "distilled" as const,
        ref: s.ref,
        url: s.url,
      })),
      generatedByModel: modelResult.model,
      version: 1,
    });
    // 実際に沈殿できた時だけエッジを張る（沈殿失敗 = KB に実体が無いので dangling を避ける）
    if (cached) sedimentedEntryId = id;
    console.info("[world-grounding] sedimented into KB cache:", cached);
  }

  // verdict が null（LLM が「判定不能」と返した）でも checkedAt は記録する
  if (!modelResult.verdict) {
    return {
      checkedBy: modelResult.model,
      checkedAt,
      rationale: modelResult.rationale || undefined,
    };
  }

  return {
    verdict: modelResult.verdict,
    rationale: modelResult.rationale,
    sources: modelResult.sources?.map((s) => ({
      kind: "distilled" as const,
      ref: s.ref,
      url: s.url,
    })),
    matchedKeywords: modelResult.keywords,
    checkedBy: modelResult.model,
    checkedAt,
    entryId: sedimentedEntryId,
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
    const { validity: _omit, ...rest } = nextGrounding;
    return { ...meta, grounding: Object.keys(rest).length > 0 ? rest : undefined };
  }
  return { ...meta, grounding: nextGrounding };
}

export type { GroundingMatch, KbEntry, KbFile } from "./distilled-kb-retriever";
export { checkValidityFromKB, loadKb, loadSeedKb } from "./distilled-kb-retriever";
export {
  appendToKbCache,
  clearKbCache,
  isValidForCaching,
  loadKbCache,
  mergeKb,
  removeFromKbCache,
} from "./kb-cache";
export type { WorldGroundingModelResult } from "./llm-fallback";
export { checkValidityViaModel } from "./llm-fallback";
