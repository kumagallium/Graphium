// ──────────────────────────────────────────────
// PROV-JSON-LD 生成器
//
// ドキュメント全体を走査して PROV-JSON-LD を生成する。
// Phase 3: 関係を埋め込み形式に、テーブルを構造化属性に展開
// ──────────────────────────────────────────────

import { CORE_LABELS, normalizeLabel, classifyLabel, getHeadingLabelRole, type CoreLabel } from "../context-label/labels";
import { parseSampleTable, validateSampleIds, type SampleTable } from "../sample-branch/parser";
import { expandSampleBranch, propagateBranches, type BranchExpansion } from "../sample-branch/expander";
import type { BlockLink } from "../block-link/link-types";
import { isProvLink } from "../block-link/link-types";
import { createWarning, type ProvWarning } from "./errors";

// ── PROV-JSON-LD の型定義（Phase 3: 埋め込み形式） ──

/** 埋め込み属性（[属性] ラベルの段落テキスト） */
export type ProvAttribute = {
  "rdfs:label": string;
  "provnote:blockId"?: string;
};

export type ProvJsonLdNode = {
  "@id": string;
  "@type": string;
  "rdfs:label": string;
  "prov:used"?: { "@id": string }[];
  "prov:wasGeneratedBy"?: { "@id": string };
  "provnote:attributes"?: ProvAttribute[];
  "provnote:blockId"?: string;
  "provnote:sampleId"?: string;
  [key: `provnote:${string}`]: any;
};

