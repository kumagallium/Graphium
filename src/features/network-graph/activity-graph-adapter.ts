// ──────────────────────────────────────────────
// provDoc（生成済み PROV-JSON-LD）→ 手順フローグラフ用データへの変換。
//
// 実 PROV では手順間に output entity が挟まる（A →wasGeneratedBy← Entity →used→ B）が、
// 手順フロービューでは output を描かず「手順依存 A → B」に畳む。
// すなわち wasGeneratedBy(O, A) かつ used(B, O) のとき、手順エッジ A → B を 1 本立てる。
// ──────────────────────────────────────────────

import { extractRelations, type ProvJsonLd } from "../prov-generator/generator";
import type { ActivityNode, StepEdge } from "./activity-graph";
import { t } from "../../i18n";

export type StepGraphData = {
  activities: ActivityNode[];
  steps: StepEdge[];
};

export function provDocToStepGraph(doc: ProvJsonLd | null): StepGraphData {
  if (!doc) return { activities: [], steps: [] };
  const graph = doc["@graph"];

  // Activity ノード（id は blockId に正規化＝リンク書き込みでそのまま使える）
  const activityBlockId = new Map<string, string>(); // @id → blockId
  const activities: ActivityNode[] = [];
  for (const n of graph) {
    if (n["@type"] !== "prov:Activity") continue;
    const blockId = n["graphium:blockId"] ?? n["@id"];
    activityBlockId.set(n["@id"], blockId);
    activities.push({ id: blockId, name: n["rdfs:label"] || t("nav.untitled") });
  }

  const relations = extractRelations(doc);

  // entity @id → 生成元 activity（blockId）
  const ownerOf = new Map<string, string>();
  for (const r of relations) {
    if (r["@type"] !== "prov:wasGeneratedBy") continue;
    if (ownerOf.has(r.from)) continue;
    const ownerBlockId = activityBlockId.get(r.to);
    if (ownerBlockId) ownerOf.set(r.from, ownerBlockId);
  }

  // used(B, entity) で entity が output なら、手順エッジ owner(entity) → B に畳む（重複排除）
  const steps: StepEdge[] = [];
  const seen = new Set<string>();
  for (const r of relations) {
    if (r["@type"] !== "prov:used") continue;
    const producer = ownerOf.get(r.to);
    const consumer = activityBlockId.get(r.from);
    if (!producer || !consumer || producer === consumer) continue;
    const key = `${producer}->${consumer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push({ id: `step-${key}`, from: producer, to: consumer });
  }

  return { activities, steps };
}
