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
import { appendToKbCache, removeFromKbCache } from "./kb-cache";
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
  // auto-upgrade 対象は「モデルが parametric に沈殿させた旧 entry」だけ:
  //   - grounded === undefined（web 経路を一度も通っていない）
  //   - generatedByModel が実モデル ID（"manual-curated@v1" や未設定の seed は除外）
  // web 経路を通った entry（grounded true=証拠あり / false=証拠ゼロでも試行済み）は「処理済み」
  // として即答する。再 upgrade しないので、証拠が出ない claim を毎回再照合しない。
  const kbMatch = await checkValidityFromKB(claimText, { baseUrl });
  const gen = kbMatch?.generatedByModel;
  const isModelSediment = !!gen && gen !== "manual-curated@v1";
  const upgradable =
    !!kbMatch && kbMatch.grounded === undefined && isModelSediment;
  if (kbMatch && !upgradable) {
    console.info("[world-grounding] KB hit", { entryId: kbMatch.entryId, verdict: kbMatch.verdict, grounded: kbMatch.grounded });
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

  // auto-upgrade: 旧 parametric なモデル沈殿は、web 証拠が取れる今は「ミス扱い」で一度だけ
  // 再照合し、web-grounded で上書きする。古い entry は沈殿成功後に削除する。
  const staleEntryId = upgradable ? kbMatch.entryId : undefined;
  if (staleEntryId) {
    console.info("[world-grounding] KB hit was parametric — re-grounding via web", { entryId: staleEntryId });
  } else {
    console.info("[world-grounding] KB miss, calling LLM fallback...");
  }

  // 2. KB ミス → LLM fallback
  const outcome = await checkValidityViaModel(claimText, { language });
  if (outcome.kind === "failure") {
    console.warn("[world-grounding] LLM fallback failure:", outcome.failure);
    // auto-upgrade の再照合が失敗したときは、古い parametric 結果を温存して degrade を避ける
    // （旧 entry も削除していないので、次回また upgrade を試みる）。
    if (kbMatch) {
      return {
        score: kbMatch.score,
        verdict: kbMatch.verdict,
        rationale: kbMatch.rationale,
        sources: kbMatch.sources,
        matchedKeywords: kbMatch.matchedKeywords,
        checkedBy: "distilled-kb@v1",
        checkedAt,
        entryId: kbMatch.entryId,
      };
    }
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
      // web 経路を通ったら必ず確定 boolean を刻む（true=証拠あり / false=証拠ゼロでも試行済み）。
      // これで次回以降は KB ヒットで即答され、証拠の出ない claim を毎回再照合しない。
      grounded: modelResult.grounded === true,
      version: 1,
    });
    // 実際に沈殿できた時だけエッジを張る（沈殿失敗 = KB に実体が無いので dangling を避ける）
    if (cached) {
      sedimentedEntryId = id;
      // auto-upgrade 成立: 旧 parametric entry を削除して重複を防ぐ（新 entry が置き換える）。
      if (staleEntryId) await removeFromKbCache(staleEntryId);
    }
    console.info("[world-grounding] sedimented into KB cache:", cached);
  }

  // 判定の出所表示: web 検索の証拠に基づいたなら "web-search"、そうでなければモデル ID。
  // （KB に沈殿させる generatedByModel は実モデル ID のまま保持する＝上の appendToKbCache）
  const checkedBy = modelResult.grounded ? "web-search" : modelResult.model;

  // verdict が null（LLM が「判定不能」と返した）でも checkedAt は記録する
  if (!modelResult.verdict) {
    return {
      checkedBy,
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
    checkedBy,
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
export { checkValidityViaModel } from "./llm-fallback";
