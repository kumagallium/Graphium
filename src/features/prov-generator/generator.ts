// ──────────────────────────────────────────────
// PROV-JSON-LD 生成器
//
// ドキュメント全体を走査して PROV-JSON-LD を生成する。
// Phase 3: 関係を埋め込み形式に、テーブルを構造化属性に展開
// ──────────────────────────────────────────────

import { CORE_LABELS, normalizeLabel, classifyLabel, getHeadingLabelRole, LABEL_TO_ENTITY_SUBTYPE, type CoreLabel } from "../context-label/labels";
import type { BlockLink } from "../block-link/link-types";
import { isProvLink } from "../block-link/link-types";
import { createWarning, type ProvWarning } from "./errors";
import { buildDocumentProvenanceBundle, type DocumentProvenanceBundle } from "../document-provenance/prov-output";

// ── PROV-JSON-LD の型定義（Phase 3: 埋め込み形式） ──

/** 埋め込み属性（[属性] ラベルの段落テキスト） */
export type ProvAttribute = {
  "rdfs:label": string;
  "graphium:blockId"?: string;
};

export type ProvJsonLdNode = {
  "@id": string;
  "@type": string;
  "rdfs:label": string;
  "prov:used"?: { "@id": string }[];
  "prov:wasGeneratedBy"?: { "@id": string };
  "graphium:attributes"?: ProvAttribute[];
  "graphium:blockId"?: string;
  [key: `graphium:${string}`]: any;
};

export type ProvJsonLd = {
  "@context": {
    prov: "http://www.w3.org/ns/prov#";
    graphium: "https://graphium.app/ns#";
    rdfs: "http://www.w3.org/2000/01/rdf-schema#";
    xsd: "http://www.w3.org/2001/XMLSchema#";
  };
  "@graph": ProvJsonLdNode[];
  "graphium:warnings"?: ProvWarning[];
  /** ドキュメント来歴（Content Provenance とは分離した prov:Bundle） */
  "graphium:documentProvenance"?: DocumentProvenanceBundle;
};

// 後方互換: 旧型名をエイリアスとして維持
export type ProvDocument = ProvJsonLd;
export type ProvNode = ProvJsonLdNode;

// ── 内部中間表現（生成中に使用） ──

type InternalNode = {
  "@id": string;
  "@type": string;
  label: string;
  blockId: string;
  params?: Record<string, string>;
  attributes?: { label: string; blockId: string }[];
  /** Entity サブタイプ（material / tool） */
  entitySubtype?: import("../context-label/labels").EntitySubtype;
};

type InternalRelation = {
  "@type": string;
  from: string;
  to: string;
  linkId?: string;
};

// ── 入力データの型 ──

type GeneratorInput = {
  /** BlockNote のブロック配列 */
  blocks: any[];
  /** blockId → ラベル文字列 */
  labels: Map<string, string>;
  /** ブロック間リンク（全リンク渡し可 — PROV 層のみ使用） */
  links: BlockLink[];
  /** ドキュメント来歴（オプション） */
  documentProvenance?: import("../document-provenance/types").DocumentProvenance;
};

// ── テーブル構造化パーサー ──

type StructuredTableRow = {
  name: string;
  attrs: Record<string, string>;
};

type StructuredTable = {
  rows: StructuredTableRow[];
};

/** [使用したもの]/[結果] ラベル付きテーブルのヘッダーをkey、セルをvalueとして構造化 */
export function parseStructuredTable(block: any): StructuredTable | null {
  if (block.type !== "table") return null;

  const rows = block.content?.rows;
  if (!rows || rows.length < 2) return null;

  // ヘッダー行
  const headerRow = rows[0];
  const headers = headerRow.cells.map((cell: any) => extractCellText(cell));

  const dataRows: StructuredTableRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].cells;
    const name = extractCellText(cells[0]);
    if (!name) continue;

    const attrs: Record<string, string> = {};
    for (let j = 1; j < cells.length && j < headers.length; j++) {
      const value = extractCellText(cells[j]);
      if (value) {
        attrs[headers[j]] = value;
      }
    }
    dataRows.push({ name, attrs });
  }

  return { rows: dataRows };
}

// ── メイン生成関数 ──