export type ProvJsonLd = {
  "@context": {
    prov: "http://www.w3.org/ns/prov#";
    provnote: "https://provnote.app/ns#";
    rdfs: "http://www.w3.org/2000/01/rdf-schema#";
    xsd: "http://www.w3.org/2001/XMLSchema#";
  };
  "@graph": ProvJsonLdNode[];
  "provnote:warnings"?: ProvWarning[];
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
  sampleId?: string;
  params?: Record<string, string>;
  attributes?: { label: string; blockId: string }[];
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

  // 後方互換: [パターン] は廃止されたが、既存データのために free ラベルとして扱いつつ
  // パターン分岐展開は引き続き動作させる
  const LEGACY_PATTERN_LABELS = new Set(["[パターン]", "[試料]", "[サンプル]", "[ケース]"]);

  for (const block of flatBlocks) {
    const rawLabel = labels.get(block.id);
    if (!rawLabel) continue;

    const normalized = normalizeLabel(rawLabel);
    const layer = classifyLabel(normalized);

    if (layer === "free" && !LEGACY_PATTERN_LABELS.has(rawLabel)) {
      warnings.push(createWarning("unknown-label", block.id, `"${rawLabel}" はフリーラベル — PROVに変換しません`));
      continue;
    }

    const coreLabel = (layer === "core" ? normalized : null) as CoreLabel | null;
    const provRole = coreLabel ? coreToProvRole(coreLabel, block) : null;

    labeledBlocks.push({ block, rawLabel, label: normalized, coreLabel, provRole });
  }

  // ── Step 2: @リンク解析 ──

  const informedByMap = new Map<string, BlockLink[]>();
  for (const link of links) {
    if (link.type === "informed_by") {
      const targetExists = blocks.some((b: any) => findBlockById(b, link.targetBlockId));
      if (!targetExists) {
        warnings.push(createWarning("broken-link", link.sourceBlockId, `前手順リンク先 ${link.targetBlockId} が存在しません`));
      }

      const existing = informedByMap.get(link.sourceBlockId) ?? [];
      existing.push(link);
      informedByMap.set(link.sourceBlockId, existing);
    }
  }

  // ── Step 3: パターン分岐の展開 ──

  const activities = labeledBlocks.filter((lb) => lb.provRole === "prov:Activity");

  // [パターン] ラベルは廃止。パターン分岐展開は既存データの後方互換のため残す
  const sampleTables = labeledBlocks
    .filter((lb) => (lb.rawLabel === "[パターン]" || lb.rawLabel === "[試料]") && lb.block.type === "table")
    .map((lb) => ({ block: lb.block, table: parseSampleTable(lb.block) }))
    .filter((x): x is { block: any; table: SampleTable } => x.table !== null);

  const conditionBlockIds = new Set(
    labeledBlocks.filter((lb) => lb.coreLabel === "[属性]").map((lb) => lb.block.id)
  );

  const branchMap = new Map<string, BranchExpansion>();
  const usedSampleTables = new Set<string>();

  for (const act of activities) {
    const blockId = act.block.id;
    const actLabel = getBlockText(act.block);

    const actIdx = flatBlocks.indexOf(act.block);
    const actLevel = act.block.props?.level ?? 2;
    let scopeEnd = flatBlocks.length;
    for (let i = actIdx + 1; i < flatBlocks.length; i++) {
      if (flatBlocks[i].type === "heading" && (flatBlocks[i].props?.level ?? 2) <= actLevel) {
        scopeEnd = i;
        break;
      }
    }
    const sampleEntry = sampleTables.find((st) => {
      if (usedSampleTables.has(st.block.id)) return false;
      const stIdx = flatBlocks.indexOf(st.block);
      return stIdx > actIdx && stIdx < scopeEnd;
    });

    if (sampleEntry && sampleEntry.table.rows.length > 0) {
      usedSampleTables.add(sampleEntry.block.id);
      if (conditionBlockIds.has(sampleEntry.block.id)) {
        warnings.push(createWarning(
          "sample-condition-coexist",
          sampleEntry.block.id,
          "[試料] と [条件] が共存 — [試料] を優先、[条件] は全パターン共通として処理"
        ));
      }

      const expansion = expandSampleBranch(blockId, actLabel, sampleEntry.table);
      branchMap.set(blockId, expansion);

      for (const a of expansion.activities) {
        nodes.push({
          "@id": a.id,
          "@type": "prov:Activity",
          label: a.label,
          blockId: a.blockId,
          sampleId: a.sampleId,
        });
      }

      for (const e of expansion.entities) {
        nodes.push({
          "@id": e.id,
          "@type": "prov:Entity",
          label: e.label,
          blockId: e.blockId,
          sampleId: e.sampleId,
          params: e.params,
        });
        relations.push({
          "@type": "prov:used",
          from: `${blockId}__sample_${e.sampleId}`,
          to: e.id,
        });
      }
    } else {
      const informedLinks = informedByMap.get(blockId) ?? [];
      const propagated = propagateBranches(blockId, actLabel, informedLinks, branchMap);

      if (propagated) {
        branchMap.set(blockId, propagated);
        for (const a of propagated.activities) {
          nodes.push({
            "@id": a.id,
            "@type": "prov:Activity",
            label: a.label,
            blockId: a.blockId,
            sampleId: a.sampleId,
          });
        }
      } else {
        nodes.push({
          "@id": `activity_${blockId}`,
          "@type": "prov:Activity",
          label: actLabel,
          blockId,
        });
      }
    }
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
          const branch = branchMap.get(block.id);
          const actId = branch
            ? branch.activities[0]?.id ?? `activity_${block.id}`
            : `activity_${block.id}`;
          scopeStack.push({ level, activityId: actId });
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
    for (const [, branch] of branchMap) {
      if (branch.activities.some((a) => a.id === scopeActId)) {
        return branch.activities.map((a) => a.id);
      }
    }
    return [scopeActId];
  }

  // ── [使用したもの] → Entity + used 関係 ──
  // Phase 3: テーブルの場合は行ごとに個別 Entity に展開
  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "[使用したもの]") {
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
        });
        for (const actId of getActivityIdsForScope(lb.block.id)) {
          relations.push({ "@type": "prov:used", from: actId, to: entityId });
        }
      }
    }
  }

  // ── [属性] → 親ノードの provnote:attributes に埋め込み ──
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
  // 行名がパターンIDに一致する場合は対応する分岐 Activity のみにリンク
  const knownSampleIds = new Set<string>();
  for (const [, branch] of branchMap) {
    for (const a of branch.activities) {
      if (a.sampleId) knownSampleIds.add(a.sampleId);
    }
  }

  for (const lb of labeledBlocks) {
    if (lb.coreLabel === "[結果]") {
      if (lb.block.type === "table") {
        const parsed = parseStructuredTable(lb.block);
        if (parsed && parsed.rows.length > 0) {
          for (const row of parsed.rows) {
            const entityId = `result_${lb.block.id}_${row.name}`;
            // 行名がパターンIDに一致するか判定
            const matchedSampleId = knownSampleIds.has(row.name) ? row.name : undefined;
            nodes.push({
              "@id": entityId,
              "@type": "prov:Entity",
              label: row.name,
              blockId: lb.block.id,
              sampleId: matchedSampleId,
              params: Object.keys(row.attrs).length > 0 ? row.attrs : undefined,
            });
            if (matchedSampleId) {
              // パターンIDに一致 → 対応する分岐 Activity のみにリンク
              const actIds = getActivityIdsForScope(lb.block.id);
              const matchedActId = actIds.find((id) => id.includes(`__sample_${matchedSampleId}`));
              if (matchedActId) {
                relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: matchedActId });
              }
            } else {
              // 一致しない → 全分岐にリンク（従来通り）
              for (const actId of getActivityIdsForScope(lb.block.id)) {
                relations.push({ "@type": "prov:wasGeneratedBy", from: entityId, to: actId });
              }
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

      // 結果テーブルのパターンID照合
      if (lb.block.type === "table" && sampleTables.length > 0) {
        const resultTable = parseSampleTable(lb.block);
        if (resultTable) {
          for (const st of sampleTables) {
            const { unmatched } = validateSampleIds(st.table, resultTable);
            if (unmatched.length > 0) {
              warnings.push(createWarning(
                "sample-id-mismatch",
                lb.block.id,
                `パターンID不一致: ${unmatched.join(", ")}`
              ));
            }
          }
        }
      }
    }
  }

  // ── informed_by → 前手順の結果を経由してリンク ──
  for (const link of links) {
    if (link.type === "informed_by") {
      const prevBranch = branchMap.get(link.targetBlockId);
      const currentBranch = branchMap.get(link.sourceBlockId);

      const prevActIds = prevBranch
        ? prevBranch.activities.map((a) => ({ id: a.id, sampleId: a.sampleId }))
        : [{ id: `activity_${link.targetBlockId}`, sampleId: undefined as string | undefined }];

      const currentActIds = currentBranch
        ? currentBranch.activities.map((a) => ({ id: a.id, sampleId: a.sampleId }))
        : [{ id: `activity_${link.sourceBlockId}`, sampleId: undefined as string | undefined }];

      const findResultForActivity = (actId: string) =>
        nodes.find((n) => n["@id"].startsWith("result_") && blockToActivityId.get(n.blockId) === actId);

      const getOrCreateSynthetic = (prevActId: string, sampleId?: string) => {
        const suffix = sampleId ? `${link.targetBlockId}__${sampleId}` : link.targetBlockId;
        const syntheticId = `result_synthetic_${suffix}`;

        if (!nodes.find((n) => n["@id"] === syntheticId)) {
          const prevActLabel = nodes.find((n) => n["@id"] === prevActId)?.label ?? "前手順";
          nodes.push({
            "@id": syntheticId,
            "@type": "prov:Entity",
            label: `${prevActLabel} の結果`,
            blockId: link.targetBlockId,
            sampleId,
          });
          relations.push({
            "@type": "prov:wasGeneratedBy",
            from: syntheticId,
            to: prevActId,
          });
        }
        return syntheticId;
      };

      if (prevBranch && currentBranch) {
        for (const curr of currentActIds) {
          const prev = prevActIds.find((p) => p.sampleId === curr.sampleId);
          if (!prev) continue;
          const resultNode = findResultForActivity(prev.id);
          const resultId = resultNode?.["@id"] ?? getOrCreateSynthetic(prev.id, prev.sampleId);
          relations.push({ "@type": "prov:used", from: curr.id, to: resultId, linkId: link.id });
        }
      } else if (prevBranch && !currentBranch) {
        for (const prev of prevActIds) {
          const resultNode = findResultForActivity(prev.id);
          const resultId = resultNode?.["@id"] ?? getOrCreateSynthetic(prev.id, prev.sampleId);
          relations.push({ "@type": "prov:used", from: currentActIds[0].id, to: resultId, linkId: link.id });
        }
      } else {
        const prev = prevActIds[0];
        const resultNode = findResultForActivity(prev.id);
        const resultId = resultNode?.["@id"] ?? getOrCreateSynthetic(prev.id, prev.sampleId);
        for (const curr of currentActIds) {
          relations.push({ "@type": "prov:used", from: curr.id, to: resultId, linkId: link.id });
        }
      }
    }
  }

  console.log("生成ノード:", nodes.map((n) => `${n["@type"]} "${n.label}" (${n["@id"]})`));
  console.log("生成リレーション:", relations.map((r) => `${r["@type"]} ${r.from} → ${r.to}`));
  console.log("警告:", warnings);
  console.groupEnd();

  // ── 中間表現 → PROV-JSON-LD 埋め込み形式に変換 ──
  return buildProvJsonLd(nodes, relations, warnings);
}

// ── 中間表現 → PROV-JSON-LD 変換 ──

function buildProvJsonLd(
  nodes: InternalNode[],
  relations: InternalRelation[],
  warnings: ProvWarning[],
): ProvJsonLd {
  // ノード ID → ProvJsonLdNode マップを構築
  const nodeMap = new Map<string, ProvJsonLdNode>();

  for (const n of nodes) {
    const jsonLdNode: ProvJsonLdNode = {
      "@id": n["@id"],
      "@type": n["@type"],
      "rdfs:label": n.label,
      "provnote:blockId": n.blockId,
    };
    if (n.sampleId) {
      jsonLdNode["provnote:sampleId"] = n.sampleId;
    }
    // 構造化属性（テーブルから展開された params）
    if (n.params) {
      for (const [k, v] of Object.entries(n.params)) {
        jsonLdNode[`provnote:${k}` as `provnote:${string}`] = v;
      }
    }
    // 埋め込み属性（[属性] ラベルの段落テキスト）
    if (n.attributes && n.attributes.length > 0) {
      jsonLdNode["provnote:attributes"] = n.attributes.map((a) => ({
        "rdfs:label": a.label,
        "provnote:blockId": a.blockId,
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
      // provnote:hasAttribute は廃止 — 属性は provnote:attributes に直接埋め込み
    }
  }

  return {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      provnote: "https://provnote.app/ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@graph": [...nodeMap.values()],
    "provnote:warnings": warnings.length > 0 ? warnings : undefined,
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
    case "[使用したもの]": return "prov:Entity";
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
    case "[使用したもの]":
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
    // provnote:attributes はプロパティ埋め込み — extractRelations には含めない
    // ビュー層が provnote:attributes を直接読んでダイヤモンドノードを生成する
  }

  return relations;
}
