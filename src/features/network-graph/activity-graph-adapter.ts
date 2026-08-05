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

import { extractRelations, type ProvJsonLd, type ProvJsonLdNode, type ProvAttribute } from "../prov-generator/generator";
import { t } from "../../i18n";

export type ActivityIoKind = "material" | "tool" | "output";
export type ActivityIo = {
  label: string;
  kind: ActivityIoKind;
  /** インライン span 由来のときの entityId。無いもの（テーブル行 / メディア / plan）は
   *  グラフ側から編集・削除できない（表示のみ） */
  entityId?: string;
};
export type ActivityParam = {
  label: string;
  /** インライン attribute 由来のときの entityId（同上） */
  entityId?: string;
};

export type ActivityNode = {
  id: string; // blockId
  name: string; // 連番プレフィックス除去済みの activity 名
  /** 素の入力（他手順の output 由来は steps エッジに畳むので含まない） */
  inputs: ActivityIo[];
  /** 明示 output（informed_by desugar の合成プレースホルダは含まない） */
  outputs: ActivityIo[];
  /** パラメータ（"key: value" 形式のテキスト / 属性ラベル） */
  params: ActivityParam[];
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

/** ノード直属の属性を表示行に展開する（graphium:* key-value + graphium:attributes） */
function extractAttrs(n: ProvJsonLdNode): ActivityParam[] {
  const out: ActivityParam[] = [];
  for (const key of Object.keys(n)) {
    if (
      key.startsWith("graphium:") &&
      !RESERVED_KEYS.has(key) &&
      typeof n[key as `graphium:${string}`] === "string"
    ) {
      out.push({ label: `${key.replace("graphium:", "")}: ${n[key as `graphium:${string}`]}` });
    }
  }
  for (const attr of (n["graphium:attributes"] ?? []) as ProvAttribute[]) {
    out.push({ label: attr["rdfs:label"], entityId: attr["graphium:entityId"] });
  }
  return out;
}

/**
 * Entity ノードの @id（`inline_<label>_<entityId>`）から entityId を復元する。
 * インライン span 以外（テーブル行 / result_* / メディア / plan phase）は null —
 * それらは本文 span の書き換えでは編集できないため。
 */
function inlineEntityIdOf(node: { "@id": string; [k: `graphium:${string}`]: any }): string | undefined {
  const id = node["@id"];
  if (id.endsWith("_plan")) return undefined;
  if (node["graphium:mediaUrl"]) return undefined; // メディアはサイドストア由来
  for (const prefix of ["inline_material_", "inline_tool_", "inline_output_"]) {
    if (id.startsWith(prefix)) return id.slice(prefix.length);
  }
  return undefined;
}

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
    const params = extractAttrs(n);

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
      owner.outputs.push({
        label: entity["rdfs:label"],
        kind: "output",
        entityId: inlineEntityIdOf(entity),
      });
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
      target.inputs.push({
        label: entity["rdfs:label"],
        kind,
        entityId: inlineEntityIdOf(entity),
      });
    }
  }

  return { activities, steps };
}

// ──────────────────────────────────────────────
// F 案フロービュー用の導出: Entity を独立ノードとして emit する。
//
// - material / tool / output の Entity がそれぞれノードになる（synthetic
//   「〜の結果」は出さない — それは orderOnly エッジに畳む）
// - パラメータはノードにしない: step / Entity 各ノードの attrs（表示行）に載せる
// - エッジ 3 種:
//     used      entity → step（フロー順。次の手順が材料・道具として使う）
//     generates step → entity（この手順が生成した）
//     orderOnly step → step（informed_by のうち物質を特定しないもの。点線描画）
// ──────────────────────────────────────────────

export type FlowStep = {
  id: string; // blockId
  name: string;
  params: ActivityParam[];
};

export type FlowEntity = {
  id: string; // provDoc の @id（そのままノード id に使う）
  label: string;
  kind: ActivityIoKind;
  /** インライン span 由来なら本文編集（リネーム・削除・属性追加）が可能 */
  entityId?: string;
  /** 構造化テーブルの行由来なら、ノート側テーブルのセル編集が可能 */
  tableRef?: { blockId: string; rowName: string };
  /** 属性行。インラインの従属 attribute は entityId 付き、テーブル列は tableRef 経由で編集 */
  attrs: ActivityParam[];
  mediaUrl?: string;
  mediaType?: string;
};

export type FlowEdgeKind = "used" | "generates" | "orderOnly";