export function generateProvDocument(input: GeneratorInput): ProvJsonLd {
  const { blocks, labels } = input;
  // PROV 層のリンクのみ使用（知識層は PROV グラフに含めない）
  const links = input.links.filter((l) => !l.layer || isProvLink(l.type));
  const warnings: ProvWarning[] = [];
  const nodes: InternalNode[] = [];
  const relations: InternalRelation[] = [];

  console.group("[PROV] 生成開始");
  console.log("ブロック数:", blocks.length, "ラベル数:", labels.size, "リンク数:", links.length);

  const flatBlocks = flattenBlocks(blocks);

  // ── Step 1: ラベルパーサー ──

  type LabeledBlock = {
    block: any;
    rawLabel: string;
    label: string;
    coreLabel: CoreLabel | null;
    provRole: string | null;
  };

  const labeledBlocks: LabeledBlock[] = [];

  for (const block of flatBlocks) {
    const rawLabel = labels.get(block.id);
    if (!rawLabel) continue;

    const normalized = normalizeLabel(rawLabel);
    const layer = classifyLabel(normalized);

    if (layer === "free") {
      warnings.push(createWarning("unknown-label", block.id, `"${rawLabel}" はフリーラベル — PROVに変換しません`));
      continue;
    }

    const coreLabel = (layer === "core" ? normalized : null) as CoreLabel | null;
    const provRole = coreLabel ? coreToProvRole(coreLabel, block) : null;

    labeledBlocks.push({ block, rawLabel, label: normalized, coreLabel, provRole });
  }

  // ── Step 2: @リンク解析 ──

  // 孤立リンク（削除済みブロックへの参照）を除外し、有効なリンクのみ処理する
  const validLinks: BlockLink[] = [];
  const informedByMap = new Map<string, BlockLink[]>();
  for (const link of links) {
    const sourceExists = blocks.some((b: any) => findBlockById(b, link.sourceBlockId));
    const targetExists = blocks.some((b: any) => findBlockById(b, link.targetBlockId));

    if (!sourceExists || !targetExists) {
      warnings.push(createWarning("broken-link", link.sourceBlockId,
        `リンク ${link.type} の${!sourceExists ? "元" : "先"} ${!sourceExists ? link.sourceBlockId : link.targetBlockId} が存在しません — スキップ`));
      continue;
    }

    validLinks.push(link);
    if (link.type === "informed_by") {
      const existing = informedByMap.get(link.sourceBlockId) ?? [];
      existing.push(link);
      informedByMap.set(link.sourceBlockId, existing);
    }
  }

  // ── Step 3: Activity ノード生成 ──

  const activities = labeledBlocks.filter((lb) => lb.provRole === "prov:Activity");

  for (const act of activities) {
    const blockId = act.block.id;
    const actLabel = getBlockText(act.block);
    nodes.push({
      "@id": `activity_${blockId}`,
      "@type": "prov:Activity",
      label: actLabel,
      blockId,
    });
  }

  // ── スコープ解決 ──
  const blockToActivityId = new Map<string, string>();
  const scopeStack: { level: number; activityId: string }[] = [];
  for (const block of flatBlocks) {
    if (block.type === "heading") {
      const level = block.props?.level ?? 2;
      const label = labels.get(block.id);
      const normalized = label ? normalizeLabel(label) : null;

      while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].level >= level) {
        scopeStack.pop();
      }

      if (normalized === "[手順]") {
        const role = getHeadingLabelRole(level, normalized);
        if (role === "activity") {
          scopeStack.push({ level, activityId: `activity_${block.id}` });
        }
      }
    }
    const currentActivityId = scopeStack.length > 0
      ? scopeStack[scopeStack.length - 1].activityId
      : null;
    if (currentActivityId) {
      blockToActivityId.set(block.id, currentActivityId);
    }
  }

  function getActivityIdsForScope(blockId: string): string[] {
    const scopeActId = blockToActivityId.get(blockId);
    if (!scopeActId) return [];
    return [scopeActId];
  }

  // ── [材料] / [ツール] → Entity + used 関係 ──
  // Phase 3: テーブルの場合は行ごとに個別 Entity に展開
  const INPUT_LABELS: CoreLabel[] = ["[材料]", "[ツール]"];
  for (const lb of labeledBlocks) {
    if (lb.coreLabel && INPUT_LABELS.includes(lb.coreLabel)) {
      const subtype = lb.coreLabel ? LABEL_TO_ENTITY_SUBTYPE[lb.coreLabel] : undefined;
      if (lb.block.type === "table") {
        // テーブル: 行ごとに個別 Entity を生成
        const parsed = parseStructuredTable(lb.block);
        if (parsed && parsed.rows.length > 0) {
          for (const row of parsed.rows) {
            const entityId = `entity_${lb.block.id}_${row.name}`;
            nodes.push({
              "@id": entityId,
              "@type": "prov:Entity",
              label: row.name,
              blockId: lb.block.id,
              params: Object.keys(row.attrs).length > 0 ? row.attrs : undefined,
              entitySubtype: subtype,
            });
            for (const actId of getActivityIdsForScope(lb.block.id)) {
              relations.push({ "@type": "prov:used", from: actId, to: entityId });
            }
          }
        } else {
          // パース失敗時はフォールバック（テーブル全体を1 Entity）
          const entityId = `entity_${lb.block.id}`;
          nodes.push({
            "@id": entityId,
            "@type": "prov:Entity",
            label: getBlockText(lb.block),
            blockId: lb.block.id,
            entitySubtype: subtype,
          });
          for (const actId of getActivityIdsForScope(lb.block.id)) {
            relations.push({ "@type": "prov:used", from: actId, to: entityId });
          }
        }
      } else {
        // 段落: 従来通り
        const entityId = `entity_${lb.block.id}`;
        nodes.push({
          "@id": entityId,
          "@type": "prov:Entity",
          label: getBlockText(lb.block),
          blockId: lb.block.id,
          entitySubtype: subtype,
        });
        for (const actId of getActivityIdsForScope(lb.block.id)) {
          relations.push({ "@type": "prov:used", from: actId, to: entityId });
        }
      }
    }
  }

  // ── [属性] → 親ノードの graphium:attributes に埋め込み ──
  // 独立ノードは作らず、親の Entity/Activity のプロパティとして格納
  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "[属性]") {
      const attrText = getBlockText(lb.block);
      const attrEntry = { label: attrText, blockId: lb.block.id };

      // 親ブロックの PROV ノードを探す
      const parentNodeId = findParentLabeledNodeId(lb.block.id, blocks, labels, labeledBlocks);
      if (parentNodeId) {
        const parentNode = nodes.find((n) => n["@id"] === parentNodeId);
        if (parentNode) {
          if (!parentNode.attributes) parentNode.attributes = [];
          parentNode.attributes.push(attrEntry);
        }
      } else {
        // 親がない場合はスコープの Activity に埋め込む
        for (const actId of getActivityIdsForScope(lb.block.id)) {
          const actNode = nodes.find((n) => n["@id"] === actId);
          if (actNode) {
            if (!actNode.attributes) actNode.attributes = [];
            actNode.attributes.push(attrEntry);
          }
        }
      }
    }
  }

  // ── [結果] → Entity + wasGeneratedBy 関係 ──
  // Phase 3: テーブルの場合は行ごとに個別 Entity に展開
  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "[結果]") {
      if (lb.block.type === "table") {
        const parsed = parseStructuredTable(lb.block);
        if (parsed && parsed.rows.length > 0) {
          for (const row of parsed.rows) {
            const entityId = `result_${lb.block.id}_${row.name}`;
            nodes.push({
              "@id": entityId,
              "@type": "prov:Entity",
              label: row.name,
              blockId: lb.block.id,
              params: Object.keys(row.attrs).length > 0 ? row.attrs : undefined,
            });
            for (const actId of getActivityIdsForScope(lb.block.id)) {
              relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: actId });
            }
          }
        } else {
          const entityId = `result_${lb.block.id}`;
          nodes.push({
            "@id": entityId,
            "@type": "prov:Entity",
            label: getBlockText(lb.block),
            blockId: lb.block.id,
          });
          for (const actId of getActivityIdsForScope(lb.block.id)) {
            relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: actId });
          }
        }
      } else {
        const entityId = `result_${lb.block.id}`;
        nodes.push({
          "@id": entityId,
          "@type": "prov:Entity",
          label: getBlockText(lb.block),
          blockId: lb.block.id,
        });
        for (const actId of getActivityIdsForScope(lb.block.id)) {
          relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: actId });
        }
      }
    }
  }

  // ── informed_by → 前手順の結果を経由してリンク ──
  for (const link of validLinks) {
    if (link.type === "informed_by") {
      const prevActId = `activity_${link.targetBlockId}`;
      const currentActId = `activity_${link.sourceBlockId}`;

      // 前手順の結果 Entity を探す
      const resultNode = nodes.find(
        (n) => n["@id"].startsWith("result_") && blockToActivityId.get(n.blockId) === prevActId
      );

      let resultId: string;
      if (resultNode) {
        resultId = resultNode["@id"];
      } else {
        // 結果が明示されていない場合は合成 Entity を生成
        const syntheticId = `result_synthetic_${link.targetBlockId}`;
        if (!nodes.find((n) => n["@id"] === syntheticId)) {
          const prevActLabel = nodes.find((n) => n["@id"] === prevActId)?.label ?? "前手順";
          nodes.push({
            "@id": syntheticId,
            "@type": "prov:Entity",
            label: `${prevActLabel} の結果`,
            blockId: link.targetBlockId,
          });
          relations.push({
            "@type": "prov:wasGeneratedBy",
            from: syntheticId,
            to: prevActId,
          });
        }
        resultId = syntheticId;
      }

      relations.push({ "@type": "prov:used", from: currentActId, to: resultId, linkId: link.id });
    }
  }

  console.log("生成ノード:", nodes.map((n) => `${n["@type"]} "${n.label}" (${n["@id"]})`));
  console.log("生成リレーション:", relations.map((r) => `${r["@type"]} ${r.from} → ${r.to}`));
  console.log("警告:", warnings);
  console.groupEnd();

  // ── 中間表現 → PROV-JSON-LD 埋め込み形式に変換 ──
  return buildProvJsonLd(nodes, relations, warnings, input.documentProvenance);
}

