// ──────────────────────────────────────────────
// provDoc（生成済み PROV-JSON-LD）→ 手順フローグラフ用データへの変換。
//
// 実 PROV では手順間に output entity が挟まる（A →wasGeneratedBy← Entity →used→ B）が、
// 手順フロービューでは output を描かず「手順依存 A → B」に畳む。
// すなわち wasGeneratedBy(O, A) かつ used(B, O) のとき、手順エッジ A → B を 1 本立てる。
//
// ノードカード表示用に、各手順の「素の入力 / 明示 output / パラメータ」も抽出する:
// - inputs: used(A, E) のうち、他手順の output でも informed_by の合成プレースホルダ
//   でもない Entity（= ユーザーが付けた材料 / 道具）
// - outputs: wasGeneratedBy(E, A) のうち合成プレースホルダでない Entity
// - params: Activity 直属の graphium:* 値と graphium:attributes（フルビューの
//   ダイヤモンドノードと同じ抽出規則）
// ──────────────────────────────────────────────

import { extractRelations, type ProvJsonLd, type ProvAttribute } from "../prov-generator/generator";
import { t } from "../../i18n";

export type ActivityIoKind = "material" | "tool" | "output";
export type ActivityIo = { label: string; kind: ActivityIoKind };

export type ActivityNode = {
  id: string; // blockId
  name: string; // 連番プレフィックス除去済みの activity 名
  /** 素の入力（他手順の output 由来は steps エッジに畳むので含まない） */
  inputs: ActivityIo[];
  /** 明示 output（informed_by desugar の合成プレースホルダは含まない） */
  outputs: ActivityIo[];
  /** パラメータ表示行（"key: value" 形式 / 属性ラベル） */
  params: string[];
};

/** 手順間の依存（A が産み B が使う＝ B wasInformedBy A）。from=A / to=B で下向きに流す。 */
export type StepEdge = {
  id: string;
  from: string; // 生成側 activity（blockId）
  to: string; // 使用側 activity（blockId）
  /** 裏に informed_by リンクがあり、このビューから削除できるか */
  deletable?: boolean;
};

export type StepGraphData = {
  activities: ActivityNode[];
  steps: StepEdge[];
};

// フルビュー（provToCytoscapeElements）と同じ「パラメータにしない予約キー」
const RESERVED_KEYS = new Set([
  "graphium:blockId",
  "graphium:attributes",
  "graphium:warnings",
  "graphium:entityType",
  "graphium:mediaType",
  "graphium:mediaUrl",
  "graphium:phase",
]);

/** informed_by desugar が立てる合成 output（「〜の結果」プレースホルダ）か */
const isSyntheticResult = (id: string) => id.startsWith("result_synthetic_");

export function provDocToStepGraph(doc: ProvJsonLd | null): StepGraphData {
  if (!doc) return { activities: [], steps: [] };
  const graph = doc["@graph"];
  const nodeById = new Map(graph.map((n) => [n["@id"], n]));

  // Activity ノード（id は blockId に正規化＝リンク書き込みでそのまま使える）
  const activityBlockId = new Map<string, string>(); // @id → blockId
  const activities: ActivityNode[] = [];
  const activityByBlockId = new Map<string, ActivityNode>();
  for (const n of graph) {
    if (n["@type"] !== "prov:Activity") continue;
    const blockId = n["graphium:blockId"] ?? n["@id"];
    activityBlockId.set(n["@id"], blockId);

    // パラメータ: graphium:* の文字列値 + graphium:attributes 配列
    const params: string[] = [];
    for (const key of Object.keys(n)) {
      if (
        key.startsWith("graphium:") &&
        !RESERVED_KEYS.has(key) &&
        typeof n[key as `graphium:${string}`] === "string"
      ) {
        params.push(`${key.replace("graphium:", "")}: ${n[key as `graphium:${string}`]}`);
      }
    }
    for (const attr of (n["graphium:attributes"] ?? []) as ProvAttribute[]) {
      params.push(attr["rdfs:label"]);
    }

    const node: ActivityNode = {
      id: blockId,
      name: n["rdfs:label"] || t("nav.untitled"),
      inputs: [],
      outputs: [],
      params,
    };
    activities.push(node);
    activityByBlockId.set(blockId, node);
  }

  const relations = extractRelations(doc);

  // entity @id → 生成元 activity（blockId）。ついでに明示 output をカードに載せる
  const ownerOf = new Map<string, string>();
  for (const r of relations) {
    if (r["@type"] !== "prov:wasGeneratedBy") continue;
    const ownerBlockId = activityBlockId.get(r.to);
    if (!ownerBlockId) continue;
    if (!ownerOf.has(r.from)) ownerOf.set(r.from, ownerBlockId);
    if (isSyntheticResult(r.from)) continue;
    const entity = nodeById.get(r.from);
    const owner = activityByBlockId.get(ownerBlockId);
    if (entity && owner && !owner.outputs.some((o) => o.label === entity["rdfs:label"])) {
      owner.outputs.push({ label: entity["rdfs:label"], kind: "output" });
    }
  }

  // used(B, entity):
  // - entity が他手順の output → 手順エッジ owner(entity) → B に畳む（重複排除）
  // - それ以外（素の材料 / 道具）→ B の inputs としてカードに載せる
  const steps: StepEdge[] = [];
  const seen = new Set<string>();
  for (const r of relations) {
    if (r["@type"] !== "prov:used") continue;
    const consumer = activityBlockId.get(r.from);
    if (!consumer) continue;
    const producer = ownerOf.get(r.to);
    if (producer && producer !== consumer) {
      const key = `${producer}->${consumer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push({ id: `step-${key}`, from: producer, to: consumer });
      continue;
    }
    if (producer === consumer && !isSyntheticResult(r.to)) continue; // 自己 output の再利用は既に outputs 表示済み
    if (isSyntheticResult(r.to)) continue;
    const entity = nodeById.get(r.to);
    const target = activityByBlockId.get(consumer);
    if (!entity || !target) continue;
    const kind: ActivityIoKind = entity["graphium:entityType"] === "tool" ? "tool" : "material";
    if (!target.inputs.some((i) => i.label === entity["rdfs:label"] && i.kind === kind)) {
      target.inputs.push({ label: entity["rdfs:label"], kind });
    }
  }

  return { activities, steps };
}
