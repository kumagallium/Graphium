// モデル名が "unknown" で保存されたトピックに、書いたモデルを利用量の記録から書き戻す。
//
// v0.156.4（#1822）〜 v0.173.3 の「資料からトピックを作る」一括処理は、記録用のモデル名を
// 渡さずにトピックを作り・改訂していたため、generatedBy.model が "unknown" で保存された
// （#1906 で修正）。本文を書いたモデルは利用量の記録（GET /api/usage の raw。90 日分残る）に
// 改訂 API の呼び出しとして日時つきで残っているので、ページの最後の書き込み時刻の直前の
// 呼び出しと照らし合わせて埋める。
//
// 推測で埋めない: 時間窓の中の呼び出しが 1 種類のモデルだけのときに限る。呼び出しが無い・
// 複数のモデルが混ざる（途中でモデルを切り替えた）ときは unknown のまま残す。

import type { GraphiumDocument } from "../../lib/document-types";

/** 利用量の記録 1 件のうち、照らし合わせに使う項目 */
export type UsageEventLite = { ts: string; feature: string; modelId: string };

/** トピックの本文を書く API の機能名（この呼び出しのモデルが本文を書いた） */
export const TOPIC_WRITE_FEATURES: ReadonlySet<string> = new Set(["wiki.revise-topic", "wiki.merge-topics"]);

/** 書き込み時刻より前に見る幅。改訂は時間切れの再試行込みで数分かかるので広めに取る */
export const UNKNOWN_MODEL_LOOKBACK_MS = 15 * 60_000;
/** 書き込み時刻より後に見る幅（記録の時刻と保存の時刻の前後のずれを吸収する） */
export const UNKNOWN_MODEL_LOOKAHEAD_MS = 60_000;

export const UNKNOWN_MODEL = "unknown";

/** 埋める対象か（資料から書いたトピック・回答ページで、モデル名が unknown） */
export function isUnknownModelTopic(doc: GraphiumDocument | null | undefined): boolean {
  const meta = doc?.wikiMeta;
  if (!meta) return false;
  if (typeof meta.topicMarkdown !== "string") return false;
  return meta.generatedBy?.model === UNKNOWN_MODEL;
}

/**
 * ページの最後の書き込み時刻（改訂で進む lastIngestedAt）の直前の、本文を書く API の
 * 呼び出しのモデルを返す。その窓に呼び出しが 1 件も無いとき（AI を呼ばない組み合わせの
 * 統合などで時刻だけ進んだ）は、作成時刻（generatedAt）の窓で見る。
 * 見た窓のモデルが 1 種類に決まらなければ null。
 */
export function resolveTopicModelFromUsage(
  doc: GraphiumDocument,
  events: readonly UsageEventLite[],
): string | null {
  const anchors = [doc.wikiMeta?.lastIngestedAt, doc.wikiMeta?.generatedAt];
  for (const anchorIso of anchors) {
    const anchor = anchorIso ? new Date(anchorIso).getTime() : NaN;
    if (!Number.isFinite(anchor)) continue;
    const models = modelsInWindow(events, anchor);
    if (models.size === 0) continue;
    return models.size === 1 ? [...models][0] : null;
  }
  return null;
}

function modelsInWindow(events: readonly UsageEventLite[], anchor: number): Set<string> {
  const models = new Set<string>();
  for (const ev of events) {
    if (!TOPIC_WRITE_FEATURES.has(ev.feature)) continue;
    if (!ev.modelId) continue;
    const t = new Date(ev.ts).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < anchor - UNKNOWN_MODEL_LOOKBACK_MS || t > anchor + UNKNOWN_MODEL_LOOKAHEAD_MS) continue;
    models.add(ev.modelId);
  }
  return models;
}

/** モデル名だけを書き換えた文書を返す（本文・modifiedAt・来歴は触らない） */
export function withRecoveredModel(doc: GraphiumDocument, model: string): GraphiumDocument {
  const meta = doc.wikiMeta!;
  return {
    ...doc,
    // 上位の generatedBy は、モデル名が無いときだけ埋める（改訂はここを引き継ぐ）
    ...(doc.generatedBy && !doc.generatedBy.model
      ? { generatedBy: { ...doc.generatedBy, model } }
      : {}),
    wikiMeta: {
      ...meta,
      generatedBy: { ...meta.generatedBy, model },
    },
  };
}

export type UnknownModelBackfillDeps = {
  /** 対象の候補（モデル名が unknown のページの id） */
  candidateIds: readonly string[];
  loadDoc: (wikiId: string) => Promise<GraphiumDocument | null>;
  /** 保存できなかったら false（保存中で塞がっていたなど。次の起動でやり直す） */
  saveDoc: (wikiId: string, doc: GraphiumDocument) => Promise<boolean>;
  events: readonly UsageEventLite[];
  /** 記録から 1 種類に決まらなかったページ（呼び出し側が次から飛ばすために覚える） */
  onUnresolved?: (wikiId: string) => void;
};

export type UnknownModelBackfillResult = {
  /** モデル名を書き戻した件数 */
  fixed: number;
  /** 記録から 1 種類に決まらず、unknown のまま残した件数 */
  unresolved: number;
  /** 保存できなかった件数（次の起動でやり直す） */
  saveFailed: number;
};

export async function runUnknownModelBackfill(deps: UnknownModelBackfillDeps): Promise<UnknownModelBackfillResult> {
  const result: UnknownModelBackfillResult = { fixed: 0, unresolved: 0, saveFailed: 0 };
  for (const id of deps.candidateIds) {
    const doc = await deps.loadDoc(id);
    if (!isUnknownModelTopic(doc)) continue;
    const model = resolveTopicModelFromUsage(doc!, deps.events);
    if (!model) {
      result.unresolved++;
      deps.onUnresolved?.(id);
      continue;
    }
    const ok = await deps.saveDoc(id, withRecoveredModel(doc!, model));
    if (ok) result.fixed++;
    else result.saveFailed++;
  }
  return result;
}