// ── 中間表現 → PROV-JSON-LD 変換 ──

function buildProvJsonLd(
  nodes: InternalNode[],
  relations: InternalRelation[],
  warnings: ProvWarning[],
  documentProvenance?: import("../document-provenance/types").DocumentProvenance,
): ProvJsonLd {
  // ノード ID → ProvJsonLdNode マップを構築
  const nodeMap = new Map<string, ProvJsonLdNode>();

  for (const n of nodes) {
    const jsonLdNode: ProvJsonLdNode = {
      "@id": n["@id"],
      "@type": n["@type"],
      "rdfs:label": n.label,
      "graphium:blockId": n.blockId,
    };
    // Entity サブタイプ（material / tool）
    if (n.entitySubtype) {
      jsonLdNode["graphium:entityType"] = n.entitySubtype;
    }
    // 構造化属性（テーブルから展開された params）
    if (n.params) {
      for (const [k, v] of Object.entries(n.params)) {
        jsonLdNode[`graphium:${k}` as `graphium:${string}`] = v;
      }
    }
    // 埋め込み属性（[属性] ラベルの段落テキスト）
    if (n.attributes && n.attributes.length > 0) {
      jsonLdNode["graphium:attributes"] = n.attributes.map((a) => ({
        "rdfs:label": a.label,
        "graphium:blockId": a.blockId,
      }));
    }
    nodeMap.set(n["@id"], jsonLdNode);
  }

  // 関係をノードに埋め込む
  for (const rel of relations) {
    const sourceNode = nodeMap.get(rel.from);
    if (!sourceNode) continue;

    switch (rel["@type"]) {
      case "prov:used": {
        if (!sourceNode["prov:used"]) {
          sourceNode["prov:used"] = [];
        }
        sourceNode["prov:used"]!.push({ "@id": rel.to });
        break;
      }
      case "prov:wasGeneratedBy": {
        // wasGeneratedBy: Entity → Activity（from=Entity, to=Activity）
        sourceNode["prov:wasGeneratedBy"] = { "@id": rel.to };
        break;
      }
      // graphium:hasAttribute は廃止 — 属性は graphium:attributes に直接埋め込み
    }
  }

  // DocumentProvenance Bundle（オプション）
  const docProvBundle = documentProvenance
    ? buildDocumentProvenanceBundle(documentProvenance)
    : undefined;

  return {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      graphium: "https://graphium.app/ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@graph": [...nodeMap.values()],
    "graphium:warnings": warnings.length > 0 ? warnings : undefined,
    "graphium:documentProvenance": docProvBundle,
  };
}