export type FlowEdge = {
  id: string;
  kind: FlowEdgeKind;
  /** React Flow のフロー順方向（used: entity→step / generates: step→entity / orderOnly: step→step） */
  source: string;
  target: string;
  /** orderOnly のみ: 裏に informed_by リンクがあり削除できるか（editor 側で判定して付与） */
  deletable?: boolean;
};

export type FlowGraphData = {
  steps: FlowStep[];
  entities: FlowEntity[];
  edges: FlowEdge[];
};

export function provDocToFlowGraph(doc: ProvJsonLd | null): FlowGraphData {
  if (!doc) return { steps: [], entities: [], edges: [] };
  const graph = doc["@graph"];
  const nodeById = new Map(graph.map((n) => [n["@id"], n]));

  // Activity → FlowStep（@id → blockId 正規化）
  const activityBlockId = new Map<string, string>();
  const steps: FlowStep[] = [];
  for (const n of graph) {
    if (n["@type"] !== "prov:Activity") continue;
    const blockId = n["graphium:blockId"] ?? n["@id"];
    activityBlockId.set(n["@id"], blockId);
    steps.push({ id: blockId, name: n["rdfs:label"] || t("nav.untitled"), params: extractAttrs(n) });
  }

  const relations = extractRelations(doc);

  // synthetic の生成元（orderOnly 畳み込み用）と、通常 Entity の生成有無（kind 判定用）
  const syntheticProducer = new Map<string, string>(); // synthetic @id → producer blockId
  const generatedIds = new Set<string>();
  for (const r of relations) {
    if (r["@type"] !== "prov:wasGeneratedBy") continue;
    const producer = activityBlockId.get(r.to);
    if (!producer) continue;
    if (isSyntheticResult(r.from)) {
      if (!syntheticProducer.has(r.from)) syntheticProducer.set(r.from, producer);
    } else {
      generatedIds.add(r.from);
    }
  }

  const entities = new Map<string, FlowEntity>();
  const collectEntity = (id: string): FlowEntity | null => {
    const existing = entities.get(id);
    if (existing) return existing;
    const n = nodeById.get(id);
    if (!n || n["@type"] !== "prov:Entity") return null;
    const kind: ActivityIoKind = generatedIds.has(id)
      ? "output"
      : n["graphium:entityType"] === "tool"
        ? "tool"
        : "material";
    const entity: FlowEntity = {
      id,
      label: n["rdfs:label"] || id,
      kind,
      entityId: inlineEntityIdOf(n),
      // 構造化テーブルの行（@id = entity_<tableBlockId>_<rowName>）は、
      // blockId + 行名でノート側テーブルのセルを編集できる
      tableRef:
        id.startsWith("entity_") && n["graphium:blockId"]
          ? { blockId: n["graphium:blockId"], rowName: n["rdfs:label"] }
          : undefined,
      attrs: extractAttrs(n),
      mediaUrl: n["graphium:mediaUrl"],
      mediaType: n["graphium:mediaType"],
    };
    entities.set(id, entity);
    return entity;
  };

  const edges: FlowEdge[] = [];
  const seen = new Set<string>();
  const pushEdge = (e: FlowEdge) => {
    const key = `${e.kind}:${e.source}->${e.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(e);
  };

  for (const r of relations) {
    if (r["@type"] === "prov:used") {
      const stepId = activityBlockId.get(r.from);
      if (!stepId) continue;
      if (isSyntheticResult(r.to)) {
        // 物質を特定しない informed_by → step 間の orderOnly に畳む
        const producer = syntheticProducer.get(r.to);
        if (producer && producer !== stepId) {
          pushEdge({ id: `order-${producer}->${stepId}`, kind: "orderOnly", source: producer, target: stepId });
        }
        continue;
      }
      if (collectEntity(r.to)) {
        pushEdge({ id: `used-${r.to}->${stepId}`, kind: "used", source: r.to, target: stepId });
      }
    } else if (r["@type"] === "prov:wasGeneratedBy") {
      if (isSyntheticResult(r.from)) continue;
      const stepId = activityBlockId.get(r.to);
      if (!stepId) continue;
      if (collectEntity(r.from)) {
        pushEdge({ id: `gen-${stepId}->${r.from}`, kind: "generates", source: stepId, target: r.from });
      }
    }
  }

  return { steps, entities: Array.from(entities.values()), edges };
}

/** 「key: value」形式の属性ラベルを 2 列表示用に分解する（全角コロン対応）。
 *  コロンが無い / key が長すぎる（文中コロンの誤爆）場合は value のみ扱い。 */
export function splitAttrLabel(label: string): { key: string | null; value: string } {
  const m = label.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
  if (m) return { key: m[1].trim(), value: m[2].trim() };
  return { key: null, value: label };
}
