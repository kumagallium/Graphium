// ──────────────────────────────────────────────
// provDoc（生成済み PROV-JSON-LD）→ ActivityGraph 用データへの変換。
//
// 実データの PROV は activity 同士を直接つながず、必ず output entity を挟む
// （A →wasGeneratedBy← Entity →used→ B）。生成側が既存 output を proxy にしたり
// 仮 entity を挿入したりした結果がそのまま provDoc に出るので、それを読むだけで
// activity / output / used の関係が得られる。
// ──────────────────────────────────────────────

import { extractRelations, type ProvJsonLd } from "../prov-generator/generator";
import type { ActivityNode, OutputEntity, UseEdge } from "./activity-graph";

export type ActivityGraphData = {
  activities: ActivityNode[];
  outputs: OutputEntity[];
  uses: UseEdge[];
};

export function provDocToActivityGraph(doc: ProvJsonLd | null): ActivityGraphData {
  if (!doc) return { activities: [], outputs: [], uses: [] };
  const graph = doc["@graph"];

  // Activity ノード（id は blockId に正規化＝リンク書き込みでそのまま使える）
  const activityBlockId = new Map<string, string>(); // @id → blockId
  const activities: ActivityNode[] = [];
  for (const n of graph) {
    if (n["@type"] !== "prov:Activity") continue;
    const blockId = n["graphium:blockId"] ?? n["@id"];
    activityBlockId.set(n["@id"], blockId);
    activities.push({ id: blockId, name: n["rdfs:label"] || "(無題)" });
  }

  const nodeById = new Map(graph.map((n) => [n["@id"], n]));
  const relations = extractRelations(doc);

  // output entity = wasGeneratedBy(from=entity, to=activity) の entity。owner = activity。
  const outputs: OutputEntity[] = [];
  const ownerOf = new Map<string, string>(); // entity @id → owner blockId
  for (const r of relations) {
    if (r["@type"] !== "prov:wasGeneratedBy") continue;
    if (ownerOf.has(r.from)) continue; // 同一 entity の複数生成元は最初を採用
    const ownerBlockId = activityBlockId.get(r.to);
    if (!ownerBlockId) continue;
    ownerOf.set(r.from, ownerBlockId);
    outputs.push({
      id: r.from,
      owner: ownerBlockId,
      label: nodeById.get(r.from)?.["rdfs:label"] || "出力",
    });
  }

  // used = used(from=activity B, to=entity)。entity が output のものだけ採用
  //（材料/ツールなど「生成されていない入力 entity」はこのビューでは描かない）。
  const uses: UseEdge[] = [];
  let i = 0;
  for (const r of relations) {
    if (r["@type"] !== "prov:used") continue;
    if (!ownerOf.has(r.to)) continue; // output 以外は除外
    const consumerBlockId = activityBlockId.get(r.from);
    if (!consumerBlockId) continue;
    uses.push({ id: `use-${i++}-${r.to}->${consumerBlockId}`, outputId: r.to, consumer: consumerBlockId });
  }

  return { activities, outputs, uses };
}