// ── ヘルパー関数 ──

/** コアラベル → PROVロール */
function coreToProvRole(label: CoreLabel, block: any): string | null {
  switch (label) {
    case "[手順]": {
      if (block.type === "heading") {
        const role = getHeadingLabelRole(block.props?.level ?? 2, label);
        return role === "activity" ? "prov:Activity" : null;
      }
      return "prov:Activity";
    }
    case "[材料]": return "prov:Entity";
    case "[ツール]": return "prov:Entity";
    case "[属性]": return null; // 親ノードのプロパティとして埋め込む
    case "[結果]": return "prov:Entity";
    default: return null;
  }
}

/** ブロックのテキスト内容を取得 */
function getBlockText(block: any): string {
  if (block.content) {
    if (Array.isArray(block.content)) {
      return block.content
        .map((c: any) => (c.type === "text" ? c.text : ""))
        .join("");
    }
  }
  return block.id?.slice(0, 8) ?? "";
}

/** テーブルセルからテキストを抽出 */
function extractCellText(cell: any): string {
  // BlockNote エディタ出力形式: { type: "tableCell", content: [...] }
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return extractInlineText(cell.content ?? []);
  }
  // テスト用・旧形式: [{ type: "text", text: "..." }]
  if (Array.isArray(cell)) {
    return extractInlineText(cell);
  }
  return "";
}

