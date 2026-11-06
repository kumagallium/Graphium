// 手順抽出の結果を保存する前に名寄せする（段 1 表記ゆれ＋段 2 同じ概念）。
//
// 一括抽出では論文ごとの抽出が並列に走る。名寄せまで並列にすると、同じ回の論文どうしが
// 互いの名前を知らないまま保存され、Calcination と calcining が別々のノードになる。
// そこで名寄せ（と、その結果を書庫の名前に足すところ）だけを 1 本の列に並べる。
// 先に済んだ論文の名前は、ノート一覧の索引に載る前でも、次の論文の名寄せに使われる。
//
// 段 2（AI）が失敗しても取り込みは止めない。段 1 の結果だけで保存する。

import { apiBase } from "../../lib/platform";
import { getSelectedModel } from "../settings/store";
import { provHeaders } from "./prov-ingester-api";
import type { ProvIngesterBlock } from "./prov-note-builder";
import type { ProvVocabulary } from "./label-vocabulary";
import {
  alignBySpelling,
  applyLabelMapping,
  collectBlockLabels,
  mergeMappings,
  unionVocabulary,
  type AlignmentChange,
  type LabelMapping,
} from "./label-alignment";

export type AlignedBlocks = {
  blocks: ProvIngesterBlock[];
  changes: AlignmentChange[];
};

/** この画面を開いてから名寄せを済ませた名前（索引に載るまでのつなぎ） */
let sessionLabels: ProvVocabulary = { step: [], material: [], tool: [], output: [], attributeKey: [] };
/** 名寄せの列。前の論文の名寄せが済んでから次に進む */
let chain: Promise<unknown> = Promise.resolve();

async function requestConceptAlignment(
  unmatched: ProvVocabulary,
  candidates: ProvVocabulary,
): Promise<LabelMapping> {
  const res = await fetch(`${apiBase()}/prov/align-labels`, {
    method: "POST",
    headers: provHeaders(),
    body: JSON.stringify({
      labels: unmatched,
      candidates,
      ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
    }),
  });
  if (!res.ok) throw new Error(`align-labels failed (${res.status})`);
  const json = (await res.json()) as { mapping?: LabelMapping };
  return json.mapping ?? {};
}

/**
 * 抽出結果のブロックを書庫の名前に寄せる。呼び出しは 1 本の列に並ぶ。
 * @param inventory 書庫で使われている名前（collectLabelInventory）
 * @param options.useAi 段 2（AI）を使うか。既定 true
 */
export function alignExtractedBlocks(
  blocks: ProvIngesterBlock[],
  inventory: ProvVocabulary,
  options: { useAi?: boolean } = {},
): Promise<AlignedBlocks> {
  const run = async (): Promise<AlignedBlocks> => {
    const known = unionVocabulary(inventory, sessionLabels);
    const labels = collectBlockLabels(blocks);
    const spelling = alignBySpelling(labels, known);
    let mapping = spelling.mapping;
    const changes = [...spelling.changes];
    if (options.useAi !== false) {
      try {
        const concept = await requestConceptAlignment(spelling.unmatched, known);
        for (const [kind, m] of Object.entries(concept) as [keyof ProvVocabulary, Record<string, string>][]) {
          for (const [from, to] of Object.entries(m)) changes.push({ kind, from, to, via: "concept" });
        }
        mapping = mergeMappings(mapping, concept);
      } catch (err) {
        console.warn("[label-alignment] 同じ概念の名寄せに失敗。表記ゆれだけで保存する", err);
      }
    }
    const aligned = applyLabelMapping(blocks, mapping);
    // 寄せたあとの名前を、次の論文の名寄せから見えるようにする
    sessionLabels = unionVocabulary(sessionLabels, collectBlockLabels(aligned));
    return { blocks: aligned, changes };
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

/** テスト用: 列と、この画面で覚えた名前を空に戻す */
export function resetLabelAlignmentSession(): void {
  sessionLabels = { step: [], material: [], tool: [], output: [], attributeKey: [] };
  chain = Promise.resolve();
}