/** InlineContent 配列からテキストを結合 */
function extractInlineText(inlines: any[]): string {
  if (!Array.isArray(inlines)) return "";
  return inlines
    .map((inline: any) => {
      if (typeof inline === "string") return inline;
      if (inline.type === "text") return inline.text ?? "";
      return "";
    })
    .join("")
    .trim();
}

/** ネストされたブロックをフラット化 */
function flattenBlocks(blocks: any[]): any[] {
  const result: any[] = [];
  for (const block of blocks) {
    result.push(block);
    if (block.children && Array.isArray(block.children)) {
      result.push(...flattenBlocks(block.children));
    }
  }
  return result;
}

/**
 * [属性] ブロックの親ラベル付きブロックの PROV ノード ID を探す。
 */
function findParentLabeledNodeId(
  blockId: string,
  blocks: any[],
  labels: Map<string, string>,
  labeledBlocks: { block: any; coreLabel: string | null }[]
): string | null {
  const parentId = findParentBlockId(blocks, blockId);
  if (!parentId) return null;

  const parentLabel = labels.get(parentId);
  if (!parentLabel) {
    return findParentLabeledNodeId(parentId, blocks, labels, labeledBlocks);
  }

  const normalized = normalizeLabel(parentLabel);

  switch (normalized) {
    case "[材料]":
    case "[ツール]":
      return `entity_${parentId}`;
    case "[結果]":
      return `result_${parentId}`;
    case "[手順]":
      return null;
    default:
      return null;
  }
}

/** ブロックツリー内で指定ブロックの親ブロック ID を探す */
function findParentBlockId(blocks: any[], targetId: string): string | null {
  for (const block of blocks) {
    if (block.children && Array.isArray(block.children)) {
      for (const child of block.children) {
        if (child.id === targetId) return block.id;
        const found = findParentBlockId([child], targetId);
        if (found) return found;
      }
    }
  }
  return null;
}

/** ブロックツリーからIDで検索 */
function findBlockById(block: any, id: string): any | null {
  if (block.id === id) return block;
  if (block.children) {
    for (const child of block.children) {
      const found = findBlockById(child, id);
      if (found) return found;
    }
  }
  return null;
}

// ── ProvJsonLd からフラットな関係リストを抽出（ビュー層・テスト用） ──

export type FlatRelation = {
  "@type": string;
  from: string;
  to: string;
};

/** ProvJsonLd の埋め込み関係をフラットなリストに展開する */
export function extractRelations(doc: ProvJsonLd): FlatRelation[] {
  const relations: FlatRelation[] = [];

  for (const node of doc["@graph"]) {
    if (node["prov:used"]) {
      for (const ref of node["prov:used"]) {
        relations.push({ "@type": "prov:used", from: node["@id"], to: ref["@id"] });
      }
    }
    if (node["prov:wasGeneratedBy"]) {
      relations.push({
        "@type": "prov:wasGeneratedBy",
        from: node["@id"],
        to: node["prov:wasGeneratedBy"]["@id"],
      });
    }
    // graphium:attributes はプロパティ埋め込み — extractRelations には含めない
    // ビュー層が graphium:attributes を直接読んでダイヤモンドノードを生成する
  }

  return relations;
}
